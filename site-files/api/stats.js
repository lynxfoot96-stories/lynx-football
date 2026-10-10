// /api/stats.js
// Top Scorers / Top Assists for the 8 competitions in ./_lib/competitions.js.
//
//   GET /api/stats?league=39&type=scorers
//   GET /api/stats?league=39&type=assists
//   GET /api/stats?league=39&type=scorers&season=2025   (override; normally auto-detected)
//
// DATA SOURCE: football-data.org (the same account/key already used by
// standings.js: process.env.API_FOOTBALL_STANDINGS_KEY), endpoint
//   GET /v4/competitions/{code}/scorers?season={year}&limit=100
// This replaces API-Football, whose free plan only serves seasons 2022-2024.
// The public response shape is UNCHANGED, so standings.html needs no edits.
//
// ONE UPSTREAM CALL FEEDS BOTH TABS: football-data.org returns goals and
// (when it has them) assists in the same response, so a single call per
// competition fills both the scorers and the assists caches.
//
// ASSISTS CAVEAT: on the free plan football-data.org only records an assists
// value for roughly a third of players (the rest are null = "not recorded",
// NOT zero), and the list is built from goal scorers. A ranking built from it
// is incomplete. So by default the assists tab reports "unavailable"
// (SHOW_PARTIAL_ASSISTS = false). Set it to true to show the partial ranking.
//
// PLAYER PHOTOS: football-data.org has none, so ./_lib/playerPhotos.js looks
// each player up on Wikipedia (only accepted when it is clearly the same
// footballer) and caches the result per player. Players with no safe photo get
// a generated initials avatar, added when the response is sent (never stored in
// the cache). The page needs no change: it already puts `photo` in the circle.
//
// PHOTO LOOKUP BUDGET: findPhotos() is given 8.5s and 8 concurrent workers
// (see addPhotos() below) -- raised from the library defaults (4s / 4) because
// the default budget was cutting most players off before they were even
// attempted on a 15-20 player list. Keep this comfortably under whatever your
// Vercel function timeout is (Hobby = 10s, Pro = 60s by default).
//
// CACHING:
//   fd-topscorers:{leagueId}:{season}   -- 24h TTL (86400s)
//   fd-topassists:{leagueId}:{season}   -- 24h TTL (86400s)
// Visitors inside the 24h window are served from the shared Redis cache and
// cause no upstream call. Only the first request after expiry refreshes it.
//
// STALE FALLBACK: every successful fetch also writes a 30-day copy under a
// ":stale" key. If the 24h cache has expired AND the upstream call fails
// (rate limit, outage, ...), that last good copy is served instead.
//
// CACHE-STAMPEDE PROTECTION: on a miss, a request first takes a short-lived
// lock scoped to {league, season} (lock:fd-stats:39:2026), so many visitors
// hitting an expired cache at once still cause ONE upstream call.

const { cacheGet, cacheSet, incrementDailyCounter, upstashConfigured, acquireLock, releaseLock, getLastRedisError } = require("./_lib/cache");
const COMPETITIONS = require("./_lib/competitions");
const { findPhotos, initialsAvatar } = require("./_lib/playerPhotos");

// false = Assists tab says "unavailable"; true = show the partial ranking.
const SHOW_PARTIAL_ASSISTS = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const LOCK_TTL_SECONDS = 20;
const LOCK_WAIT_ATTEMPTS = 8;
const LOCK_WAIT_DELAY_MS = 350; // ~2.8s total worst-case wait

const API_BASE = "https://api.football-data.org/v4";
const FETCH_LIMIT = 100;       // rows requested from football-data.org
const MAX_ROWS = 20;           // rows shown per list (same size as before)
const FETCH_TIMEOUT_MS = 8000; // never hang a request (and its lock) on a stuck upstream

// Our numeric league ids -> football-data.org competition codes
// (same mapping as standings.js).
const FD_CODE = {
  39: "PL",
  140: "PD",
  135: "SA",
  78: "BL1",
  61: "FL1",
  2: "CL",
  94: "PPL",
  71: "BSA",
};

const TTL_SECONDS = 24 * 60 * 60;            // 86400 -- the 24h cache
const STALE_TTL_SECONDS = 30 * 24 * 60 * 60; // long-lived fallback copy only used on upstream failure

// New prefixes so nothing cached from the old API-Football source is ever reused.
const CACHE_PREFIX_BY_TYPE = { scorers: "fd-topscorers", assists: "fd-topassists" };

