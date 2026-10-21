'use strict';
/**
 * Thin client for the Transfermarkt community API's public demo:
 *   https://transfermarkt-api.fly.dev
 * (project: https://github.com/felipeall/transfermarkt-api)
 *
 * This is a public, rate-limited "testing only" deployment (2 requests /
 * 3 seconds per client IP, per its own README) -- it is NOT self-hosted by
 * this site. Only called from api/player.js, on-demand, the first time a
 * visitor opens a given player (see _lib/playersDb.js for the cache that
 * makes every later visit free). Never called from the browser directly.
 *
 * The upstream JSON schema is undocumented and can change without notice,
 * so every field read here is read defensively (several possible key names
 * tried, missing data left as null rather than guessed) -- see README notes
 * in the project for the field-name caveats. Confirm exact field names
 * against a live response after first deploy and adjust FIELD GUESSES below
 * if something consistently comes back empty.
 */

const BASE_URL = 'https://transfermarkt-api.fly.dev';
const REQUEST_TIMEOUT_MS = 9000;

async function tmGet(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
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
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

/** GET /players/search/{name}?page_number=1 -> first matching player's id + name + club, or null. */
async function searchPlayer(name) {
  const r = await tmGet(`/players/search/${encodeURIComponent(name)}?page_number=1`);
  if (!r.ok) return { ok: false, error: r.error || `search failed (${r.status || 'network'})` };
  // FIELD GUESS: the search response has historically been { results: [...] } with each
  // result carrying an "id" and a "name" -- try a couple of likely shapes defensively.
  const list = r.data.results || r.data.players || (Array.isArray(r.data) ? r.data : []);
  if (!list.length) return { ok: true, player: null };
  const top = list[0];
  return {
    ok: true,
    player: {
      id: String(top.id || top.playerId || top.player_id || ''),
      name: top.name || top.playerName || name,
      club: (top.club && (top.club.name || top.club)) || top.currentClub || null,
    },
  };
}

/** GET /players/{id}/profile -> full name, DOB/age, nationality, position, current club, photo. */
async function getProfile(id) {
  const r = await tmGet(`/players/${encodeURIComponent(id)}/profile`);
  if (!r.ok) return { ok: false, error: r.error || `profile failed (${r.status || 'network'})` };
  const d = r.data;
  const club = d.club || d.currentClub || {};
  return {
    ok: true,
    profile: {
      name: d.name || d.fullName || null,
      dateOfBirth: d.dateOfBirth || d.dob || null,
      age: d.age != null ? Number(d.age) : null,
      nationality: Array.isArray(d.citizenship) ? d.citizenship[0] : (d.nationality || d.citizenship || null),
      position: (d.position && (d.position.main || d.position)) || d.mainPosition || null,
      photoUrl: d.imageUrl || d.photo || d.picture || null,
      currentClub: club.name || club.club || null,
      currentClubTmId: club.id != null ? String(club.id) : null,
      shirtNumber: d.shirtNumber != null ? String(d.shirtNumber) : (d.number != null ? String(d.number) : null),
      updatedAt: d.updatedAt || null,
    },
  };
}

/** GET /players/{id}/market_value -> current estimated market value, formatted + raw. */
async function getMarketValue(id) {
  const r = await tmGet(`/players/${encodeURIComponent(id)}/market_value`);
  if (!r.ok) return { ok: false, error: r.error || `market_value failed (${r.status || 'network'})` };
  const d = r.data;
  // FIELD GUESS: recent history is often under marketValueHistory[]; the current value
  // sometimes also appears at the top level. Prefer an explicit "current" field, else the
  // most recent history entry.
  let current = d.marketValue || d.value || null;
  if (!current && Array.isArray(d.marketValueHistory) && d.marketValueHistory.length) {
    current = d.marketValueHistory[d.marketValueHistory.length - 1].value || d.marketValueHistory[d.marketValueHistory.length - 1].marketValue;
  }
  return { ok: true, marketValue: current || null, updatedAt: d.updatedAt || null };
}

/** GET /players/{id}/transfers -> chronological transfer history (club, date, fee, type). */
async function getTransfers(id) {
  const r = await tmGet(`/players/${encodeURIComponent(id)}/transfers`);
  if (!r.ok) return { ok: false, error: r.error || `transfers failed (${r.status || 'network'})` };
  const list = r.data.transfers || (Array.isArray(r.data) ? r.data : []);
  const transfers = list.map((t) => ({
    date: t.date || t.transferDate || null,
    fromClub: (t.from && (t.from.name || t.from.club)) || t.fromClub || null,
    toClub: (t.to && (t.to.name || t.to.club)) || t.toClub || null,
    fee: t.fee || t.marketValue || null,
    type: t.type || t.transferType || null,
  }));
  return { ok: true, transfers, updatedAt: r.data.updatedAt || null };
}

module.exports = { searchPlayer, getProfile, getMarketValue, getTransfers };
