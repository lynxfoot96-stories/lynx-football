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
// THIS VERSION uses the shared cache helper in ./_lib/cache.js, backed by
// Upstash Redis, instead of a plain in-memory Map. That fixes the real bug
// from before: an in-memory cache/counter only lives inside ONE serverless
// instance, and Vercel can run several instances of this function at once
// (or recycle one mid-session), so a 25-minute TTL and a daily budget
// counter never actually held reliably -- different requests kept landing
// on different "blank slate" instances, causing far more real upstream
// calls than the numbers in the code implied.
//
// SETUP REQUIRED for this fix to actually take effect: see the comment at
// the top of ./_lib/cache.js. Until Upstash is configured there, this file
// automatically falls back to the same in-memory behavior as before (not
// worse, just not fixed yet).
//
// Each type maps to the matching API-Football endpoint:
//   summary    -> /fixtures?id=
//   events     -> /fixtures/events?fixture=
//   lineups    -> /fixtures/lineups?fixture=
//   statistics -> /fixtures/statistics?fixture=
//   players    -> /fixtures/players?fixture=

const { cacheGet, cacheSet, incrementDailyCounter, upstashConfigured } = require("./_lib/cache");

const API_BASE = "https://v3.football.api-sports.io";
function buildHeaders() {
  return { "x-apisports-key": process.env.API_FOOTBALL_KEY };
}

// Every type refreshes at most once every 25 minutes. Viewing one match
// end-to-end (summary + events on the summary page, then one more call
// each for Lineups/Statistics/Players) can cost up to 5 upstream calls on
// a cache miss -- this uniform 25-minute window is what keeps repeat tab
// visits or a second look a few minutes later from re-triggering those
// calls, PROVIDED the cache is actually shared across instances (see
// above) -- which is exactly what this version fixes.
const REFRESH_SECONDS = 25 * 60;

// ---- Daily request budget ------------------------------------------------
// /api/scores.js and this file get separate slices of your daily
// API-Football plan. This file's slice is smaller since match-detail
// pages are opened less often than the homepage scores ticker, but each
// match view can cost up to 5 calls here, so it covers roughly 5 full
// match views/day before falling back to cached (or, once exhausted,
// briefly unavailable) data.
const DAILY_BUDGET = 25;

// Local fallback counter -- ONLY used if Upstash isn't configured yet, so
// the site still has *some* protection in the meantime rather than none.
// This has the same cross-instance limitation as the old code once
// Upstash isn't set up; configuring Upstash is what actually fixes it.
let localBudgetDay = null;
let localCallsToday = 0;

async function budgetAvailable() {
  if (upstashConfigured()) {
    // Increments first, then checks -- see incrementDailyCounter's own
    // comment in cache.js. Worst case this "spends" one extra count right
    // at the boundary; it never lets an extra real API-Football call
    // through past the budget.
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

// Per-instance in-flight map: this only dedupes concurrent requests that
// happen to land on the SAME instance. It's a minor optimization, not the
// source of correctness -- the shared Redis cache is what actually
// prevents duplicate upstream calls across different instances.
const inFlight = new Map();

async function getCached(key, path) {
  const cached = await cacheGet(key);
  if (cached !== null) return cached;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = callApiFootball(path)
    .then(async (data) => {
      await cacheSet(key, data, REFRESH_SECONDS);
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
        const raw = await getCached(`summary:${id}`, `/fixtures?id=${id}`);
        data = mapSummary(raw[0]);
        if (!data) {
          res.status(200).json({ ok: false, error: "Match not found." });
          return;
        }
        break;
      }
      case "events": {
        const raw = await getCached(`events:${id}`, `/fixtures/events?fixture=${id}`);
        data = mapEvents(raw);
        break;
      }
      case "lineups": {
        const raw = await getCached(`lineups:${id}`, `/fixtures/lineups?fixture=${id}`);
        data = mapLineups(raw);
        break;
      }
      case "statistics": {
        const raw = await getCached(`statistics:${id}`, `/fixtures/statistics?fixture=${id}`);
        data = mapStatistics(raw);
        break;
      }
      case "players": {
        const raw = await getCached(`players:${id}`, `/fixtures/players?fixture=${id}`);
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
