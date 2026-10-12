// /api/standings.js
// Serverless function (same style as /api/scores.js and /api/match.js):
// plain (req, res) handler, zero dependencies. Uses your SECOND key,
// process.env.API_FOOTBALL_STANDINGS_KEY, kept deliberately separate from
// API_FOOTBALL_KEY so this widget has its own request quota.
//
// IMPORTANT: this key is from football-data.org, NOT API-Football/API-Sports.
// It's a different provider with a different base URL, a different auth
// header, and a different response shape -- this file talks to it on its
// own terms rather than pretending it's API-Football.
//
//   /api/standings?league=39            -> current-season table for a league
//   /api/standings?league=39&season=2025 -> a specific season
//
// The public interface (numeric league id, same ids used everywhere else
// on the site: 39=Premier League, 140=La Liga, 135=Serie A, 78=Bundesliga,
// 61=Ligue 1, 2=Champions League) stays IDENTICAL to before, so nothing
// else on the site needs to change -- this file just translates that id
// to football-data.org's own competition code internally and calls
// GET /v4/competitions/{code}/standings.
//
// WHY THE LONG CACHE: league tables only change a handful of times a day
// (when matches finish), so a 5-minute cache keeps this file's usage tiny
// and safely under football-data.org's free-plan limit of 10 requests/
// minute -- and, via the shared cache below, holds no matter how many
// people hit the site in the same minute or how many serverless instances
// Vercel happens to spin up to serve them.

const { cacheGet, cacheSet, acquireLock, releaseLock } = require("./_lib/cache");

const API_BASE = "https://api.football-data.org/v4";
function buildHeaders() {
  return { "X-Auth-Token": process.env.API_FOOTBALL_STANDINGS_KEY };
}

// Our numeric league ids (same ones used in scores.js) -> football-data.org
// competition codes. Add more here if you ever add more competitions.
const LEAGUE_ID_TO_FD_CODE = {
  39: "PL", // Premier League
  140: "PD", // La Liga (Primera Division)
  135: "SA", // Serie A
  78: "BL1", // Bundesliga
  61: "FL1", // Ligue 1
  2: "CL", // Champions League
  71: "BSA", // Brasileirão Série A
  94: "PPL", // Primeira Liga
};

const TTL_SECONDS = 5 * 60; // fresh window, shared across instances via the existing cache.js
const STALE_TTL_SECONDS = 24 * 60 * 60; // long-lived copy, only used if upstream fails
const inFlight = new Map(); // collapses concurrent requests within this same instance

// ---- Daily request budget ------------------------------------------------
// The cache above guarantees at most ONE upstream call per competition per
// 5 minutes *per warm instance* -- but Vercel can run several instances of
// this function at once, each with its own memory, so that alone doesn't
// bound things across a traffic spike. The shared Supabase cache in
// getCached() closes that gap: any instance that finds a fresh-enough row
// there reuses it instead of calling upstream. This daily cap is a second,
// independent backstop under both of those. With 8 competitions refreshed
// at most once every 5 minutes each: 8 * 12 * 24 = 2,304 calls/day in the
// worst case (site open nonstop, every competition viewed constantly) --
// comfortably under football-data.org's free-plan limits.
const DAILY_BUDGET = 3000;
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

function currentSeasonYear() {
  const now = new Date();
  const month = now.getUTCMonth() + 1; // 1-12
  // European club seasons start around July/August and are labelled by
  // their start year (e.g. the 2026-27 season is "season=2026").
  return month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function callFootballData(path) {
  const key = process.env.API_FOOTBALL_STANDINGS_KEY;
  if (!key) {
    throw new Error(
      "API_FOOTBALL_STANDINGS_KEY is not set. Add it in your project's environment variables."
    );
  }
  if (!budgetAvailable()) {
    throw new Error(
      "Daily request budget reached for /api/standings; serving cached data until it resets."
    );
  }
  callsToday++;
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders() });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    // football-data.org's error body looks like { "message": "..." } --
    // very different from API-Football's { "errors": {...} } shape.
    throw new Error(json.message || `football-data.org request failed (${res.status})`);
  }
  return json;
}

