'use strict';
/**
 * GET /api/player?name=<player name>[&club=<club name>]
 *
 * Serves a player's profile, current club, shirt number and club history.
 * Backed by Supabase (see supabase/players-schema.sql) with data from
 * TheSportsDB (_lib/sportsdb.js):
 *   - First time a player is requested: fetched live, then stored in Supabase.
 *   - After that: served straight from Supabase, no upstream call, until the
 *     next REFRESH DATE (see below). The first visitor after a refresh date
 *     re-fetches that player and the new data is stored for everyone.
 *
 * REFRESH DATES (every year): 5 Jan, 20 Jan, 1 Sep, 20 Sep -- the days after
 * the winter / summer transfer windows close, when clubs have changed. A saved
 * player is "fresh" if it was fetched on or after the most recent refresh date.
 * Change the REFRESH_DATES list below to move or add dates.
 *
 * Safety nets:
 *   - If a refresh fails (TheSportsDB down), the old saved data is still shown
 *     and the next attempt is delayed ~10 minutes (no hammering).
 *   - A player saved with missing pieces (a request failed) is retried after 24h.
 *
 * Response shape:
 *   { ok: true, player: { name, dateOfBirth, age, nationality, position, photoUrl,
 *       currentClub, shirtNumber, marketValue, marketValueNote,
 *       transfers: [{date, fromClub, toClub, fee, type}, ...],
 *       lastUpdated, unavailableFields: [...] } }
 * or { ok: false, error } on failure (never invents a value for a missing field).
 */
const { acquireLock, releaseLock } = require('./_lib/cache');
const { getBySlug, upsertPlayer, slugify, normalizeSearch } = require('./_lib/playersDb');
const tm = require('./_lib/sportsdb'); // TheSportsDB (player page only)

// Whole upstream fetch must finish well inside Vercel's 25s function limit.
const UPSTREAM_BUDGET_MS = 21000;

// ---- refresh schedule -------------------------------------------------------
// [month (1-12), day]. Compared in UTC.
const REFRESH_DATES = [[1, 5], [1, 20], [9, 1], [9, 20]];
const PARTIAL_RETRY_MS = 24 * 60 * 60 * 1000;   // row saved with a failed piece
const REFRESH_COOLDOWN_SECONDS = 600;           // after a failed refresh, wait ~10 min

/** The most recent refresh date that is <= now (a Date, UTC midnight). */
function lastRefreshDate(now) {
  const y = now.getUTCFullYear();
  let best = null;
  for (const year of [y - 1, y]) {
    for (const [m, d] of REFRESH_DATES) {
      const t = Date.UTC(year, m - 1, d);
      if (t <= now.getTime() && (best === null || t > best)) best = t;
    }
  }
  return new Date(best);
}

/** A saved row is fresh if it was fetched on/after the last refresh date. */
function isFresh(row, now) {
  now = now || new Date();
  const fetched = row && row.fetched_at ? new Date(row.fetched_at).getTime() : 0;
  if (!fetched) return false;
  if (fetched < lastRefreshDate(now).getTime()) return false;
  if (row.fetch_error && now.getTime() - fetched > PARTIAL_RETRY_MS) return false;
  return true;
}

function rowToResponse(row) {
  const unavailableFields = [];
  const check = (key, val) => { if (val === null || val === undefined || val === '') unavailableFields.push(key); };
  check('dateOfBirth', row.date_of_birth);
  check('nationality', row.nationality);
  check('position', row.position);
  check('photoUrl', row.photo_url);
  check('currentClub', row.current_club);
  check('shirtNumber', row.shirt_number);
  check('marketValue', row.market_value);

  return {
    name: row.name,
    dateOfBirth: row.date_of_birth || null,
    age: row.age || null,
    nationality: row.nationality || null,
    position: row.position || null,
    photoUrl: row.photo_url || null,
    currentClub: row.current_club || null,
    shirtNumber: row.shirt_number || null,
    marketValue: row.market_value || null,
    marketValueNote: row.market_value_note || 'Market value is not available from this data source.',
    transfers: Array.isArray(row.transfers) ? row.transfers : [],
    lastUpdated: row.fetched_at || null,
    unavailableFields,
    fetchError: row.fetch_error || null,
  };
}

