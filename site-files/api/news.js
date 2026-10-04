'use strict';
/**
 * Public, read-only feed of PUBLISHED articles for the website.
 *   GET /api/news?limit=30      latest published articles
 *   GET /api/news?slug=<slug>   a single published article
 * Drafts and rejected articles are never returned. No secret is exposed to the browser:
 * the Supabase service key stays on the server.
 */
const { listPublished } = require('../lib/news/db');
const { dateLabel } = require('../lib/news/text');
const { logError } = require('../lib/news/log');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const q = req.query || {};
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 30, 1), 60);
  const slug = typeof q.slug === 'string' && /^[a-z0-9-]{1,80}$/.test(q.slug) ? q.slug : null;
  if (q.slug && !slug) return res.status(400).json({ error: 'Invalid slug' });

  try {
    const rows = await listPublished({ limit, slug });
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    return res.status(200).json({
      articles: rows.map(r => ({ ...r, date_label: dateLabel(r.published_date) })),
    });
  } catch (err) {
    logError('news_read_failed', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).json({ articles: [] }); // the page simply keeps showing its static news
  }
};