// football-data.org labels a season by its start year (2026 = 2026-27).
// Brasileirao runs on the calendar year (id 71), same as standings.js.
function seasonForLeague(leagueId, now = new Date()) {
  if (Number(leagueId) === 71) return now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// ---- Daily request budget -------------------------------------------------
// Normal worst case is 8 calls/day (one per competition). This is only a
// safety backstop against loops, not a limit you should approach.
const DAILY_BUDGET = 60;
let localBudgetDay = null;
let localCallsToday = 0;

async function budgetAvailable() {
  if (upstashConfigured()) {
    const used = await incrementDailyCounter("fd_stats");
    return used === null || used <= DAILY_BUDGET;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (localBudgetDay !== today) {
    localBudgetDay = today;
    localCallsToday = 0;
  }
  localCallsToday++;
  return localCallsToday <= DAILY_BUDGET;
}

async function callFootballData(path) {
  const key = process.env.API_FOOTBALL_STANDINGS_KEY;
  if (!key) throw new Error("API_FOOTBALL_STANDINGS_KEY is not set.");
  const ok = await budgetAvailable();
  if (!ok) throw new Error("Daily request budget reached for /api/stats; serving cached data until it resets.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}${path}`, { headers: { "X-Auth-Token": key }, signal: controller.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // football-data.org errors look like { "message": "...", "errorCode": ... }
      throw new Error(`${json.message || "football-data.org request failed"} (HTTP ${res.status})`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function clean(obj) {
  Object.keys(obj).forEach((k) => {
    if (obj[k] === null || obj[k] === undefined) delete obj[k];
  });
  return obj;
}

// Same fields the page already reads. football-data.org has no player photos,
// so `photo` is simply omitted (the page shows its placeholder circle).
function mapBase(s) {
  return clean({
    id: s.player.id,
    name: s.player.name,
    _dob: s.player.dateOfBirth || null, // internal: used for photo matching, removed before caching
    team: clean({ id: s.team.id, name: s.team.shortName || s.team.name, logo: s.team.crest }),
    appearances: Number.isInteger(s.playedMatches) ? s.playedMatches : null,
  });
}

// Validate the upstream response and build both ranked lists from it.
// Throws (so the caller falls back to stale data) rather than caching junk.
function buildLists(raw, season) {
  if (!raw || !Array.isArray(raw.scorers)) {
    throw new Error("Unexpected response from football-data.org (no scorers list).");
  }
  const startYear = raw.season && raw.season.startDate ? parseInt(String(raw.season.startDate).slice(0, 4), 10) : null;
  if (startYear !== null && startYear !== season) {
    throw new Error(`football-data.org returned season ${startYear}, expected ${season}.`);
  }
  const rows = raw.scorers.filter((s) => s && s.player && s.team && Number.isInteger(s.goals));
  if (!rows.length) throw new Error("football-data.org returned no scorers for this competition/season.");

  const scorers = rows
    .slice()
    .sort((a, b) => b.goals - a.goals)
    .slice(0, MAX_ROWS)
    .map((s, i) => ({ rank: i + 1, ...mapBase(s), goals: s.goals }));

  let assists = [];
  if (SHOW_PARTIAL_ASSISTS) {
    // Only players with a recorded assists value (null is NOT zero) and at least one.
    assists = rows
      .filter((s) => Number.isInteger(s.assists) && s.assists > 0)
      .sort((a, b) => b.assists - a.assists || (a.playedMatches ?? Infinity) - (b.playedMatches ?? Infinity))
      .slice(0, MAX_ROWS)
      .map((s, i) => ({ rank: i + 1, ...mapBase(s), assists: s.assists }));
  }
  return { scorers, assists };
}

// Attach Wikipedia photos where a safe match exists. Never throws and never
// blocks the stats: on any problem players just keep no `photo` (initials
// avatar is added at response time) and are retried on the next refresh.
//
// budgetMs/concurrency are raised above the playerPhotos.js library defaults
// (4000ms / 4) because the defaults were cutting most players off before they
// were even attempted on a full 15-20 player scorers+assists list.
async function addPhotos(lists) {
  const items = [...lists.scorers, ...lists.assists];
  const unique = new Map();
  for (const p of items) if (!unique.has(p.id)) unique.set(p.id, { id: p.id, name: p.name, dob: p._dob });
  let found = new Map();
  try {
    found = await findPhotos([...unique.values()], { budgetMs: 8500, concurrency: 8 });
  } catch (err) {
    console.error("[/api/stats] photo lookup failed:", err.message);
  }
  for (const p of items) {
    if (found.has(p.id)) p.photo = found.get(p.id);
    delete p._dob;
  }
}

async function fetchAndCache(leagueId, season) {
  const code = FD_CODE[leagueId];
  const raw = await callFootballData(`/competitions/${code}/scorers?season=${season}&limit=${FETCH_LIMIT}`);
  const lists = buildLists(raw, season);
  await addPhotos(lists);

  const types = SHOW_PARTIAL_ASSISTS ? ["scorers", "assists"] : ["scorers"];
  for (const type of types) {
    const key = `${CACHE_PREFIX_BY_TYPE[type]}:${leagueId}:${season}`;
    await cacheSet(key, lists[type], TTL_SECONDS);
    await cacheSet(`${key}:stale`, lists[type], STALE_TTL_SECONDS);
  }
  return lists;
}

const UNAVAILABLE = "Statistics are temporarily unavailable. Please try again shortly.";

module.exports = async (req, res) => {
  try {
    const { league, type } = req.query;
    const leagueId = Number(league);
    const competition = COMPETITIONS.find((c) => c.id === leagueId);

    if (!league || !competition || !FD_CODE[leagueId]) {
      res.status(400).json({ ok: false, error: "Unknown or missing league parameter.", supported: COMPETITIONS });
      return;
    }
    if (type !== "scorers" && type !== "assists") {
      res.status(400).json({ ok: false, error: "type must be 'scorers' or 'assists'." });
      return;
    }

    // Assists are switched off until a reliable source exists (see header).
    // No cache or upstream call is made for them.
    if (type === "assists" && !SHOW_PARTIAL_ASSISTS) {
      res.status(200).json({
        ok: false,
        error: "Top assists are not available yet.",
        detail: "Reliable assist data is not available on the free football-data.org plan.",
      });
      return;
    }

    const season = req.query.season ? parseInt(req.query.season, 10) : seasonForLeague(leagueId);
    const key = `${CACHE_PREFIX_BY_TYPE[type]}:${leagueId}:${season}`;
    const staleKey = `${key}:stale`;
    const lockKey = `fd-stats:${leagueId}:${season}`; // one lock per league, shared by both tabs

    // Players without a Wikipedia photo get a generated initials avatar (added here, not cached).
    const withPhotos = (list) => list.map((p) => (p.photo ? p : { ...p, photo: initialsAvatar(p.name) }));
    const send = (data, stale) => res.status(200).json({ ok: true, data: withPhotos(data), league: competition, season, stale });

    // 1. Fresh cache hit -> no upstream call.
    const cached = await cacheGet(key);
    if (cached !== null) {
      send(cached, false);
      return;
    }

    // 2. Miss: try to become the single request that refreshes this league.
    const lockToken = await acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (lockToken) {
      try {
        const fresh = await fetchAndCache(leagueId, season);
        send(fresh[type], false);
      } catch (err) {
        console.error("[/api/stats] upstream failed, trying stale fallback:", err.message);
        const stale = await cacheGet(staleKey);
        if (stale !== null) {
          send(stale, true);
        } else {
          res.status(200).json({ ok: false, error: UNAVAILABLE, detail: "lock-holder fetch failed: " + err.message });
        }
      } finally {
        await releaseLock(lockKey, lockToken);
      }
      return;
    }

    // 3. Someone else is refreshing -> wait briefly and re-check the cache.
    for (let i = 0; i < LOCK_WAIT_ATTEMPTS; i++) {
      await sleep(LOCK_WAIT_DELAY_MS);
      const waited = await cacheGet(key);
      if (waited !== null) {
        send(waited, false);
        return;
      }
    }

    // 4. The lock holder is slow or crashed: try to take over once.
    const takeoverToken = await acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (takeoverToken) {
      try {
        const fresh = await fetchAndCache(leagueId, season);
        send(fresh[type], false);
      } catch (err) {
        console.error("[/api/stats] takeover fetch failed, trying stale fallback:", err.message);
        const stale = await cacheGet(staleKey);
        if (stale !== null) {
          send(stale, true);
        } else {
          res.status(200).json({ ok: false, error: UNAVAILABLE, detail: "takeover fetch failed: " + err.message });
        }
      } finally {
        await releaseLock(lockKey, takeoverToken);
      }
      return;
    }

    // 5. Last resort: stale copy if we have one.
    const stale = await cacheGet(staleKey);
    if (stale !== null) {
      send(stale, true);
      return;
    }
    console.error("[/api/stats] never acquired lock (initial or takeover) and no stale data for", key);
    res.status(200).json({ ok: false, error: UNAVAILABLE, detail: "lock never acquired (initial + takeover both failed) and no stale cache for " + key, redisDetail: getLastRedisError() });
  } catch (err) {
    console.error("[/api/stats]", err.message);
    res.status(200).json({ ok: false, error: UNAVAILABLE, detail: err.message });
  }
};
