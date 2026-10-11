'use strict';
/**
 * Player photos: a manually-curated database first, then Wikipedia (the lead
 * image of the player's article), then a generated initials avatar for
 * anyone neither source has a safe photo for.
 *
 * LOOKUP ORDER (per player, cheapest/most-trusted first):
 *   1. Redis cache (fd-photo:{playerId}) -- whatever won last time, found or
 *      missing, is reused until its TTL expires. This already covers BOTH
 *      curated and Wikipedia hits, so a curated match is cached exactly like
 *      a Wikipedia one and costs nothing on repeat requests.
 *   2. Curated local database (./player-photos.json, see below) -- manually
 *      verified photos you've added by hand. Checked before Wikipedia
 *      because it's trusted by construction and is usually the first place
 *      a photo shows up after a transfer (Wikipedia can lag).
 *   3. Wikipedia lookup (unchanged from before -- see SAFETY RULES below).
 *   4. Nothing found -> caller (api/stats.js) shows the initials avatar.
 *
 * CURATED DATABASE (public/player-photos.json):
 *   An array of { name, club, competition, season, goals, imagePath,
 *   attribution, license, verified }. Loaded with `require()` (not
 *   fs.readFileSync) so Vercel's build traces the dependency and bundles the
 *   JSON into the serverless function automatically -- no vercel.json
 *   "includeFiles" needed. It's also still a normal file under public/, so
 *   it's served as a static asset too if you ever want to inspect it from
 *   the browser.
 *
 *   MATCHING: players are looked up by normalized name (diacritics/case/
 *   punctuation stripped). A transfer is fine as long as the name matches --
 *   club is only used to pick between two curated entries that share a
 *   name (see normalizeClub/clubsMatch below), never to reject a match.
 *   Loaded and indexed once per cold start (module-level cache).
 *
 * SAFETY RULES (Wikipedia pass only; the curated DB is trusted because it
 * was verified by hand, not auto-matched) -- a wrong face is worse than no
 * face, so a Wikipedia photo is accepted only when ALL of these hold:
 *   - the page is a normal article (not a disambiguation / surname list),
 *   - its description says footballer / football player / soccer player,
 *   - if the description gives a birth year, it equals the player's real birth
 *     year (football-data.org supplies dateOfBirth),
 *   - the article title contains the player's surname,
 *   - the image URL is https on a *.wikimedia.org host.
 * Anything else -> no photo (the caller shows the initials avatar).
 *
 * LOOKUP STRATEGY (two passes per player, Wikipedia only):
 *   1. Direct title guesses from the player's name as given by the data
 *      provider (candidateTitles) -- fast, no extra request, works whenever
 *      the provider's name already matches the Wikipedia article title.
 *   2. Wikipedia's own search API (searchTitles) -- tried only if every
 *      direct guess misses. This covers cases where the data provider's name
 *      differs from the common Wikipedia title (e.g. a player's full legal
 *      name vs. the nickname Wikipedia uses as its article title). Results
 *      from search go through the exact same isMatch() safety check as
 *      direct guesses -- nothing here loosens the matching criteria, it only
 *      widens which titles get checked against them.
 * Every attempt (both passes) is logged via console.log('[photo]', ...) so
 * a refresh's outcome per player is visible in the Vercel function logs.
 * Remove or comment out those console.log lines once you've confirmed things
 * are working the way you expect, if you'd rather not log on every refresh.
 *
 * CACHING (per player, shared by every competition the player appears in):
 *   fd-photo:{playerId}  found   -> 30 days  (curated hits use the same TTL)
 *                        missing -> 3 days (then tried again)
 *   Network errors / rate limits are NOT cached, so they are retried next refresh.
 *
 *   NOTE: if you're re-testing this after a previous "missing" result got
 *   cached (e.g. during earlier debugging), that player will keep showing no
 *   photo for up to 3 days regardless of code changes, until the cache entry
 *   expires. Either wait it out, temporarily lower MISSING_TTL_SECONDS below,
 *   or manually delete the relevant `fd-photo:{playerId}` key(s) in your
 *   Redis/Upstash dashboard before testing. The same applies if you add/edit
 *   an entry in player-photos.json for a player who was already cached as
 *   "missing" or with a Wikipedia photo -- delete that key to pick it up
 *   immediately.
 *
 * Wikimedia asks API clients to send a descriptive User-Agent with contact
 * info. Set WIKIMEDIA_CONTACT in Vercel (a website URL or an email address).
 */
