// /api/stats.js
// Top Scorers / Top Assists for the 8 competitions in ./_lib/competitions.js.
//
//   GET /api/stats?league=39&type=scorers
//   GET /api/stats?league=39&type=assists
//   GET /api/stats?league=39&type=scorers&season=2025   (override; normally auto-detected)
//
// Uses the SAME API-Football account as scores.js / match.js
// (process.env.API_FOOTBALL_KEY) and the SAME shared Redis cache module as
// match.js (./_lib/cache.js) -- nothing new is introduced there.
//
// CACHING (the actual point of this file):
//   topscorers:{leagueId}:{season}   -- 24h TTL (86400s), exactly as requested
//   topassists:{leagueId}:{season}   -- 24h TTL (86400s), exactly as requested
// Any number of visitors hitting this endpoint inside that 24h window are
// served straight from Redis -- NONE of them cause a new API-Football call.
// Only the first request after the cache has expired triggers exactly one
// upstream call, which then refills the cache for the next 24h.
//
// STALE FALLBACK: every successful fetch also writes a second, long-lived
// copy (30 days) under a ":stale" key. If the 24h cache has expired AND the
// live API-Football call fails (rate limit, outage, etc.), we serve that
// stale copy instead of an empty ranking -- same "serve stale over a hard
// failure" philosophy already used in standings.js.
//
// CACHE-STAMPEDE PROTECTION: on a cache miss, a request doesn't just go
// straight to API-Football -- it first tries to grab a short-lived Redis
// lock (./_lib/cache.js: acquireLock/releaseLock) scoped to this exact
// {type, league, season}, e.g. lock:topscorers:39:2026. Whichever request
// grabs it does the one upstream call and releases the lock when done.
// Every other request that arrives while the lock is held waits a few
// hundred ms at a time and re-checks the cache instead of also calling
// API-Football, so "100 visitors hit an expired cache at once" still
// means exactly 1 upstream request, not 100.

const { cacheGet, cacheSet, incrementDailyCounter, upstashConfigured, acquireLock, releaseLock, getLastRedisError } = require("./_lib/cache");
const COMPETITIONS = require("./_lib/competitions");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// How long a request is willing to wait on another request's in-flight
// refresh before giving up and handling the refresh itself. Kept short so
// a visitor is never stuck behind someone else's slow/failed request.
const LOCK_TTL_SECONDS = 20;
const LOCK_WAIT_ATTEMPTS = 8;
const LOCK_WAIT_DELAY_MS = 350; // ~2.8s total worst-case wait

const API_BASE = "https://v3.football.api-sports.io";
function buildHeaders() {
  return { "x-apisports-key": process.env.API_FOOTBALL_KEY };
}

const TTL_SECONDS = 24 * 60 * 60;        // 86400 -- the 24h cache that was asked for
const STALE_TTL_SECONDS = 30 * 24 * 60 * 60; // long-lived fallback copy only used on upstream failure

const ENDPOINT_BY_TYPE = { scorers: "/players/topscorers", assists: "/players/topassists" };
const CACHE_PREFIX_BY_TYPE = { scorers: "topscorers", assists: "topassists" };

