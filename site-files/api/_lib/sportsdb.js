'use strict';
/**
 * Client for TheSportsDB (https://www.thesportsdb.com/documentation), used ONLY
 * for the player page. Scores, standings, matches etc. are untouched.
 *
 * Exposes the same four functions the old Transfermarkt client had, so
 * api/player.js works the same way:
 *   searchPlayer, getProfile, getMarketValue, getTransfers
 *
 * Free key is "123" (30 requests/minute, shared by everybody using it).
 * To use your own key later, set TSDB_API_KEY in Vercel (no code change).
 *
 * What TheSportsDB does NOT provide: market value and transfer fees.
 * Those fields are left empty (never guessed); the page shows them as unavailable.
 *
 * All calls share a deadline so the whole fetch finishes inside Vercel's 25s limit.
 * Failures are returned as { ok: false, error }, never thrown.
 */

const API_KEY = process.env.TSDB_API_KEY || '123';
const BASE_URL = `https://www.thesportsdb.com/api/v1/json/${API_KEY}`;
const DEFAULT_TIMEOUT_MS = 10000;
const BUSY_MSG = 'The player data source is busy right now (too many requests). Please try again in a minute.';
const SLOW_MSG = 'The player data source is slow right now. Please try again in a minute.';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function once(path, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (res.status === 404) return { ok: false, notFound: true };
    if (res.status === 429 || res.status === 503) return { ok: false, retry: true, status: res.status };
    if (!res.ok) return { ok: false, status: res.status };
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, status: res.status };
    return { ok: true, data: json };
  } catch (e) {
    return { ok: false, error: e.name === 'AbortError' ? SLOW_MSG : e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** opts.deadline = ms timestamp to finish by; opts.timeoutMs = max for this call.
 *  On 429/503 (rate limit) it waits and retries up to 3 times while the deadline allows. */
async function sdbGet(path, opts = {}) {
  const deadline = opts.deadline || Date.now() + 20000;
  const perCall = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const waits = [2500, 5000];
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1500) return last || { ok: false, error: SLOW_MSG };
    last = await once(path, Math.min(perCall, remaining));
    if (last.retry && attempt < 2 && deadline - Date.now() > waits[attempt] + 2000) { await sleep(waits[attempt]); continue; }
    if (last.retry) return { ok: false, status: last.status, error: BUSY_MSG };
    return last;
  }
  return last;
}

/** TheSportsDB uses placeholder team names like "_Free Agent Soccer" / "_Retired Soccer". */
function cleanTeam(team, status) {
  if (!team) return null;
  if (String(team).startsWith('_')) {
    const s = String(status || '').toLowerCase();
    if (s.includes('free')) return 'Free agent';
    if (s.includes('retired')) return 'Retired';
    return null;
  }
  return team;
}

function ageFromDob(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age--;
  return age >= 0 && age < 70 ? age : null;
}

function photoOf(p) {
  if (p.strThumb) return `${p.strThumb}/medium`;
  return p.strCutout || null;
}

/** searchplayers.php?p=<name>  (free tier returns the single best match) */
async function searchPlayer(name, opts) {
  const r = await sdbGet(`/searchplayers.php?p=${encodeURIComponent(name)}`, opts);
  if (!r.ok) return { ok: false, error: r.error || `search failed (${r.status || 'network'})` };
  const list = Array.isArray(r.data.player) ? r.data.player : [];
  // Only footballers: the same name can exist in other sports.
  const top = list.find((p) => !p.strSport || p.strSport === 'Soccer');
  if (!top) return { ok: true, player: null };
  return {
    ok: true,
    player: {
      id: String(top.idPlayer || ''),
      name: top.strPlayer || name,
      club: cleanTeam(top.strTeam, top.strStatus),
      clubId: top.strTeam && !String(top.strTeam).startsWith('_') && top.idTeam ? String(top.idTeam) : null,
      photoUrl: photoOf(top),
    },
  };
}

/** lookupplayer.php?id=<id> */
async function getProfile(id, opts) {
  const r = await sdbGet(`/lookupplayer.php?id=${encodeURIComponent(id)}`, opts);
  if (!r.ok) return { ok: false, error: r.error || `profile failed (${r.status || 'network'})` };
  const p = Array.isArray(r.data.players) ? r.data.players[0] : null;
  if (!p) return { ok: false, error: 'profile not found' };
  const dob = p.dateBorn && p.dateBorn !== '0000-00-00' ? p.dateBorn : null;
  return {
    ok: true,
    profile: {
      name: p.strPlayer || null,
      dateOfBirth: dob,
      age: ageFromDob(dob),
      nationality: p.strNationality || null,
      position: p.strPosition || null,
      photoUrl: photoOf(p),
      currentClub: cleanTeam(p.strTeam, p.strStatus),
      currentClubTmId: null, // TheSportsDB ids are not Transfermarkt ids
      shirtNumber: p.strNumber ? String(p.strNumber) : null,
      updatedAt: null,
    },
  };
}

