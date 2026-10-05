'use strict';
/**
 * Supabase access through its REST API (PostgREST) — no SDK/dependency needed.
 * Uses the SERVICE ROLE key, which exists only in server-side environment variables.
 */
function cfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  return { url, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } };
}

const TABLE = 'news_articles';

async function request(path, init = {}, fetchImpl = fetch) {
  const { url, headers } = cfg();
  const res = await fetchImpl(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  return res;
}

async function recentPublished(days, fetchImpl) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const q = `${TABLE}?select=title,source_url,source_urls,published_date&status=eq.published&published_date=gte.${since}&order=published_date.desc&limit=200`;
  const res = await request(q, {}, fetchImpl);
  if (!res.ok) throw new Error(`Supabase read failed: HTTP ${res.status}`);
  return res.json();
}

async function publishedTodayCount(iso, fetchImpl) {
  const res = await request(`${TABLE}?select=id&status=eq.published&published_date=eq.${iso}`, {}, fetchImpl);
  if (!res.ok) throw new Error(`Supabase read failed: HTTP ${res.status}`);
  return (await res.json()).length;
}

/** Insert one article. Returns 'saved' | 'duplicate'. Throws on other errors. */
async function insertArticle(article, status, fetchImpl, rejectReason = null) {
  const res = await request(TABLE, {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...article, status, reject_reason: rejectReason }),
  }, fetchImpl);
  if (res.status === 409) return 'duplicate'; // unique slug / source_url => already exists
  if (!res.ok) throw new Error(`Supabase insert failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return 'saved';
}

async function listPublished({ limit = 30, slug = null } = {}, fetchImpl) {
  // Ordered by created_at first to reliably fetch articles generated today
  let q = `${TABLE}?select=*&status=eq.published&order=created_at.desc&limit=${limit}`;
  if (slug) q = `${TABLE}?select=*&status=eq.published&slug=eq.${encodeURIComponent(slug)}&limit=1`;
  
  const res = await request(q, {}, fetchImpl);
  if (!res.ok) throw new Error(`Supabase read failed: HTTP ${res.status}`);
  return res.json();
}

module.exports = { recentPublished, publishedTodayCount, insertArticle, listPublished };