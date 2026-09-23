// /api/scores.js
// Serverless function (Vercel-style: works with a plain (req, res) handler,
// zero dependencies — uses the built-in `fetch` available in the Node 18+
// runtime). Deploy this file inside an "api" folder at the root of your
// project and Vercel will automatically turn it into a serverless endpoint
// at /api/scores.
//
// WHAT THIS DOES
// - Talks to API-Football on the server, using your secret key from the
//   API_FOOTBALL_KEY environment variable. The key never reaches the browser.
// - Caches each distinct request (per date, and separately for "live") so
//   repeat visits and reloads reuse the same data instead of placing a new
//   request -- see the per-date TTLs further down.
// - Enforces a hard daily budget (see DAILY_BUDGET below) so this file can
//   never place more than its share of your plan's daily request limit,
//   no matter how much traffic the site gets. Once the budget is used up
//   for the day, it keeps serving the last data it fetched (even past its
//   normal TTL) until the budget resets at midnight UTC.
// - Reshapes API-Football's response into the simple shape the frontend
//   (index.html) already expects: { ok, fixtures, leagues, error }.
//
// NOTE ON THE CACHE: it lives in the function's memory, which persists
// while the serverless instance stays "warm" but resets on a cold start.
// For a personal/low-traffic site this keeps you comfortably within a
// free-tier daily limit. If you outgrow this later, swap the in-memory
// `cache` object below for a small persistent store (e.g. Vercel KV or
// Upstash Redis) — the rest of the file doesn't need to change.

const API_BASE = "https://v3.football.api-sports.io";
// If your API-Football key comes from RapidAPI instead of the API-Football
// dashboard directly, comment out the two lines below this note and use the
// RapidAPI block further down (see "RAPIDAPI ALTERNATIVE").
function buildHeaders() {
  return {
    "x-apisports-key": process.env.API_FOOTBALL_KEY,
  };
}

// ---- RAPIDAPI ALTERNATIVE ----------------------------------------------
// const API_BASE = "https://api-football-v1.p.rapidapi.com/v3";
// function buildHeaders() {
//   return {
//     "x-rapidapi-key": process.env.API_FOOTBALL_KEY,
//     "x-rapidapi-host": "api-football-v1.p.rapidapi.com",
//   };
// }
// -------------------------------------------------------------------------

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map(); // key -> { fetchedAt, data }
const inFlight = new Map(); // key -> Promise, de-dupes concurrent requests

// Status codes API-Football uses for matches currently being played.
const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE"]);

// Only these competitions are shown on the site (API-Football league IDs):
// Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League,
// Europa League, Brasileirão Série A, Primeira Liga, UEFA Nations League,
// Africa Cup of Nations - Qualification. Everything else gets filtered out
// server-side so the frontend never has to deal with leagues it doesn't want.
//
// NOTE ON THE LAST TWO (5, 36): these are international-team competitions
// added for MATCHES ONLY. They are intentionally left out of
// LEAGUE_ID_TO_FD_CODE in /api/standings.js, since football-data.org's free
// plan doesn't expose tables for them -- so scores show here, but no
// standings widget will (or should) try to fetch a table for these ids.
// Double-check these two ids after deploying (API-Football's ids can be
// confirmed via https://dashboard.api-football.com -> Ids -> Leagues, or by
// calling GET /leagues?search=nations%20league / ?search=africa%20cup with
// your key) since they weren't verified against your live account here.
const ALLOWED_LEAGUE_IDS = new Set([39, 140, 135, 78, 61, 2, 3, 71, 94, 5, 36]);

function mapFixture(item) {
  const status = item.fixture.status || {};
  return {
    id: item.fixture.id,
    date: item.fixture.date,
    statusShort: status.short,
    isLive: LIVE_STATUSES.has(status.short),
    minute: status.elapsed || null,
    league: {
      id: item.league.id,
      name: item.league.name,
      logo: item.league.logo,
    },
    home: {
      name: item.teams.home.name,
      logo: item.teams.home.logo,
      winner: item.teams.home.winner,
    },
    away: {
      name: item.teams.away.name,
      logo: item.teams.away.logo,
      winner: item.teams.away.winner,
    },
    goals: {
      home: item.goals.home,
      away: item.goals.away,
    },
  };
}

function buildLeaguesMap(fixtures) {
  const leagues = {};
  fixtures.forEach((f) => {
    leagues[f.league.id] = f.league.name;
  });
  return leagues;
}

// ---- Daily request budget ------------------------------------------------
// This file and /api/match.js are separate serverless functions on Vercel,
// each with their own isolated memory, so they can't share one counter --
// each is given its own slice of your 100-requests/day plan instead.
// Scores gets the bigger share since it's hit on every homepage visit.
// Once the budget for the day is used up, calls fall through to whatever
// is already cached (even if past its normal TTL) instead of ever placing
// another API-Football request -- so a slow trickle of stale-but-real data
// keeps showing instead of the day's quota being blown through.
const DAILY_BUDGET = 70;
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
      "Daily request budget reached for /api/scores; serving cached data until it resets."
    );
  }
  callsToday++;
  const res = await fetch(`${API_BASE}${path}`, { headers: buildHeaders() });
  if (!res.ok) {
    throw new Error(`API-Football request failed (${res.status})`);
  }
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(
      typeof json.errors === "string"
        ? json.errors
        : JSON.stringify(json.errors)
    );
  }
  return (json.response || [])
    .map(mapFixture)
    .filter((f) => ALLOWED_LEAGUE_IDS.has(f.league.id));
}