async function getCached(key, path) {
  const freshKey = `standings:${key}`;
  const staleKey = `standings:stale:${key}`;

  const fresh = await cacheGet(freshKey);
  if (fresh) return fresh;
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = (async () => {
    const token = await acquireLock(freshKey, 20);
    if (!token) {
      // Another request/instance is already fetching: wait briefly for its result.
      for (let i = 0; i < 10; i++) {
        await new Promise((r) => setTimeout(r, 300));
        const f = await cacheGet(freshKey);
        if (f) return f;
      }
      const stale = await cacheGet(staleKey);
      if (stale) return stale;
      // Nothing arrived; fall through and fetch ourselves.
    }
    try {
      const data = await callFootballData(path);
      await cacheSet(freshKey, data, TTL_SECONDS);
      await cacheSet(staleKey, data, STALE_TTL_SECONDS);
      return data;
    } catch (err) {
      const stale = await cacheGet(staleKey);
      if (stale) return stale;
      throw err;
    } finally {
      if (token) await releaseLock(freshKey, token);
    }
  })();

  promise.finally(() => inFlight.delete(key)).catch(() => {});
  inFlight.set(key, promise);
  return promise;
}

function clean(obj) {
  Object.keys(obj).forEach((k) => {
    if (obj[k] === null || obj[k] === undefined) delete obj[k];
  });
  return obj;
}

// Qualification/relegation zones aren't provided by football-data.org's
// free plan, so we derive them from table position using the standard,
// well-known format for each competition. This is a simplification (real
// rules can shift slightly season to season -- e.g. an extra Champions
// League place awarded by coefficient), not fetched fact, so treat the
// zone/label as an approximate guide rather than an official ruling.
function zoneForRank(leagueId, rank, totalTeams) {
  if (leagueId === 2) {
    // UEFA Champions League league phase (36 teams): top 8 go straight to
    // the round of 16, 9th-24th play a knockout qualifier, 25th-36th are out.
    if (rank <= 8) return { key: "cl-r16", label: "Round of 16", color: "var(--purple-bright)" };
    if (rank <= 24) return { key: "cl-playoff", label: "Knockout Playoff", color: "var(--orange-bright)" };
    return { key: "cl-out", label: "Eliminated", color: "#E0567A" };
  }
  if (leagueId === 71) {
    // Brasileirão Série A (20 teams): the exact Libertadores/Sudamericana
    // cutoffs shift a little year to year depending on Brazil's CONMEBOL
    // coefficient, so this is an approximation, same as the others below.
    if (rank <= 6) return { key: "libertadores", label: "Copa Libertadores", color: "var(--purple-bright)" };
    if (rank <= 12) return { key: "sudamericana", label: "Copa Sudamericana", color: "var(--orange-bright)" };
    if (rank > totalTeams - 4) return { key: "rel", label: "Relegation", color: "#E0567A" };
    return null;
  }
  if (leagueId === 94) {
    // Primeira Liga (18 teams): 1st goes straight into the Champions League
    // league phase, 2nd into CL qualifying, 3rd into the Europa League,
    // 4th into the Conference League, bottom 3 are relegated.
    if (rank === 1) return { key: "ucl", label: "Champions League", color: "var(--purple-bright)" };
    if (rank === 2) return { key: "ucl-q", label: "Champions League Qualifying", color: "var(--purple-bright)" };
    if (rank === 3) return { key: "uel", label: "Europa League", color: "var(--orange-bright)" };
    if (rank === 4) return { key: "uecl", label: "Conference League", color: "var(--orange-bright)" };
    if (rank > totalTeams - 3) return { key: "rel", label: "Relegation", color: "#E0567A" };
    return null;
  }
  // Domestic leagues: top 4 = Champions League, 5th = Europa League,
  // bottom 3 = relegation. A common approximation across the "big five".
  if (rank <= 4) return { key: "ucl", label: "Champions League", color: "var(--purple-bright)" };
  if (rank === 5) return { key: "uel", label: "Europa League", color: "var(--orange-bright)" };
  if (rank > totalTeams - 3) return { key: "rel", label: "Relegation", color: "#E0567A" };
  return null;
}

