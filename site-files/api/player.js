'use strict';
/**
 * GET /api/player?name=<player name>[&club=<club name, improves the search match>]
 *
 * Serves a player's profile, current club, shirt number, market value and
 * transfer history. Backed by Supabase (see supabase/players-schema.sql):
 *   - First time a player is requested: fetched live from the Transfermarkt
 *     community API (_lib/transfermarkt.js), then stored in Supabase.
 *   - Every later request for the same player: served straight from
 *     Supabase -- no upstream call at all, so repeat visits never add to
 *     that API's rate limit, as requested.
 * A distributed lock (same _lib/cache.js used by scores.js/standings.js)
 * makes sure that if several visitors open a brand-new player at the same
 * moment, only ONE of them triggers the upstream fetch.
 *
 * Response shape:
 *   { ok: true, player: {
 *       name, dateOfBirth, age, nationality, position, photoUrl,
 *       currentClub, shirtNumber,
 *       marketValue, marketValueNote,
 *       transfers: [{date, fromClub, toClub, fee, type}, ...],
 *       lastUpdated,              // ISO date this site last fetched the data
 *       unavailableFields: [...]  // fields the upstream API could not supply
 *   } }
 * or { ok: false, error } on failure (never invents a value for a missing field).
 */
const { acquireLock, releaseLock } = require('./_lib/cache');
const { getBySlug, upsertPlayer, slugify, normalizeSearch } = require('./_lib/playersDb');
const tm = require('./_lib/transfermarkt');

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
    marketValueNote: row.market_value_note || 'Estimated value from Transfermarkt; not an official or audited figure.',
    transfers: Array.isArray(row.transfers) ? row.transfers : [],
    lastUpdated: row.fetched_at || null,
    unavailableFields,
    fetchError: row.fetch_error || null,
  };
}

async function fetchFromUpstream(name) {
  const search = await tm.searchPlayer(name);
  if (!search.ok) return { ok: false, error: search.error };
  if (!search.player || !search.player.id) return { ok: false, notFound: true };

  const id = search.player.id;
  const [profileR, marketR, transfersR] = await Promise.all([
    tm.getProfile(id),
    tm.getMarketValue(id),
    tm.getTransfers(id),
  ]);

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
      slug: slugify(resolvedName),
      name: resolvedName,
      search_name: normalizeSearch(resolvedName),
      date_of_birth: profile.dateOfBirth || null,
      age: profile.age != null ? profile.age : null,
      nationality: profile.nationality || null,
      position: profile.position || null,
      photo_url: profile.photoUrl || null,
      current_club: profile.currentClub || search.player.club || null,
      current_club_tm_id: profile.currentClubTmId || null,
      shirt_number: profile.shirtNumber || null,
      market_value: marketValue || null,
      transfers,
      source_updated_at: profile.updatedAt || marketR.updatedAt || transfersR.updatedAt || null,
      fetched_at: new Date().toISOString(),
      fetch_error: errors.length ? errors.join('; ') : null,
    },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const name = String((req.query || {}).name || '').trim().slice(0, 120);
  if (!name) return res.status(400).json({ ok: false, error: 'name is required' });
  const slug = slugify(name);
  if (!slug) return res.status(400).json({ ok: false, error: 'Invalid name' });

  try {
    let row = await getBySlug(slug);

    if (!row) {
      // Not cached yet: only the request that wins the lock calls the
      // upstream API; everyone else arriving in the same moment waits and
      // reads what the winner just saved, instead of each firing their own
      // upstream call (same pattern as scores.js / standings.js).
      const lockKey = `player-fetch:${slug}`;
      const token = await acquireLock(lockKey, 25);
      if (token) {
        try {
          row = await getBySlug(slug); // re-check: someone may have just filled it
          if (!row) {
            const result = await fetchFromUpstream(name);
            if (!result.ok) {
              if (result.notFound) return res.status(404).json({ ok: false, error: `No player found matching "${name}".` });
              return res.status(502).json({ ok: false, error: result.error || 'Upstream error' });
            }
            row = await upsertPlayer(result.row);
          }
        } finally {
          await releaseLock(lockKey, token);
        }
      } else {
        // Someone else is already fetching this exact player: wait briefly
        // for their result instead of also calling the upstream API.
        for (let i = 0; i < 10 && !row; i++) {
          await new Promise((r) => setTimeout(r, 500));
          row = await getBySlug(slug);
        }
        if (!row) {
          // Lock-holder took too long (or crashed) and nothing landed yet;
          // fetch directly rather than fail the request.
          const result = await fetchFromUpstream(name);
          if (!result.ok) {
            if (result.notFound) return res.status(404).json({ ok: false, error: `No player found matching "${name}".` });
            return res.status(502).json({ ok: false, error: result.error || 'Upstream error' });
          }
          row = await upsertPlayer(result.row);
        }
      }
    }

    if (!row) return res.status(502).json({ ok: false, error: 'Could not load player data.' });

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ ok: true, player: rowToResponse(row) });
  } catch (err) {
    console.error('player error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ ok: false, error: 'Player data is temporarily unavailable.' });
  }
};
