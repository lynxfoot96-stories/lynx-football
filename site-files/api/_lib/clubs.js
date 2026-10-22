'use strict';
/**
 * Club data for the generic "any club" page (club.html). Used by api/player.js:
 *   /api/player?clubs=1     -> directory of every club in the supported competitions
 *   /api/player?club=<id>   -> one club: info + squad (football-data.org) + extras (TheSportsDB)
 *
 * Reuses your existing football-data.org key (API_FOOTBALL_STANDINGS_KEY).
 * Everything is cached in the shared cache (_lib/cache.js), so upstream calls are rare.
 */
const { cacheGet, cacheSet } = require('./cache');
const sdb = require('./sportsdb');

const FD = 'https://api.football-data.org/v4';
// site league id -> football-data.org code (same ids as api/standings.js)
const CODES = { 39: 'PL', 140: 'PD', 135: 'SA', 78: 'BL1', 61: 'FL1', 94: 'PPL', 71: 'BSA', 2: 'CL' };
const CODE_TO_ID = Object.fromEntries(Object.entries(CODES).map(([id, c]) => [c, Number(id)]));
const ORDER = [39, 140, 135, 78, 61, 94, 71, 2];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

async function fd(path, timeoutMs = 9000) {
  const key = process.env.API_FOOTBALL_STANDINGS_KEY;
  if (!key) throw new Error('API_FOOTBALL_STANDINGS_KEY is not set.');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(FD + path, { headers: { 'X-Auth-Token': key }, signal: ctrl.signal });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.message || `football-data.org ${res.status}`);
    return json;
  } finally { clearTimeout(t); }
}

/* ---------- directory ---------- */
async function directory() {
  const hit = await cacheGet('clubs:dir:v1');
  if (hit && hit.clubs) return hit.clubs;
  const byId = new Map();
  let failed = 0;
  // domestic leagues first so a club is labelled with its own league, then the Champions League
  for (const id of ORDER) {
    try {
      const r = await fd(`/competitions/${CODES[id]}/teams`);
      for (const t of r.teams || []) {
        if (!byId.has(t.id)) byId.set(t.id, { i: t.id, n: t.name, s: t.shortName || t.name, t: t.tla || '', c: t.crest || null, l: id });
      }
    } catch (e) { failed++; }
    await sleep(250);
  }
  const clubs = [...byId.values()];
  if (clubs.length) {
    // incomplete result? keep it only for an hour so the next visit tries again
    await cacheSet('clubs:dir:v1', { clubs }, failed ? 3600 : 7 * 24 * 3600);
    if (!failed) await cacheSet('clubs:dir:stale', { clubs }, 60 * 24 * 3600);
    return clubs;
  }
  const stale = await cacheGet('clubs:dir:stale');
  if (stale && stale.clubs) return stale.clubs;
  throw new Error('Club list unavailable.');
}

/* ---------- squad ---------- */
const POS = {
  'Goalkeeper': 'GK', 'Defence': 'DF', 'Centre-Back': 'CB', 'Left-Back': 'LB', 'Right-Back': 'RB',
  'Midfield': 'CM', 'Defensive Midfield': 'DM', 'Central Midfield': 'CM', 'Attacking Midfield': 'AM',
  'Left Midfield': 'LM', 'Right Midfield': 'RM', 'Offence': 'FW', 'Left Winger': 'LW', 'Right Winger': 'RW',
  'Centre-Forward': 'ST', 'Second Striker': 'SS',
};
function ageOf(dob) {
  const d = new Date(dob);
  if (!dob || isNaN(d.getTime())) return null;
  const n = new Date();
  let a = n.getUTCFullYear() - d.getUTCFullYear();
  if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--;
  return a;
}
function mapTeam(t) {
  const comps = (t.runningCompetitions || []).map((c) => CODE_TO_ID[c.code]).filter(Boolean);
  comps.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  return {
    id: t.id, name: t.name, shortName: t.shortName || t.name, tla: t.tla || null, crest: t.crest || null,
    founded: t.founded || null, venue: t.venue || null, address: t.address || null, website: t.website || null,
    colours: t.clubColors || null, comps,
    coach: t.coach && t.coach.name ? { name: t.coach.name, nationality: t.coach.nationality || null } : null,
    squad: (t.squad || []).map((p) => ({
      name: p.name, pos: POS[p.position] || (p.position ? String(p.position).slice(0, 3).toUpperCase() : '?'),
      nat: p.nationality || null, age: ageOf(p.dateOfBirth),
    })),
  };
}