// Returns cached fixtures for a given cache key, refetching from
// API-Football only if the cache is missing or older than CACHE_TTL_MS.
async function getCached(key, path) {
  const cached = cache.get(key);
  const isFresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
  if (isFresh) return cached.data;

  if (inFlight.has(key)) return inFlight.get(key);

  const promise = callApiFootball(path)
    .then((data) => {
      cache.set(key, { fetchedAt: Date.now(), data });
      inFlight.delete(key);
      return data;
    })
    .catch((err) => {
      inFlight.delete(key);
      // If we have a stale cache, prefer serving it over a hard failure.
      if (cached) return cached.data;
      throw err;
    });

  inFlight.set(key, promise);
  return promise;
}

// ---- Season fixture-date lookup (drives the frontend's date navigator) --
// This is the fix for date navigation that used to be a generic, made-up
// calendar: instead of listing every calendar day, we ask API-Football for
// a WHOLE season's fixtures for one league in a single request, then keep
// only the list of distinct calendar dates that actually have a match.
// That real list is what the frontend steps through with Prev/Next, so
// navigation can only ever land on a day with real data for the
// competition(s) the visitor has selected -- never a generic or unrelated
// date. One request covers an entire season per league, so this is also
// far cheaper on the API quota than fetching date-by-date.
const SEASON_CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours -- season schedules rarely change within a day
const seasonCache = new Map(); // key `${leagueId}-${season}` -> { fetchedAt, dates: [...] }
const seasonInFlight = new Map();

function currentSeasonYear() {
  const now = new Date();
  const month = now.getUTCMonth() + 1; // 1-12
  // European club seasons start around July/August and are labelled by
  // their start year (e.g. the 2026-27 season is "season=2026").
  return month >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

async function getSeasonDates(leagueId, season) {
  const key = leagueId + "-" + season;
  const cached = seasonCache.get(key);
  const isFresh = cached && Date.now() - cached.fetchedAt < SEASON_CACHE_TTL_MS;
  if (isFresh) return cached.dates;

  if (seasonInFlight.has(key)) return seasonInFlight.get(key);

  const promise = callApiFootball(`/fixtures?league=${leagueId}&season=${season}`)
    .then((fixtures) => {
      const dateSet = new Set();
      fixtures.forEach((f) => {
        if (f.date) dateSet.add(f.date.slice(0, 10)); // YYYY-MM-DD
      });
      const dates = Array.from(dateSet).sort();
      seasonCache.set(key, { fetchedAt: Date.now(), dates });
      seasonInFlight.delete(key);
      return dates;
    })
    .catch((err) => {
      seasonInFlight.delete(key);
      // A stale list is still far more useful than none for navigation.
      if (cached) return cached.dates;
      throw err;
    });

  seasonInFlight.set(key, promise);
  return promise;
}

module.exports = async (req, res) => {
  try {
    const { view, date, league } = req.query;
    const leagueFilter = league && league !== "all" ? String(league) : null;

    let fixtures;

    if (view === "live") {
      fixtures = await getCached("live", "/fixtures?live=all");
      if (leagueFilter) {
        fixtures = fixtures.filter(
          (f) => String(f.league.id) === leagueFilter
        );
      }
      res.status(200).json({ ok: true, fixtures });
      return;
    }

    if (view === "date") {
      if (!date) {
        res.status(400).json({ ok: false, error: "Missing date parameter." });
        return;
      }
      fixtures = await getCached(`date:${date}`, `/fixtures?date=${date}`);
      const leagues = buildLeaguesMap(fixtures);
      const filtered = leagueFilter
        ? fixtures.filter((f) => String(f.league.id) === leagueFilter)
        : fixtures;
      res.status(200).json({ ok: true, fixtures: filtered, leagues });
      return;
    }

    if (view === "dates") {
      const season = req.query.season
        ? parseInt(req.query.season, 10)
        : currentSeasonYear();
      const leagueIds = leagueFilter
        ? [Number(leagueFilter)]
        : Array.from(ALLOWED_LEAGUE_IDS);

      // Fetched one league at a time (with a short pause between each),
      // not all 7 at once: most API-Football plans cap requests per
      // minute, and firing 7 season-sized requests simultaneously for the
      // "All Competitions" filter risks tripping that limit. This is also
      // why we catch each league's failure individually instead of one
      // Promise.all -- a single league failing (or being rate-limited)
      // no longer wipes out the whole date list, and if everything fails
      // the real API error is returned instead of a generic message.
      const dateSet = new Set();
      const errors = [];
      for (let i = 0; i < leagueIds.length; i++) {
        try {
          const list = await getSeasonDates(leagueIds[i], season);
          list.forEach((d) => dateSet.add(d));
        } catch (err) {
          console.error("[/api/scores dates]", leagueIds[i], err.message);
          errors.push(err.message);
        }
        if (i < leagueIds.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
      }
      const dates = Array.from(dateSet).sort();

      if (!dates.length && errors.length) {
        res.status(200).json({ ok: false, error: errors[0] });
        return;
      }
      res.status(200).json({ ok: true, season, dates, partial: errors.length > 0 });
      return;
    }

    res.status(400).json({ ok: false, error: "Unknown view parameter." });
  } catch (err) {
    console.error("[/api/scores]", err.message);
    res.status(200).json({
      ok: false,
      error: "Scores are temporarily unavailable. Please try again shortly.",
    });
  }
};
