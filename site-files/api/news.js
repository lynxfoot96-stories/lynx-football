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
    // Handle both direct object export and function export for the db module
    const db = typeof dbModule.getDb === 'function' 
      ? await dbModule.getDb() 
      : (typeof dbModule.default === 'function' ? await dbModule.default() : dbModule);

    if (!db || typeof db.from !== 'function') {
      return res.status(500).json({ error: 'Database client missing .from() method' });
    }

    const limit = parseInt(req.query.limit, 10) || 30;

    const { data, error } = await db
      .from('news_articles')
      .select('*')
      .limit(limit);
      
    if (error) {
      return res.status(500).json({ error: 'Supabase query error', details: error.message });
    }

    return res.status(200).json({
      articles: (data || []).map(r => ({ 
        ...r, 
        date_label: dateLabel(r.published_date || r.created_at) 
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}