'use strict';
/**
 * Player photos from Wikipedia (lead image of the player's article), plus a
 * generated initials avatar for players with no safe photo.
 *
 * SAFETY RULES -- a wrong face is worse than no face, so a photo is accepted
 * only when ALL of these hold:
 *   - the page is a normal article (not a disambiguation / surname list),
 *   - its description says footballer / football player / soccer player,
 *   - if the description gives a birth year, it equals the player's real birth
 *     year (football-data.org supplies dateOfBirth),
 *   - the article title contains the player's surname,
 *   - the image URL is https on a *.wikimedia.org host.
 * Anything else -> no photo (the caller shows the initials avatar).
 *
 * CACHING (per player, shared by every competition the player appears in):
 *   fd-photo:{playerId}  found   -> 30 days
 *                        missing -> 3 days (then tried again)
 *   Network errors / rate limits are NOT cached, so they are retried next refresh.
 *
 * Wikimedia asks API clients to send a descriptive User-Agent with contact
 * info. Set WIKIMEDIA_CONTACT in Vercel (a website URL or an email address).
 */
const { cacheGet, cacheSet } = require('./cache');

const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const FOUND_TTL_SECONDS = 30 * 24 * 60 * 60;
const MISSING_TTL_SECONDS = 3 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 3000;

function userAgent() {
  return `FootballStories96/1.0 (${process.env.WIKIMEDIA_CONTACT || 'football statistics site'})`;
}

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Titles to try, most likely first (Wikipedia's own disambiguation naming). */
function candidateTitles(name, birthYear) {
  const base = String(name || '').trim().replace(/\s+/g, '_');
  if (!base) return [];
  const list = [base];
  if (birthYear) list.push(`${base}_(footballer,_born_${birthYear})`);
  list.push(`${base}_(footballer)`);
  return [...new Set(list)];
}

/** Only https wikimedia image URLs, query stripped, nothing that could break out of an HTML attribute. */
function safeImageUrl(u) {
  try {
    const url = new URL(String(u || ''));
    if (url.protocol !== 'https:' || !/(^|\.)wikimedia\.org$/i.test(url.hostname)) return null;
    url.search = '';
    url.hash = '';
    return url.toString().replace(/["'()\\\s<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  } catch (_) {
    return null;
  }
}

function isMatch(summary, name, birthYear) {
  if (!summary || summary.type !== 'standard') return false;
  const desc = String(summary.description || '');
  if (!/footballer|football player|soccer player/i.test(desc)) return false;
  const born = /born\s+(\d{4})/i.exec(desc);
  if (born && birthYear && Number(born[1]) !== Number(birthYear)) return false;
  const tokens = normalize(name).split(/\s+/).filter(Boolean);
  const surname = tokens[tokens.length - 1];
  const title = normalize(String(summary.title || '').replace(/\(.*\)/, ''));
  if (!surname || !title.includes(surname)) return false;
  return Boolean(summary.thumbnail && safeImageUrl(summary.thumbnail.source));
}

async function fetchSummary(title, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(WIKI_SUMMARY + encodeURIComponent(title), {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (res.status === 404) return { state: 'none' };
    if (!res.ok) return { state: 'error' }; // 429, 5xx, ...
    return { state: 'ok', body: await res.json() };
  } catch (_) {
    return { state: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

/** -> { state: 'found', url } | { state: 'missing' } | { state: 'error' } */
async function lookupOne(player, fetchImpl) {
  const birthYear = player.dob ? parseInt(String(player.dob).slice(0, 4), 10) : null;
  for (const title of candidateTitles(player.name, birthYear)) {
    const r = await fetchSummary(title, fetchImpl);
    if (r.state === 'error') return { state: 'error' };
    if (r.state === 'ok' && isMatch(r.body, player.name, birthYear)) {
      return { state: 'found', url: safeImageUrl(r.body.thumbnail.source) };
    }
  }
  return { state: 'missing' };
}

/** Cached lookup. Returns a URL string, or null when there is no (safe) photo right now. */
async function getPhoto(player, fetchImpl) {
  if (player.id === undefined || player.id === null) return null;
  const key = `fd-photo:${player.id}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached.u || null;

  const r = await lookupOne(player, fetchImpl);
  if (r.state === 'found') {
    await cacheSet(key, { u: r.url }, FOUND_TTL_SECONDS);
    return r.url;
  }
  if (r.state === 'missing') {
    await cacheSet(key, { u: '' }, MISSING_TTL_SECONDS);
  }
  return null; // 'error' is deliberately not cached
}

/**
 * Look up photos for many players within a time budget so a stats refresh can
 * never run long. Players not reached in time simply keep the initials avatar
 * and are retried on the next refresh.
 * @param {{id:number,name:string,dob?:string}[]} players
 * @returns {Promise<Map<number,string>>} id -> photo url (only players that have one)
 */
async function findPhotos(players, { budgetMs = 4000, concurrency = 4, fetchImpl = fetch } = {}) {
  const out = new Map();
  const queue = players.slice();
  const deadline = Date.now() + budgetMs;
  async function worker() {
    while (queue.length && Date.now() < deadline) {
      const p = queue.shift();
      try {
        const url = await getPhoto(p, fetchImpl);
        if (url) out.set(p.id, url);
      } catch (_) { /* never let one player break the list */ }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

// ---- Initials avatar (no external request, no licence question) ------------
function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  let s;
  if (parts.length >= 2) s = Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0];
  else if (parts.length === 1) s = Array.from(parts[0]).slice(0, 2).join('');
  else s = '?';
  return s.toLocaleUpperCase();
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}

/** A small SVG as a data: URL, safe to drop into an <img src="..."> attribute. */
function initialsAvatar(name) {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<rect width="64" height="64" fill="#2b2f3d"/>' +
    '<text x="32" y="33" dy=".35em" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="700" fill="#d7dae6">' +
    escapeXml(initials(name)) +
    '</text></svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

module.exports = { findPhotos, getPhoto, initials, initialsAvatar, candidateTitles, isMatch, safeImageUrl };
