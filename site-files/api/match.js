// /api/match.js
// Serverless function (same style as /api/scores.js): plain (req, res)
// handler, key stays server-side via process.env.API_FOOTBALL_KEY.
//
// Handles ALL match-detail data through one endpoint, dispatched by `type`:
//   /api/match?id=123456&type=summary
//   /api/match?id=123456&type=events
//   /api/match?id=123456&type=lineups
//   /api/match?id=123456&type=statistics
//   /api/match?id=123456&type=players
//
// Uses the shared persistent cache in ./_lib/cache.js (Upstash Redis) so
// caching and the daily budget survive cold starts and multiple parallel
// serverless instances -- see that file's comments for setup.
//
// STATUS-AWARE CACHING (this version's change): a flat 25-minute TTL for
// every match wastes calls on matches that are already over -- a finished
// match's lineups, stats, and events will never change again, so there's
// no reason to ever re-fetch them once the final whistle has blown.
// Instead, the TTL now depends on the match's own status:
//   - finished (FT/AET/PEN/etc.)  -> cached 7 days (effectively "forever"
//     for practical purposes -- revisiting an old match later this week
//     costs nothing).
//   - live (1H/HT/2H/ET/BT/P)     -> cached 3 minutes -- a bit fresher
//     than before, and safe to do now that the cache is actually shared:
//     it's still at most one real upstream call per 3 minutes TOTAL
//     across every visitor, not per visitor.
//   - anything else (not started, TBD, postponed, etc.) -> the original
//     25 minutes.
// `events`/`lineups`/`statistics`/`players` don't carry the fixture's own
// status in their response, so they look up the ALREADY-cached `summary`
// for that id to decide; if summary isn't cached yet, they fall back to
// the default 25 minutes (safe default, just not maximally optimized
// until summary has been fetched at least once).

const { cacheGet, cacheSet, incrementDailyCounter, upstashConfigured } = require("./_lib/cache");

const API_BASE = "https://v3.football.api-sports.io";
function buildHeaders() {
  return { "x-apisports-key": process.env.API_FOOTBALL_KEY };
}

const DEFAULT_TTL_SECONDS = 25 * 60; // not started / unknown status
const LIVE_TTL_SECONDS = 3 * 60; // in-play -- refresh a bit more often
const FINISHED_TTL_SECONDS = 7 * 24 * 60 * 60; // finished -- data is final

const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE"]);
const FINISHED_STATUSES = new Set(["FT", "AET", "PEN", "PST", "CANC", "ABD", "AWD", "WO"]);

function ttlForStatus(status) {
  if (status && FINISHED_STATUSES.has(status)) return FINISHED_TTL_SECONDS;
  if (status && LIVE_STATUSES.has(status)) return LIVE_TTL_SECONDS;
  return DEFAULT_TTL_SECONDS;
}

// Used when we just fetched `summary` fresh -- read the status straight
// off the response we just got, no extra lookup needed.
function ttlForFreshSummary(raw) {
  const status = raw && raw[0] && raw[0].fixture && raw[0].fixture.status ? raw[0].fixture.status.short : null;
  return ttlForStatus(status);
}

// Used for events/lineups/statistics/players -- these don't include the
// fixture's own status, so check whatever summary is already cached for
// this id. Falls back to the default TTL if summary hasn't been cached
// yet (e.g., someone opened a tab other than the summary page first).
async function ttlFromCachedSummary(id) {
  const summary = await cacheGet(`summary:${id}`);
  const status = summary && summary.status ? summary.status.short : null;
  return ttlForStatus(status);
}

// ---- Daily request budget ------------------------------------------------
// /api/scores.js and this file get separate slices of your daily
// API-Football plan. With status-aware caching, a match you've already
// looked at once after it finishes costs nothing more -- so this budget
// now mostly covers NEW matches/live refreshes rather than repeat views
// of the same ones.
const DAILY_BUDGET = 25;

let localBudgetDay = null;
let localCallsToday = 0;