async function fetchFromUpstream(name, slug) {
  const deadline = Date.now() + UPSTREAM_BUDGET_MS;

  const search = await tm.searchPlayer(name, { deadline, timeoutMs: 12000 });
  if (!search.ok) return { ok: false, error: search.error };
  if (!search.player || !search.player.id) return { ok: false, notFound: true };

  const id = search.player.id;

  // The public demo allows 2 requests / 3s, so don't fire all three at once:
  // profile + market value together, then transfers.
  const [profileR, marketR] = await Promise.all([
    tm.getProfile(id, { deadline, timeoutMs: 8000 }),
    tm.getMarketValue(id, { deadline, timeoutMs: 8000 }),
  ]);
  const transfersR = await tm.getTransfers(id, { deadline, timeoutMs: 8000 });

  // If nothing useful came back, do NOT save an empty row -- it would be
  // served forever and the player would never get a second chance.
  if (!profileR.ok && !marketR.ok && !transfersR.ok) {
    return { ok: false, error: profileR.error || 'Player data source is not responding. Please try again shortly.' };
  }

  const errors = [];
  const profile = profileR.ok ? profileR.profile : {};
  if (!profileR.ok) errors.push(`profile: ${profileR.error}`);
  const marketValue = marketR.ok ? marketR.marketValue : null;
  if (!marketR.ok) errors.push(`market_value: ${marketR.error}`);
  const transfers = transfersR.ok ? transfersR.transfers : [];
  if (!transfersR.ok) errors.push(`transfers: ${transfersR.error}`);

  const resolvedName = profile.name || search.player.name || name;
  return {
    ok: true,
    row: {
      tm_id: id,
      slug, // the key the site asks with, so the same name always hits the saved row
      name: resolvedName,
      search_name: normalizeSearch(resolvedName),
      date_of_birth: profile.dateOfBirth || null,
      age: profile.age != null ? profile.age : null,
      nationality: profile.nationality || null,
      position: profile.position || null,
      photo_url: profile.photoUrl || search.player.photoUrl || null,
      current_club: profile.currentClub || search.player.club || null,
      current_club_tm_id: profile.currentClubTmId || null,
      shirt_number: profile.shirtNumber || null,
      market_value: marketValue || null,
      market_value_note: null,
      transfers,
      source_updated_at: profile.updatedAt || marketR.updatedAt || transfersR.updatedAt || null,
      fetched_at: new Date().toISOString(),
      fetch_error: errors.length ? errors.join('; ') : null,
    },
  };
}

function sendUpstreamFailure(res, result, name) {
  if (result.notFound) return res.status(404).json({ ok: false, error: `No player found matching "${name}".` });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(502).json({ ok: false, error: result.error || 'Upstream error' });
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const name = String((req.query || {}).name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  const slug = slugify(name);
  if (!slug) return res.status(400).json({ ok: false, error: 'Invalid name' });

  try {
    let row = await getBySlug(slug);
    let stale = null;
    if (row && !isFresh(row)) { stale = row; row = null; }

    let failure = null;
    if (!row) {
      // Stale rows get a long lock: if a refresh fails, the lock is left to
      // expire so we do not retry on every visit. Brand-new players use a short one.
      const lockKey = stale ? `player-refresh:${slug}` : `player-fetch:${slug}`;
      const token = await acquireLock(lockKey, stale ? REFRESH_COOLDOWN_SECONDS : 25);
      if (token) {
        let ok = false;
        try {
          const again = await getBySlug(slug); // someone may have just refreshed it
          if (again && isFresh(again)) { row = again; ok = true; }
          else {
            const result = await fetchFromUpstream(name, slug);
            if (result.ok) { row = await upsertPlayer(result.row); ok = true; }
            else failure = result;
          }
        } catch (e) {
          failure = { ok: false, error: 'Player data is temporarily unavailable.' };
          console.error('player refresh error:', e.message);
        } finally {
          if (ok || !stale) await releaseLock(lockKey, token);
        }
      } else if (!stale) {
        // Someone else is already fetching this brand-new player: wait briefly
        // for their result instead of also calling the upstream API.
        for (let i = 0; i < 6 && !row; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const r2 = await getBySlug(slug);
          if (r2 && isFresh(r2)) row = r2;
        }
        if (!row) {
          const result = await fetchFromUpstream(name, slug);
          if (result.ok) row = await upsertPlayer(result.row);
          else failure = result;
        }
      }
      // (stale + lock not acquired: a refresh is already running or just failed -> serve stale below)
    }

    if (!row && stale) {
      // Refresh failed / in progress: the old saved data beats an error page.
      res.setHeader('Cache-Control', 'public, s-maxage=300');
      return res.status(200).json({ ok: true, player: rowToResponse(stale) });
    }
    if (!row && failure) return sendUpstreamFailure(res, failure, name);
    if (!row) return res.status(502).json({ ok: false, error: 'Could not load player data.' });

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ ok: true, player: rowToResponse(row) });
  } catch (err) {
    console.error('player error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: 'Player data is temporarily unavailable.' });
  }
}

module.exports = handler;
module.exports.lastRefreshDate = lastRefreshDate; // exported for tests
module.exports.isFresh = isFresh;
