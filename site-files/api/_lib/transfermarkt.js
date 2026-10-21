'use strict';
/**
 * Thin client for the Transfermarkt community API
 *   (project: https://github.com/felipeall/transfermarkt-api)
 *
 * By default it talks to the public demo at https://transfermarkt-api.fly.dev,
 * which is rate-limited (2 requests / 3 seconds) and can be asleep or blocked.
 * To switch to your own hosted copy later, just set the environment variable
 * TM_API_BASE in Vercel (e.g. https://my-tm-api.onrender.com) -- no code change.
 *
 * Every request works against a shared DEADLINE so the whole player fetch
 * always finishes before Vercel's function limit (25s) kills it.
 * Failures are returned as { ok: false, error } and never thrown.
 */

const BASE_URL = (process.env.TM_API_BASE || 'https://transfermarkt-api.fly.dev').replace(/\/+$/, '');
const DEFAULT_TIMEOUT_MS = 10000;
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

/**
 * opts.deadline  = timestamp (ms) by which everything must be finished
 * opts.timeoutMs = max time for this single call
 * Retries once (after 1.5s) on 429/503 if there is still time left.
 */
async function tmGet(path, opts = {}) {
  const deadline = opts.deadline || Date.now() + 20000;
  const perCall = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  let last = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining < 1500) return last || { ok: false, error: SLOW_MSG };
    last = await once(path, Math.min(perCall, remaining));
    if (last.retry && attempt === 0) { await sleep(1500); continue; }
    return last;
  }
  return last;
}

/** GET /players/search/{name}?page_number=1 -> first matching player, or null. */
async function searchPlayer(name, opts) {
  const r = await tmGet(`/players/search/${encodeURIComponent(name)}?page_number=1`, opts);
  if (!r.ok) return { ok: false, error: r.error || `search failed (${r.status || 'network'})` };
  const list = r.data.results || r.data.players || (Array.isArray(r.data) ? r.data : []);
  if (!list.length) return { ok: true, player: null };
  const top = list[0];
  return {
    ok: true,
    player: {
      id: String(top.id || top.playerId || top.player_id || ''),
      name: top.name || top.playerName || name,
      club: (top.club && (top.club.name || top.club)) || top.currentClub || null,
      photoUrl: top.image || top.imageUrl || null,
    },
  };
}

/** GET /players/{id}/profile */
async function getProfile(id, opts) {
  const r = await tmGet(`/players/${encodeURIComponent(id)}/profile`, opts);
  if (!r.ok) return { ok: false, error: r.error || `profile failed (${r.status || 'network'})` };
  const d = r.data || {};
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

/** GET /players/{id}/market_value */
async function getMarketValue(id, opts) {
  const r = await tmGet(`/players/${encodeURIComponent(id)}/market_value`, opts);
  if (!r.ok) return { ok: false, error: r.error || `market_value failed (${r.status || 'network'})` };
  const d = r.data || {};
  let current = d.marketValue || d.value || null;
  if (!current && Array.isArray(d.marketValueHistory) && d.marketValueHistory.length) {
    const last = d.marketValueHistory[d.marketValueHistory.length - 1];
    current = last.value || last.marketValue;
  }
  return { ok: true, marketValue: current || null, updatedAt: d.updatedAt || null };
}

/** GET /players/{id}/transfers */
async function getTransfers(id, opts) {
  const r = await tmGet(`/players/${encodeURIComponent(id)}/transfers`, opts);
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