async function budgetAvailable() {
  if (upstashConfigured()) {
    const used = await incrementDailyCounter("api_football_match");
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
  if (!key) {
    throw new Error(
      "API_FOOTBALL_KEY is not set. Add it in your project's environment variables."
    );
  }
  const ok = await budgetAvailable();
  if (!ok) {
    throw new Error(
      "Daily request budget reached for /api/match; serving cached data until it resets."
    );
  }
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders() });
  if (!res.ok) throw new Error(`API-Football request failed (${res.status})`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(
      typeof json.errors === "string" ? json.errors : JSON.stringify(json.errors)
    );
  }
  return json.response || [];
}

// Per-instance in-flight map: only dedupes concurrent requests landing on
// the SAME instance. The shared Redis cache is what prevents duplicate
// upstream calls across different instances.
const inFlight = new Map();

// `ttlResolver` is an async function: (rawData) => ttlSeconds, called only
// on a cache miss, after the fresh data comes back, so the TTL can depend
// on what was actually fetched (or on other already-cached data).
async function getCached(key, path, ttlResolver) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = callApiFootball(path)
    .then(async (data) => {
      const ttl = await ttlResolver(data);
      await cacheSet(key, data, ttl);
      inFlight.delete(key);
      return data;
    })
    .catch((err) => {
      inFlight.delete(key);
      throw err;
    });

  inFlight.set(key, promise);
  return promise;
}

// ---------- shape helpers: reduce API-Football's raw response down to ----
// ---------- exactly what the frontend needs, dropping null/absent data ---

function clean(obj) {
  Object.keys(obj).forEach((k) => {
    if (obj[k] === null || obj[k] === undefined) delete obj[k];
  });
  return obj;
}

function mapSummary(item) {
  if (!item) return null;
  const f = item.fixture;
  const score = item.score || {};
  const hasScore = (s) => s && (s.home !== null || s.away !== null);
  return clean({
    id: f.id,
    date: f.date,
    status: clean({ short: f.status.short, long: f.status.long, elapsed: f.status.elapsed || null }),
    venue: f.venue && f.venue.name ? clean({ name: f.venue.name, city: f.venue.city }) : null,
    referee: f.referee || null,
    league: clean({
      id: item.league.id,
      name: item.league.name,
      logo: item.league.logo,
      round: item.league.round || null,
      season: item.league.season || null,
    }),
    home: clean({ id: item.teams.home.id, name: item.teams.home.name, logo: item.teams.home.logo, winner: item.teams.home.winner }),
    away: clean({ id: item.teams.away.id, name: item.teams.away.name, logo: item.teams.away.logo, winner: item.teams.away.winner }),
    goals: { home: item.goals.home, away: item.goals.away },
    halftime: hasScore(score.halftime) ? score.halftime : null,
    extratime: hasScore(score.extratime) ? score.extratime : null,
    penalty: hasScore(score.penalty) ? score.penalty : null,
  });
}

const EVENT_TYPE_MAP = { Goal: "goal", Card: "card", subst: "subst", Var: "var" };

function mapEvents(raw) {
  return raw
    .map((e) => {
      const minuteLabel = e.time.elapsed + (e.time.extra ? `+${e.time.extra}` : "");
      return clean({
        sortKey: e.time.elapsed * 100 + (e.time.extra || 0),
        minute: minuteLabel,
        type: EVENT_TYPE_MAP[e.type] || (e.type || "").toLowerCase(),
        detail: e.detail || null,
        comments: e.comments || null,
        team: clean({ id: e.team.id, name: e.team.name, logo: e.team.logo }),
        player: e.player && e.player.name ? clean({ id: e.player.id, name: e.player.name }) : null,
        assist: e.assist && e.assist.name ? clean({ id: e.assist.id, name: e.assist.name }) : null,
      });
    })
    .sort((a, b) => a.sortKey - b.sortKey);
}

function mapLineups(raw) {
  return raw.map((t) =>
    clean({
      team: clean({ id: t.team.id, name: t.team.name, logo: t.team.logo }),
      coach: t.coach && t.coach.name ? clean({ name: t.coach.name, photo: t.coach.photo || null }) : null,
      formation: t.formation || null,
      startXI: (t.startXI || []).map((p) =>
        clean({
          id: p.player.id,
          name: p.player.name,
          number: p.player.number,
          pos: p.player.pos || null,
          grid: p.player.grid || null,
          captain: !!p.player.captain,
        })
      ),
      substitutes: (t.substitutes || []).map((p) =>
        clean({ id: p.player.id, name: p.player.name, number: p.player.number, pos: p.player.pos || null })
      ),
    })
  );
}