/* ---------- TheSportsDB extras (best effort; free key cannot search clubs by name) ---------- */
function sameClub(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (s) => s.replace(/\b(fc|afc|cf|sc|ac|as|ssc|ud|cd|sv|vfb|vfl|fsv|1 fc|rcd|rc|calcio|club|de|futbol)\b/g, '').replace(/\s+/g, ' ').trim();
  const x = strip(a), y = strip(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}
async function resolveTsdbTeam(team, deadline) {
  const o = { deadline, timeoutMs: 6000 };
  const names = [team.name, team.shortName].filter((v, i, arr) => v && arr.indexOf(v) === i);
  for (const n of names) {                       // 1) direct name search (works for few clubs on the free key)
    const r = await sdb.searchTeams(n, o);
    const m = r.ok && r.teams.find((t) => sameClub(t.strTeam, team.name) || sameClub(t.strTeam, team.shortName));
    if (m) return String(m.idTeam);
  }
  const players = (team.squad || []).slice(0, 12);   // 2) find it through a player who plays there
  let tries = 0;
  for (const p of players) {
    if (tries >= 4 || deadline - Date.now() < 3000) break;
    tries++;
    const r = await sdb.searchPlayer(p.name, o);
    if (r.ok && r.player && r.player.clubId && (sameClub(r.player.club, team.name) || sameClub(r.player.club, team.shortName))) return r.player.clubId;
  }
  return null;
}
async function tsdbExtras(team) {
  const key = 'clubs:tsdb:' + team.id;
  const hit = await cacheGet(key);
  if (hit) return hit.extra || null;
  const deadline = Date.now() + 9000;
  let extra = null;
  try {
    const id = await resolveTsdbTeam(team, deadline);
    if (id) { const r = await sdb.getTeam(id, { deadline, timeoutMs: 6000 }); if (r.ok) extra = r.team; }
  } catch (_) { /* extras are optional */ }
  await cacheSet(key, { extra }, extra ? 30 * 24 * 3600 : 24 * 3600);
  return extra;
}

async function club(id) {
  const key = 'clubs:team:' + id;
  const hit = await cacheGet(key);
  if (hit && hit.team) return hit.team;
  let team;
  try {
    team = mapTeam(await fd('/teams/' + id));
  } catch (e) {
    const stale = await cacheGet('clubs:team-stale:' + id);
    if (stale && stale.team) return stale.team;
    throw e;
  }
  team.extra = await tsdbExtras(team);
  await cacheSet(key, { team }, 24 * 3600);
  await cacheSet('clubs:team-stale:' + id, { team }, 30 * 24 * 3600);
  return team;
}

async function handle(req, res) {
  const q = req.query || {};
  try {
    if (q.clubs !== undefined) {
      const clubs = await directory();
      res.setHeader('Cache-Control', 'public, s-maxage=3600');
      return res.status(200).json({ ok: true, clubs });
    }
    const id = parseInt(q.club, 10);
    if (!id) return res.status(400).json({ ok: false, error: 'club must be a numeric id' });
    const team = await club(id);
    res.setHeader('Cache-Control', 'public, s-maxage=1800');
    return res.status(200).json({ ok: true, club: team });
  } catch (e) {
    console.error('club error:', e.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: false, error: 'Club data is temporarily unavailable. Please try again shortly.', detail: e.message });
  }
}

module.exports = { handle, directory, club, sameClub };