/** lookupteam.php?id=<teamId> -> the club's badge (logo) URL, or null. */
async function getTeamBadge(teamId, opts) {
  if (!teamId) return { ok: true, badge: null };
  const r = await sdbGet(`/lookupteam.php?id=${encodeURIComponent(teamId)}`, opts);
  if (!r.ok) return { ok: false, error: r.error || `team failed (${r.status || 'network'})` };
  const t = Array.isArray(r.data.teams) ? r.data.teams[0] : null;
  return { ok: true, badge: (t && t.strBadge) || null };
}

/** TheSportsDB has no market values. Returns "no data" without any network call. */
async function getMarketValue() {
  return { ok: true, marketValue: null, updatedAt: null };
}

/**
 * lookupformerteams.php?id=<id> -> clubs the player was at, with years only.
 * Turned into a simple club-to-club career list (no fees available).
 */
async function getTransfers(id, opts) {
  const r = await sdbGet(`/lookupformerteams.php?id=${encodeURIComponent(id)}`, opts);
  if (!r.ok) return { ok: false, error: r.error || `transfers failed (${r.status || 'network'})` };
  const list = (Array.isArray(r.data.formerteams) ? r.data.formerteams : [])
    .filter((t) => t && t.strFormerTeam)
    .sort((a, b) => (parseInt(a.strJoined, 10) || 0) - (parseInt(b.strJoined, 10) || 0));

  const transfers = [];
  let prev = null, prevBadge = null;
  for (const t of list) {
    transfers.push({
      date: t.strJoined || null,
      fromClub: prev,
      toClub: t.strFormerTeam,
      fromBadge: prevBadge,
      toBadge: t.strBadge || null,
      departed: t.strDeparted || null,
      fee: null,
      type: t.strMoveType || null,
    });
    prev = t.strFormerTeam;
    prevBadge = t.strBadge || null;
  }
  // Newest first looks natural on a transfer list.
  transfers.reverse();
  return { ok: true, transfers, updatedAt: null };
}

/** searchteams.php?t=<name> (free key: very limited; may return nothing). */
async function searchTeams(name, opts) {
  const r = await sdbGet(`/searchteams.php?t=${encodeURIComponent(name)}`, opts);
  if (!r.ok) return { ok: false, error: r.error || 'team search failed' };
  return { ok: true, teams: (Array.isArray(r.data.teams) ? r.data.teams : []).filter((t) => !t.strSport || t.strSport === 'Soccer') };
}

/** lookupteam.php?id= -> club info for the Overview tab (all optional). */
async function getTeam(id, opts) {
  const r = await sdbGet(`/lookupteam.php?id=${encodeURIComponent(id)}`, opts);
  if (!r.ok) return { ok: false, error: r.error || 'team lookup failed' };
  const t = Array.isArray(r.data.teams) ? r.data.teams[0] : null;
  if (!t) return { ok: false, error: 'team not found' };
  const url = (u) => (u ? (/^https?:\/\//i.test(u) ? u : 'https://' + u) : null);
  return {
    ok: true,
    team: {
      id: String(t.idTeam || id),
      name: t.strTeam || null,
      badge: t.strBadge || null,
      banner: t.strBanner || t.strFanart1 || null,
      kit: t.strEquipment || null,
      stadium: t.strStadium || null,
      location: t.strLocation || null,
      formedYear: t.intFormedYear ? String(t.intFormedYear) : null,
      colours: [t.strColour1, t.strColour2, t.strColour3].filter((c) => /^#?[0-9a-f]{3,6}$/i.test(c || '')).map((c) => (c[0] === '#' ? c : '#' + c)),
      website: url(t.strWebsite),
      facebook: url(t.strFacebook),
      twitter: url(t.strTwitter),
      instagram: url(t.strInstagram),
      description: t.strDescriptionEN || null,
    },
  };
}

module.exports = { searchPlayer, getProfile, getMarketValue, getTransfers, getTeamBadge, searchTeams, getTeam };
