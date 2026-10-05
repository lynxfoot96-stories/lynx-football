import dbModule from '../lib/news/db.js';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const getDbFn = dbModule.getDb || dbModule.default?.getDb || dbModule;
    const db = typeof getDbFn === 'function' ? await getDbFn() : dbModule;
    
    const limit = parseInt(req.query.limit, 10) || 30;

    // Query Supabase table directly
    let rows = [];
    if (typeof db.from === 'function') {
      const { data, error } = await db
        .from('news_articles')
        .select('*')
        .order('published_date', { ascending: false })
        .limit(limit);
      
      if (error) throw error;
      rows = data || [];
    } else if (typeof db.all === 'function') {
      rows = await db.all(
        `SELECT * FROM news_articles ORDER BY published_date DESC LIMIT ?`,
        [limit]
      );
    }

    return res.status(200).json({
      articles: rows.map(r => ({ ...r, date_label: dateLabel(r.published_date) })),
    });
  } catch (error) {
    console.error('Database query error:', error);
    return res.status(500).json({ error: 'Failed to retrieve news articles' });
  }
}