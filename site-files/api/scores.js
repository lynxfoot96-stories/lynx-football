'use strict';
/**
 * GET /api/scores?view=date&date=YYYY-MM-DD&league=all|<id>[&tz=Europe/Lisbon]
 * GET /api/scores?view=live&league=all|<id>
 *
 * Self-contained on purpose: no local requires, so there is nothing for Vercel
 * to fail to resolve. Data source: API-Football (v3.football.api-sports.io).
 *
 * Env: API_FOOTBALL_KEY  (use the same variable name your api/match.js uses)
 * Response: { ok: true, fixtures: [...], leagues: { [id]: name } } or { ok: false, error }
 */
const API_BASE = 'https://v3.football.api-sports.io';

// Must match the <select> options in index.html / GROUP_ORDER in matches.html
const LEAGUES = {
  39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
  2: 'Champions League', 3: 'Europa League', 71: 'Brasileirão Série A', 94: 'Primeira Liga',
  5: 'UEFA Nations League', 29: 'Africa Cup of Nations - Qualification',
};

const LIVE_STATUSES = new Set(['1H', '2H', 'ET', 'BT', 'P', 'LIVE']); // HT is shown as "HT", not live
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Small in-memory cache per warm instance (saves API quota); CDN cache is set below.
const memo = new Map();
function memoGet(key, ttlMs) {
  const hit = memo.get(key);
  return hit && Date.now() - hit.at < ttlMs ? hit.value : null;
}

async function apiGet(path, params) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error('API_FOOTBALL_KEY is not set');
  const url = `${API_BASE}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  const json = await res.json();
  const errs = json.errors && (Array.isArray(json.errors) ? json.errors : Object.values(json.errors));
  if (errs && errs.length) throw new Error(`API-Football: ${errs.join('; ')}`);
  return json.response || [];
}

function normalise(item) {
  const f = item.fixture || {};
  const st = (f.status && f.status.short) || '';
  return {
    id: f.id,
    date: f.date,
    statusShort: st,
    minute: f.status ? f.status.elapsed : null,
    isLive: LIVE_STATUSES.has(st),
    league: { id: item.league.id, name: item.league.name, logo: item.league.logo },
    home: { id: item.teams.home.id, name: item.teams.home.name, logo: item.teams.home.logo, winner: item.teams.home.winner },
    away: { id: item.teams.away.id, name: item.teams.away.name, logo: item.teams.away.logo, winner: item.teams.away.winner },
    goals: { home: item.goals.home, away: item.goals.away },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const q = req.query || {};
  const view = q.view === 'live' ? 'live' : 'date';
  const league = String(q.league || 'all');
  if (league !== 'all' && !LEAGUES[league]) return res.status(400).json({ ok: false, error: 'Unknown league' });

  const params = {};
  let ttl;
  if (view === 'live') {
    params.live = league === 'all' ? Object.keys(LEAGUES).join('-') : league;
    ttl = 30 * 1000;
  } else {
    const date = String(q.date || '');
    if (!DATE_RE.test(date)) return res.status(400).json({ ok: false, error: 'date must be YYYY-MM-DD' });
    params.date = date;
    if (league !== 'all') { params.league = league; params.season = q.season || ''; }
    if (q.tz && /^[A-Za-z_]+\/[A-Za-z_\-]+$/.test(String(q.tz))) params.timezone = String(q.tz);
    ttl = 5 * 60 * 1000;
  }

  try {
    // API-Football requires `season` with `league`; derive it when not supplied.
    if (params.league && !params.season) {
      const d = new Date(params.date + 'T00:00:00Z');
      params.season = String(d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1);
    }
    if (params.league && [71].includes(Number(params.league))) {
      params.season = params.date.slice(0, 4); // calendar-year season (Brasileirão)
    }

    const cacheKey = JSON.stringify([view, params]);
    let fixtures = memoGet(cacheKey, ttl);
    if (!fixtures) {
      const raw = await apiGet('/fixtures', params);
      fixtures = raw.filter(i => LEAGUES[i.league.id]).map(normalise);
      memo.set(cacheKey, { at: Date.now(), value: fixtures });
    }
    res.setHeader('Cache-Control', `public, s-maxage=${Math.round(ttl / 1000)}, stale-while-revalidate=${view === 'live' ? 30 : 300}`);
    return res.status(200).json({ ok: true, fixtures, leagues: LEAGUES });
  } catch (err) {
    console.error('scores error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: 'Upstream error' });
  }
};