const { cacheGet, cacheSet } = require('./cache');

const WIKI_SUMMARY = 'https://en.wikipedia.org/api/rest_v1/page/summary/';
const WIKI_SEARCH = 'https://en.wikipedia.org/w/api.php';
const FOUND_TTL_SECONDS = 30 * 24 * 60 * 60;
const MISSING_TTL_SECONDS = 3 * 24 * 60 * 60;
const REQUEST_TIMEOUT_MS = 3000;

function userAgent() {
  return `FootballStories96/1.0 (${process.env.WIKIMEDIA_CONTACT || 'football statistics site'})`;
}

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// ---- Curated local database (public/player-photos.json) --------------------
// Loaded + indexed once per cold start. require() (not fs.readFileSync) so
// Vercel's bundler traces and includes the JSON file automatically.
let curatedByName = null; // Map<normalizedName, entry[]>

function loadCuratedDatabase() {
  if (curatedByName) return curatedByName;
  curatedByName = new Map();
  try {
    // eslint-disable-next-line global-require
    const data = require('../../public/player-photos.json');
    if (Array.isArray(data)) {
      for (const entry of data) {
        if (!entry || !entry.name || !entry.imagePath) continue;
        const key = normalize(entry.name).replace(/[^a-z0-9]+/g, ' ').trim();
        if (!key) continue;
        if (!curatedByName.has(key)) curatedByName.set(key, []);
        curatedByName.get(key).push(entry);
      }
    } else {
      console.error('[photo] player-photos.json did not contain an array; curated DB disabled.');
    }
  } catch (e) {
    // Missing/invalid file is not fatal -- just means no curated fallback.
    console.error('[photo] could not load curated player-photos.json:', e.message);
  }
  return curatedByName;
}

// Strips common club-name noise (prefixes/suffixes, punctuation, diacritics)
// so e.g. "Bayern München" and "FC Bayern Munich" compare equal, and a
// substring check handles "Brest" vs "Stade Brestois 29".
const CLUB_STOPWORDS = /\b(fc|cf|afc|sc|ac|ca|cr|cd|ud|rcd|ssc|vfb|fsv|sv|sl|ol|om|psg|the|club|calcio|futebol|futbol|clube|clube de regatas)\b/g;

function normalizeClub(s) {
  let n = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  n = n.replace(/[&.\-]/g, ' ');
  n = n.replace(CLUB_STOPWORDS, ' ');
  n = n.replace(/\b\d{1,4}\b/g, ' '); // "Mainz 05", "Brest 29", "Bayer 04"
  n = n.replace(/\s+/g, ' ').trim();
  return n;
}

