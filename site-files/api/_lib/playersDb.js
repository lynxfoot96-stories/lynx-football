'use strict';
/**
 * Supabase access for the `players` table ONLY, via its REST API (PostgREST)
 * -- no SDK/dependency, same approach as ../db.js. Kept as its own file
 * (rather than extending db.js) so the news-article code path -- and its
 * table, env var usage, and request shapes -- is never touched by this
 * feature. Uses the SAME SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars
 * that already exist on your Vercel project for the news system.
 */
function cfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

const TABLE = 'players';

async function request(path, init = {}, fetchImpl = fetch) {
  const { url, headers } = cfg();
  return fetchImpl(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
}

function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function normalizeSearch(name) {
  return String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Look up a cached row by slug. Returns the row, or null if not cached yet. */
async function getBySlug(slug, fetchImpl) {
  const res = await request(`${TABLE}?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`, {}, fetchImpl);
  if (!res.ok) throw new Error(`Supabase read failed: HTTP ${res.status}`);
  const rows = await res.json();
  return rows[0] || null;
}

/** Upsert (insert, or update on tm_id conflict) one player row. */
async function upsertPlayer(row, fetchImpl) {
  const res = await request(`${TABLE}?on_conflict=tm_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(row),
  }, fetchImpl);
  if (!res.ok) throw new Error(`Supabase upsert failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const rows = await res.json();
  return rows[0] || null;
}

module.exports = { getBySlug, upsertPlayer, slugify, normalizeSearch };