function mapStatistics(raw) {
  return raw.map((t) =>
    clean({
      team: clean({ id: t.team.id, name: t.team.name, logo: t.team.logo }),
      stats: (t.statistics || [])
        .filter((s) => s.value !== null && s.value !== undefined)
        .map((s) => ({ type: s.type, value: s.value })),
    })
  );
}

function mapPlayers(raw) {
  return raw.map((t) =>
    clean({
      team: clean({ id: t.team.id, name: t.team.name, logo: t.team.logo }),
      players: (t.players || [])
        .map((p) => {
          const st = (p.statistics && p.statistics[0]) || {};
          const g = st.games || {};
          if (g.minutes === null || g.minutes === undefined) return null; // did not play
          return clean({
            id: p.player.id,
            name: p.player.name,
            photo: p.player.photo || null,
            position: g.position || null,
            minutes: g.minutes,
            rating: g.rating ? Number(g.rating).toFixed(1) : null,
            captain: !!g.captain,
            substitute: !!g.substitute,
            goals: st.goals && st.goals.total ? st.goals.total : null,
            assists: st.goals && st.goals.assists ? st.goals.assists : null,
            saves: st.goals && st.goals.saves ? st.goals.saves : null,
            shotsTotal: st.shots && st.shots.total ? st.shots.total : null,
            shotsOn: st.shots && st.shots.on ? st.shots.on : null,
            passesTotal: st.passes && st.passes.total ? st.passes.total : null,
            passAccuracy: st.passes && st.passes.accuracy ? st.passes.accuracy : null,
            tackles: st.tackles && st.tackles.total ? st.tackles.total : null,
            interceptions: st.tackles && st.tackles.interceptions ? st.tackles.interceptions : null,
            duelsTotal: st.duels && st.duels.total ? st.duels.total : null,
            duelsWon: st.duels && st.duels.won ? st.duels.won : null,
            foulsCommitted: st.fouls && st.fouls.committed ? st.fouls.committed : null,
            foulsDrawn: st.fouls && st.fouls.drawn ? st.fouls.drawn : null,
            yellow: st.cards && st.cards.yellow ? st.cards.yellow : null,
            red: st.cards && st.cards.red ? st.cards.red : null,
          });
        })
        .filter(Boolean),
    })
  );
}

module.exports = async (req, res) => {
  try {
    const { id, type } = req.query;
    if (!id) {
      res.status(400).json({ ok: false, error: "Missing id parameter." });
      return;
    }

    let data;
    switch (type) {
      case "summary": {
        const raw = await getCached(`summary:${id}`, `/fixtures?id=${id}`, (fresh) => ttlForFreshSummary(fresh));
        data = mapSummary(raw[0]);
        if (!data) {
          res.status(200).json({ ok: false, error: "Match not found." });
          return;
        }
        break;
      }
      case "events": {
        const raw = await getCached(`events:${id}`, `/fixtures/events?fixture=${id}`, () => ttlFromCachedSummary(id));
        data = mapEvents(raw);
        break;
      }
      case "lineups": {
        const raw = await getCached(`lineups:${id}`, `/fixtures/lineups?fixture=${id}`, () => ttlFromCachedSummary(id));
        data = mapLineups(raw);
        break;
      }
      case "statistics": {
        const raw = await getCached(`statistics:${id}`, `/fixtures/statistics?fixture=${id}`, () => ttlFromCachedSummary(id));
        data = mapStatistics(raw);
        break;
      }
      case "players": {
        const raw = await getCached(`players:${id}`, `/fixtures/players?fixture=${id}`, () => ttlFromCachedSummary(id));
        data = mapPlayers(raw);
        break;
      }
      default:
        res.status(400).json({ ok: false, error: "Unknown type parameter." });
        return;
    }

    res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error("[/api/match]", err.message);
    res.status(200).json({
      ok: false,
      error: "Match details are temporarily unavailable. Please try again shortly.",
    });
  }
};
