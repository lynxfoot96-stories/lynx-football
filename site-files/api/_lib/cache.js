'use strict';
/**
 * Small shared cache stored in Supabase.
 *
 * WHY THIS EXISTS: an in-memory cache (a plain Map inside a serverless
 * function file) only helps requests that happen to land on the same warm
 * instance. Vercel can -- and does, under a traffic spike -- run several
 * instances of the same function at once, each with its own private memory.
 * So "30 people click in the same minute" can still mean several *separate*
 * upstream calls, one per cold instance, which is exactly what was blowing
 * past football-data.org's rate limit and producing "unable to load".
 *
 * This module gives every instance a shared place to check "has anyone,
 * anywhere, already fetched this in the last N minutes?" before calling the
 * upstream API. It's deliberately tiny and best-effort: if Supabase isn't
 * configured, or a call to it fails, every function here just returns
 * null/no-ops so the caller falls back to calling the upstream API directly
 * -- this can never be the reason a request fails.
 *
 * Table (run once in the Supabase SQL editor):
 *
 *   create table if not exists api_cache (
 *     key text primary key,
 *     data jsonb not null,
 *     updated_at timestamptz not null default now()
 *   );
 *
 * No RLS policy is needed since this is only ever read/written with the
 * service role key (server-side only), same as the news_articles table.
 */

function cfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

const TABLE = 'api_cache';

/**
 * Returns { data, ageMs } for the given key, or null if there's no row yet,
 * or Supabase isn't configured, or the read failed for any reason.
 */
async function readCache(key) {
  const c = cfg();
  if (!c) return null;
  try {
    const res = await fetch(
      `${c.url}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(key)}&select=data,updated_at&limit=1`,
      { headers: c.headers }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    if (!rows.length) return null;
    return { data: rows[0].data, ageMs: Date.now() - new Date(rows[0].updated_at).getTime() };
  } catch {
    return null;
  }
}

/**
 * Upserts a key. Fire-and-forget from the caller's point of view -- never
 * throws, never slows down the response that triggered it.
 */
async function writeCache(key, data) {
  const c = cfg();
  if (!c) return;
  try {
    await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=key`, {
      method: 'POST',
      headers: { ...c.headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ key, data, updated_at: new Date().toISOString() }),
    });
  } catch {
    // best-effort -- a failed write just means the next request re-fetches
  }
}

module.exports = { readCache, writeCache };
