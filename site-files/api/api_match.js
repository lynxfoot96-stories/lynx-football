// /api/match.js
// Serverless function (same style as /api/scores.js): plain (req, res)
// handler, zero dependencies, key stays server-side via
// process.env.API_FOOTBALL_KEY.
//
// Handles ALL match-detail data through one endpoint, dispatched by `type`:
//   /api/match?id=123456&type=summary
//   /api/match?id=123456&type=events
//   /api/match?id=123456&type=lineups
//   /api/match?id=123456&type=statistics
//   /api/match?id=123456&type=players
//
// Each type maps to the matching API-Football endpoint:
//   summary    -> /fixtures?id=
//   events     -> /fixtures/events?fixture=
//   lineups    -> /fixtures/lineups?fixture=
//   statistics -> /fixtures/statistics?fixture=
//   players    -> /fixtures/players?fixture=
//
// WHY LOADING IS ON-DEMAND: unlike the Scores ticker (which polls in the
// background), these pages only fetch data when a person actually opens a
// match, so real-world call volume stays low even with a shorter cache
// window than the 30-minute one used for scores. Every response is still
// cached per (type, fixture id) in memory so repeat views/refreshes of the
// same match don't trigger a fresh API-Football call every time. On top of
// that, this file enforces its own hard daily request budget (see
// DAILY_BUDGET below) so match-detail pages can never eat into more than
// their share of your plan's daily limit -- once used up, it keeps serving
// the last data it fetched until the budget resets at midnight UTC.

const API_BASE = "https://v3.football.api-sports.io";
function buildHeaders() {
  return { "x-apisports-key": process.env.API_FOOTBALL_KEY };
}

// Every type refreshes at most once every 25 minutes, no matter how many
// times a match page is opened in between -- opening it just reads
// whatever's currently cached; only the first request after 25 minutes
// have passed triggers a real API-Football call.
const REFRESH_MS = 25 * 60 * 1000;
const TTL_MS = {
  summary: REFRESH_MS,
  events: REFRESH_MS,
  lineups: REFRESH_MS,
  statistics: REFRESH_MS,
  players: REFRESH_MS,
};

const cache = new Map(); // key -> { fetchedAt, ttl, data }
const inFlight = new Map();

// ---- Daily request budget ------------------------------------------------
// /api/scores.js and this file are separate serverless functions on
// Vercel, each with their own isolated memory, so they can't share one
// counter -- each gets its own slice of your 100-requests/day plan
// instead. This file gets the smaller share since match-detail pages are
// opened far less often than the homepage Scores ticker. Once used up for
// the day, calls fall back to whatever is already cached (even past its
// normal TTL) instead of ever placing another API-Football request.
const DAILY_BUDGET = 25;
let budgetDay = null;
let callsToday = 0;

function budgetAvailable() {
  const today = new Date().toISOString().slice(0, 10);
  if (budgetDay !== today) {
    budgetDay = today;
    callsToday = 0;
  }
  return callsToday < DAILY_BUDGET;
}

async function callApiFootball(path) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    throw new Error(
      "API_FOOTBALL_KEY is not set. Add it in your project's environment variables."
    );
  }
  if (!budgetAvailable()) {
    throw new Error(
      "Daily request budget reached for /api/match; serving cached data until it resets."
    );
  }
  callsToday++;
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

async function getCached(key, path, ttl) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = callApiFootball(path)
    .then((data) => {
      cache.set(key, { fetchedAt: Date.now(), data });
      inFlight.delete(key);
      return data;
    })
    .catch((err) => {
      inFlight.delete(key);
      if (cached) return cached.data; // serve stale over a hard failure
      throw err;
    });

  inFlight.set(key, promise);
  return promise;
}

// ---------- shape helpers: reduce API-Football's raw response down to ----
// ---------- exactly what the frontend needs, dropping null/absent data ---

function clean(obj) {
  // Remove null/undefined keys so the frontend can just check `if (x)`.
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
        const raw = await getCached(`summary:${id}`, `/fixtures?id=${id}`, TTL_MS.summary);
        data = mapSummary(raw[0]);
        if (!data) {
          res.status(200).json({ ok: false, error: "Match not found." });
          return;
        }
        break;
      }
      case "events": {
        const raw = await getCached(`events:${id}`, `/fixtures/events?fixture=${id}`, TTL_MS.events);
        data = mapEvents(raw);
        break;
      }
      case "lineups": {
        const raw = await getCached(`lineups:${id}`, `/fixtures/lineups?fixture=${id}`, TTL_MS.lineups);
        data = mapLineups(raw);
        break;
      }
      case "statistics": {
        const raw = await getCached(`statistics:${id}`, `/fixtures/statistics?fixture=${id}`, TTL_MS.statistics);
        data = mapStatistics(raw);
        break;
      }
      case "players": {
        const raw = await getCached(`players:${id}`, `/fixtures/players?fixture=${id}`, TTL_MS.players);
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
