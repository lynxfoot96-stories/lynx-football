// /api/scores.js
const API_BASE = "https://v3.football.api-sports.io";

function buildHeaders() {
  return {
    "x-apisports-key": process.env.API_FOOTBALL_KEY,
  };
}

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const cache = new Map();
const inFlight = new Map();

const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "BT", "P", "LIVE"]);
const ALLOWED_LEAGUE_IDS = new Set([39, 140, 135, 78, 61, 2, 3, 71, 94, 5, 29]);

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
      if (cached) return cached.data;
      throw err;
    });

  inFlight.set(key, promise);
  return promise;
}

const SEASON_CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const seasonCache = new Map();
const seasonInFlight = new Map();

function currentSeasonYear() {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
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
        if (f.date) dateSet.add(f.date.slice(0, 10));
      });
      const dates = Array.from(dateSet).sort();
      seasonCache.set(key, { fetchedAt: Date.now(), dates });
      seasonInFlight.delete(key);
      return dates;
    })
    .catch((err) => {
      seasonInFlight.delete(key);
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

    let fixtures = [];

    if (view === "live") {
      try {
        fixtures = await getCached("live", "/fixtures?live=all");
        if (leagueFilter) {
          fixtures = fixtures.filter(
            (f) => String(f.league.id) === leagueFilter
          );
        }
      } catch (err) {
        console.warn("[/api/scores] Live fixtures fetch failed:", err.message);
      }
      res.status(200).json({ ok: true, fixtures });
      return;
    }

    if (view === "date") {
      if (!date) {
        res.status(400).json({ ok: false, error: "Missing date parameter." });
        return;
      }
      try {
        fixtures = await getCached(`date:${date}`, `/fixtures?date=${date}`);
      } catch (err) {
        console.warn(`[/api/scores] Date ${date} fetch failed:`, err.message);
      }
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

      res.status(200).json({ ok: true, season, dates, partial: errors.length > 0 });
      return;
    }

    res.status(400).json({ ok: false, error: "Unknown view parameter." });
  } catch (err) {
    console.error("[/api/scores]", err.message);
    res.status(200).json({
      ok: false,
      fixtures: [],
      error: "Scores are temporarily unavailable. Please try again shortly.",
    });
  }
};