// football-data.org's response looks like:
// { competition: {...}, season: {...},
//   standings: [ { type: "TOTAL", table: [ {position, team, playedGames,
//     won, draw, lost, points, goalsFor, goalsAgainst, goalDifference,
//     form}, ... ] }, ... ] }
// Some competitions (rare on the free plan) also include HOME/AWAY splits
// as separate entries -- we only want the overall "TOTAL" table.
function mapStandings(raw, leagueId) {
  if (!raw || !raw.standings) return null;
  const totalGroup = raw.standings.find((s) => s.type === "TOTAL") || raw.standings[0];
  if (!totalGroup || !totalGroup.table) return null;
  const totalTeams = totalGroup.table.length;

  const rows = totalGroup.table.map((r) => {
    const zone = zoneForRank(leagueId, r.position, totalTeams);
    return clean({
      rank: r.position,
      team: clean({ id: r.team.id, name: r.team.shortName || r.team.name, logo: r.team.crest }),
      played: r.playedGames,
      won: r.won,
      draw: r.draw,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalsDiff: r.goalDifference,
      points: r.points,
      // Last 5 results, oldest to newest, as 'W'/'D'/'L' -- only present
      // when football-data.org's plan actually includes the `form` field;
      // never fabricated when it's missing.
      form: r.form ? r.form.split(",").map((s) => s.trim().charAt(0).toUpperCase()) : null,
      zoneKey: zone ? zone.key : null,
      zoneLabel: zone ? zone.label : null,
      zoneColor: zone ? zone.color : null,
    });
  });

  return clean({
    league: clean({
      id: raw.competition.id,
      name: raw.competition.name,
      logo: raw.competition.emblem,
      season: raw.season && raw.season.startDate ? raw.season.startDate.slice(0, 4) : null,
    }),
    standings: rows,
  });
}

module.exports = async (req, res) => {
  try {
    const { league } = req.query;
    if (!league) {
      res.status(400).json({ ok: false, error: "Missing league parameter." });
      return;
    }
    const code = LEAGUE_ID_TO_FD_CODE[league];
    if (!code) {
      res.status(200).json({ ok: false, error: `No football-data.org competition mapped for league ${league}.` });
      return;
    }
    const leagueId = Number(league);
    const requestedSeason = req.query.season ? parseInt(req.query.season, 10) : currentSeasonYear();

    // A brand-new season sometimes has no standings indexed yet, or the
    // plan only exposes the previous completed season. Try the requested
    // season first, then fall back one season automatically before giving
    // up, rather than showing "unavailable" for a season with no table yet.
    let raw = await getCached(`${code}-${requestedSeason}`, `/competitions/${code}/standings?season=${requestedSeason}`);
    let data = mapStandings(raw, leagueId);
    let seasonUsed = requestedSeason;
    if (!data && !req.query.season) {
      const fallbackSeason = requestedSeason - 1;
      raw = await getCached(`${code}-${fallbackSeason}`, `/competitions/${code}/standings?season=${fallbackSeason}`);
      data = mapStandings(raw, leagueId);
      seasonUsed = fallbackSeason;
    }

    if (!data) {
      res.status(200).json({
        ok: false,
        error: "Standings not available.",
        detail: `football-data.org returned no standings for ${code}, season ${requestedSeason}` +
          (seasonUsed !== requestedSeason ? ` (also tried ${seasonUsed})` : '') + '.',
      });
      return;
    }
    res.status(200).json({ ok: true, data, seasonUsed });
  } catch (err) {
    console.error("[/api/standings]", err.message);
    res.status(200).json({
      ok: false,
      error: "Standings are temporarily unavailable. Please try again shortly.",
      // Surfaced so the raw football-data.org/plan-restriction reason is
      // visible by opening /api/standings?league=39 directly, instead of
      // only in server logs -- useful while diagnosing plan-access issues.
      detail: err.message,
    });
  }
};
