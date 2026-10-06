import db from '../lib/news/db.js';

function dateLabel(publishedDate) {
  if (!publishedDate) return '';
  const d = new Date(publishedDate);
  if (isNaN(d.getTime())) return publishedDate;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function withLabel(r) {
  return { ...r, date_label: dateLabel(r.published_date || r.created_at) };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // GET /api/news?slug=...  -> one article
    const slug = typeof req.query.slug === 'string' ? req.query.slug.trim() : '';
    if (slug) {
      const rows = await db.listPublished({ slug, limit: 1 });
      if (!rows.length) return res.status(404).json({ error: 'Article not found' });
      return res.status(200).json({ article: withLabel(rows[0]) });
    }

    // GET /api/news?limit=30  -> list (max 1000; add &compact=1 to leave out the article bodies)
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 1000);
    const compact = req.query.compact === '1';
    const rows = await db.listPublished({ limit, compact });
    return res.status(200).json({ articles: rows.map(withLabel) });
  } catch (error) {
    console.error('Database query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve news articles', details: error.message });
  }
}
