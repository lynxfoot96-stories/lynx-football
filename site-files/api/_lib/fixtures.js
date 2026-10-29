'use strict';
// Fetches ONE day of fixtures for the Weekend Preview email.
// Lives in _lib so it does not count as a Vercel function.
//
// API-Football budget: it reads the SAME Redis cache key that api/scores.js uses
// ("scores:" + the request), so if website visitors already loaded that day in the
// last 25 minutes, the email costs 0 calls. Otherwise it costs exactly 1 call for that day.
// A weekly email = at most 2 calls per week (Saturday + Sunday), out of your 100/day.
// If API-Football fails, it falls back to the snapshot that api/scores.js saves for visitors.

const { cacheGet, cacheSet, acquireLock, releaseLock } = require('./cache');

const API_BASE = 'https://v3.football.api-sports.io';
const SCORES_TTL_SECONDS = 25 * 60;

// Must stay identical to LEAGUES in api/scores.js
const LEAGUES = {
  39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
  2: 'Champions League', 3: 'Europa League', 71: 'Brasileirão Série A', 94: 'Primeira Liga',
  5: 'UEFA Nations League', 29: 'Africa Cup of Nations - Qualification',
};
const LIVE_STATUSES = new Set(['1H', '2H', 'ET', 'BT', 'P', 'LIVE']);

async function apiGet(path, params) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY is not set');
  const res = await fetch(API_BASE + path + '?' + new URLSearchParams(params), {
    headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('API-Football HTTP ' + res.status);
  const json = await res.json();
  const errs = json.errors && (Array.isArray(json.errors) ? json.errors : Object.values(json.errors));
  if (errs && errs.length) throw new Error('API-Football: ' + errs.join('; '));
  return json.response || [];
}

// Same shape as normalise() in api/scores.js
function normalise(item) {
  const f = item.fixture || {};
  const st = (f.status && f.status.short) || '';
  return {
    id: f.id, date: f.date, statusShort: st,
    minute: f.status ? f.status.elapsed : null,
    isLive: LIVE_STATUSES.has(st),
    league: { id: item.league.id, name: item.league.name, logo: item.league.logo },
    home: { id: item.teams.home.id, name: item.teams.home.name, logo: item.teams.home.logo, winner: item.teams.home.winner },
    away: { id: item.teams.away.id, name: item.teams.away.name, logo: item.teams.away.logo, winner: item.teams.away.winner },
    goals: { home: item.goals.home, away: item.goals.away },
  };
}

/** @param {string} date  YYYY-MM-DD (UTC day, exactly like the website sends it)
 *  @returns {{fixtures: Array|null, source: string}} */
async function fixturesForDate(date) {
  // Exactly the key api/scores.js builds for ?view=date&date=...  (no tz parameter)
  const cacheKey = 'scores:' + JSON.stringify(['date', { date: date }]);
  let cached = await cacheGet(cacheKey);
  if (Array.isArray(cached)) return { fixtures: cached, source: 'site-cache' };

  const token = await acquireLock(cacheKey, 20);
  try {
    if (token) {
      cached = await cacheGet(cacheKey); // someone may have just filled it
      if (Array.isArray(cached)) return { fixtures: cached, source: 'site-cache' };
      try {
        const raw = await apiGet('/fixtures', { date: date });
        const fixtures = raw.filter(function (i) { return LEAGUES[i.league.id]; }).map(normalise);
        await cacheSet(cacheKey, fixtures, SCORES_TTL_SECONDS);   // visitors reuse it too
        await cacheSet('newsletter:fixtures:' + date, fixtures, 9 * 24 * 60 * 60);
        return { fixtures: fixtures, source: 'api-football' };
      } catch (e) {
        console.error('preview fixtures fetch failed', date, e && e.message);
      }
    } else {
      // A visitor is fetching this exact day right now: wait briefly for their result.
      for (let i = 0; i < 8; i++) {
        await new Promise(function (r) { setTimeout(r, 500); });
        cached = await cacheGet(cacheKey);
        if (Array.isArray(cached)) return { fixtures: cached, source: 'site-cache' };
      }
    }
  } finally {
    if (token) await releaseLock(cacheKey, token);
  }
  // Last resort: the snapshot saved when a visitor loaded that day.
  const snap = await cacheGet('newsletter:fixtures:' + date);
  if (Array.isArray(snap)) return { fixtures: snap, source: 'snapshot' };
  return { fixtures: null, source: 'none' };
}

module.exports = { fixturesForDate, LEAGUES };