function clubsMatch(a, b) {
  const na = normalizeClub(a);
  const nb = normalizeClub(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Looks a player up in the curated database by normalized name. If more than
 * one entry shares that name (e.g. two seasons, or two different players
 * with the same name), the player's current club (when known) picks between
 * them; otherwise the first/most recent entry is used. A club mismatch is
 * NEVER a reason to reject a name match -- it usually just means a transfer
 * happened since the entry was added.
 * @param {{name:string, team?:string|null}} player
 * @returns {object|null} the raw curated entry, or null
 */
function getCuratedEntry(player) {
  const byName = loadCuratedDatabase();
  if (!byName.size) return null;
  const key = normalize(player.name).replace(/[^a-z0-9]+/g, ' ').trim();
  const candidates = byName.get(key);
  if (!candidates || !candidates.length) return null;
  if (candidates.length > 1 && player.team) {
    const byClub = candidates.find((c) => clubsMatch(c.club, player.team));
    if (byClub) return byClub;
  }
  return candidates[0];
}

/**
 * Curated entries are trusted (verified by hand), so this only checks that
 * the URL is well-formed https -- it does NOT restrict to wikimedia.org like
 * safeImageUrl() below does for auto-matched Wikipedia results. Unlike
 * safeImageUrl(), the query string is kept: some curated sources (e.g. UEFA)
 * encode the real image URL in a query parameter.
 */
function safeCuratedImageUrl(u) {
  try {
    const url = new URL(String(u || ''));
    if (url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString().replace(/["'()\\\s<>]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  } catch (_) {
    return null;
  }
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

/**
 * Wikipedia's own search, as a fallback when direct title guesses all miss
 * -- e.g. a data provider's full legal name vs. a player's common Wikipedia
 * article title (frequent with Brazilian/Portuguese names).
 * Returns a list of candidate titles (strings), possibly empty.
 */
async function searchTitles(name, fetchImpl) {
  const params = new URLSearchParams({
    action: 'query', format: 'json', list: 'search',
    srsearch: `${name} footballer`, srlimit: '3', origin: '*',
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${WIKI_SEARCH}?${params.toString()}`, {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return [];
    const json = await res.json();
    const results = (json.query && json.query.search) || [];
    return results.map((r) => String(r.title || '').replace(/\s+/g, '_')).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** -> { state: 'found', url } | { state: 'missing' } | { state: 'error' } */
async function lookupOne(player, fetchImpl) {
  const birthYear = player.dob ? parseInt(String(player.dob).slice(0, 4), 10) : null;
  const tried = new Set();

  async function tryTitle(title) {
    if (tried.has(title)) return null;
    tried.add(title);
    const r = await fetchSummary(title, fetchImpl);
    if (r.state === 'error') {
      console.log('[photo]', player.name, '|', title, '-> error');
      return { error: true };
    }
    if (r.state === 'ok') {
      const ok = isMatch(r.body, player.name, birthYear);
      console.log('[photo]', player.name, '|', title, '-> ok', ok ? 'MATCH' : `no-match (${r.body.description || 'no description'})`);
      if (ok) return { url: safeImageUrl(r.body.thumbnail.source) };
    } else {
      console.log('[photo]', player.name, '|', title, '->', r.state);
    }
    return null;
  }

  // Pass 1: direct name-based guesses.
  for (const title of candidateTitles(player.name, birthYear)) {
    const res = await tryTitle(title);
    if (res && res.error) return { state: 'error' };
    if (res && res.url) return { state: 'found', url: res.url };
  }

  // Pass 2: Wikipedia search fallback, only if pass 1 found nothing.
  const searchResults = await searchTitles(player.name, fetchImpl);
  for (const title of searchResults) {
    const res = await tryTitle(title);
    if (res && res.error) return { state: 'error' };
    if (res && res.url) return { state: 'found', url: res.url };
  }

  return { state: 'missing' };
}

/**
 * Cached lookup. Returns a URL string, or null when there is no (safe) photo
 * right now. Checks, in order: Redis cache -> curated database -> Wikipedia.
 */
async function getPhoto(player, fetchImpl) {
  if (player.id === undefined || player.id === null) return null;
  const key = `fd-photo:${player.id}`;
  const cached = await cacheGet(key);
  if (cached !== null) return cached.u || null;

  // Curated, manually-verified database -- checked before the automated
  // Wikipedia lookup. Trusted by construction, so no isMatch() safety check
  // here (that check exists specifically because the Wikipedia pass is
  // auto-matched and could otherwise attach the wrong person's face).
  const curatedEntry = getCuratedEntry(player);
  if (curatedEntry) {
    const url = safeCuratedImageUrl(curatedEntry.imagePath);
    if (url) {
      await cacheSet(key, { u: url }, FOUND_TTL_SECONDS);
      console.log('[photo]', player.name, '-> curated match:', curatedEntry.club || '');
      return url;
    }
  }

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
 * @param {{id:number,name:string,dob?:string,team?:string}[]} players
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

module.exports = {
  findPhotos,
  getPhoto,
  initials,
  initialsAvatar,
  candidateTitles,
  isMatch,
  safeImageUrl,
  // curated-DB internals, exported for testing/debugging
  getCuratedEntry,
  normalizeClub,
  clubsMatch,
  safeCuratedImageUrl,
  loadCuratedDatabase,
};