// Same split-year season logic as scores.js/match.js, with the same Brasileirão
// calendar-year special case already used in standings.js (id 71).
function seasonForLeague(leagueId, now = new Date()) {
  if (Number(leagueId) === 71) return now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

// ---- Daily request budget (same pattern as match.js) ---------------------
// Normal worst case is 16 calls/day total for this whole feature (8 leagues x
// 2 types, once per cache expiry). This is just a generous safety backstop
// against something looping or misbehaving, not a limit you should ever
// realistically approach.
const DAILY_BUDGET = 60;
let localBudgetDay = null;
let localCallsToday = 0;

async function budgetAvailable() {
  if (upstashConfigured()) {
    const used = await incrementDailyCounter("api_football_stats");
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

async function callApiFootball(path) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY is not set.");
  const ok = await budgetAvailable();
  if (!ok) throw new Error("Daily request budget reached for /api/stats; serving cached data until it resets.");
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`API-Football request failed (${res.status})`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(typeof json.errors === "string" ? json.errors : JSON.stringify(json.errors));
  }
  return json.response || [];
}

function clean(obj) {
  Object.keys(obj).forEach((k) => {
    if (obj[k] === null || obj[k] === undefined) delete obj[k];
  });
  return obj;
}

function mapPlayer(item, type) {
  const stat = (item.statistics && item.statistics[0]) || {};
  const games = stat.games || {};
  const goals = stat.goals || {};
  const out = clean({
    id: item.player.id,
    name: item.player.name,
    photo: item.player.photo || null,
    team: stat.team ? clean({ id: stat.team.id, name: stat.team.name, logo: stat.team.logo }) : null,
    appearances: games.appearences != null ? games.appearences : null,
  });
  if (type === "scorers") out.goals = goals.total != null ? goals.total : 0;
  if (type === "assists") out.assists = goals.assists != null ? goals.assists : 0;
  return out;
}

async function fetchAndCache(type, leagueId, season) {
  const endpoint = ENDPOINT_BY_TYPE[type];
  const raw = await callApiFootball(`${endpoint}?league=${leagueId}&season=${season}`);
  const players = raw.map((item, i) => ({ rank: i + 1, ...mapPlayer(item, type) }));

  const prefix = CACHE_PREFIX_BY_TYPE[type];
  const key = `${prefix}:${leagueId}:${season}`;
  const staleKey = `${key}:stale`;
  await cacheSet(key, players, TTL_SECONDS);
  await cacheSet(staleKey, players, STALE_TTL_SECONDS);
  return players;
}

module.exports = async (req, res) => {
  try {
    const { league, type } = req.query;
    const leagueId = Number(league);
    const competition = COMPETITIONS.find((c) => c.id === leagueId);

    if (!league || !competition) {
      res.status(400).json({ ok: false, error: "Unknown or missing league parameter.", supported: COMPETITIONS });
      return;
    }
    if (type !== "scorers" && type !== "assists") {
      res.status(400).json({ ok: false, error: "type must be 'scorers' or 'assists'." });
      return;
    }

    const season = req.query.season ? parseInt(req.query.season, 10) : seasonForLeague(leagueId);
    const prefix = CACHE_PREFIX_BY_TYPE[type];
    const key = `${prefix}:${leagueId}:${season}`;
    const staleKey = `${key}:stale`;

    // 1 & 2: a request arrives, check the cache first.
    const cached = await cacheGet(key);
    if (cached !== null) {
      // 3: valid cached data exists -> return immediately, no API-Football call.
      res.status(200).json({ ok: true, data: cached, league: competition, season, stale: false });
      return;
    }

    // Cache missing/expired. Before calling API-Football, try to become
    // the single request that's allowed to refresh this exact
    // {type, league, season} combination -- this is what stops a cache
    // expiry from turning into N simultaneous upstream calls.
    const lockToken = await acquireLock(key, LOCK_TTL_SECONDS);

    if (lockToken) {
      // 4 & 5: we hold the lock -> make the ONE required upstream call,
      // then cache it for 24h, then always release the lock (success or
      // failure) so nobody is stuck waiting on us longer than necessary.
      try {
        const fresh = await fetchAndCache(type, leagueId, season);
        // 6: return the fresh (now cached) data.
        res.status(200).json({ ok: true, data: fresh, league: competition, season, stale: false });
      } catch (err) {
        console.error("[/api/stats] upstream failed, trying stale fallback:", err.message);
        const stale = await cacheGet(staleKey);
        if (stale !== null) {
          res.status(200).json({ ok: true, data: stale, league: competition, season, stale: true });
        } else {
          res.status(200).json({ ok: false, error: "Statistics are temporarily unavailable. Please try again shortly.", detail: "lock-holder fetch failed: " + err.message });
        }
      } finally {
        await releaseLock(key, lockToken);
      }
      return;
    }

    // Someone else already holds the lock and is refreshing this exact
    // key right now -- wait briefly and re-check the cache instead of
    // also calling API-Football. This is the "100 visitors, 1 request"
    // behavior: everyone who loses the lock race ends up here.
    for (let i = 0; i < LOCK_WAIT_ATTEMPTS; i++) {
      await sleep(LOCK_WAIT_DELAY_MS);
      const waited = await cacheGet(key);
      if (waited !== null) {
        res.status(200).json({ ok: true, data: waited, league: competition, season, stale: false });
        return;
      }
    }

    // We waited and the lock holder still hasn't published anything --
    // it's either unusually slow or it crashed before releasing/caching
    // (the lock's own TTL will reclaim it either way). Rather than make
    // this visitor wait indefinitely, try to take over: re-attempt the
    // lock once more, and if that still fails, fall back to stale data,
    // and only as a last resort do the fetch ourselves without a lock.
    const takeoverToken = await acquireLock(key, LOCK_TTL_SECONDS);
    if (takeoverToken) {
      try {
        const fresh = await fetchAndCache(type, leagueId, season);
        res.status(200).json({ ok: true, data: fresh, league: competition, season, stale: false });
      } catch (err) {
        console.error("[/api/stats] takeover fetch failed, trying stale fallback:", err.message);
        const stale = await cacheGet(staleKey);
        if (stale !== null) {
          res.status(200).json({ ok: true, data: stale, league: competition, season, stale: true });
        } else {
          res.status(200).json({ ok: false, error: "Statistics are temporarily unavailable. Please try again shortly.", detail: "takeover fetch failed: " + err.message });
        }
      } finally {
        await releaseLock(key, takeoverToken);
      }
      return;
    }

    const stale = await cacheGet(staleKey);
    if (stale !== null) {
      res.status(200).json({ ok: true, data: stale, league: competition, season, stale: true });
      return;
    }
    console.error("[/api/stats] never acquired lock (initial or takeover) and no stale data for", key);
    res.status(200).json({ ok: false, error: "Statistics are temporarily unavailable. Please try again shortly.", detail: "lock never acquired (initial + takeover both failed) and no stale cache for " + key, redisDetail: getLastRedisError() });
  } catch (err) {
    console.error("[/api/stats]", err.message);
    res.status(200).json({ ok: false, error: "Statistics are temporarily unavailable. Please try again shortly.", detail: err.message });
  }
};
