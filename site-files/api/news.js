import dbModule from '../lib/news/db.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const getDbFn = dbModule.getDb || dbModule.default?.getDb || dbModule;
    const db = typeof getDbFn === 'function' ? await getDbFn() : dbModule;
    
    if (!db || typeof db.from !== 'function') {
      return res.status(500).json({ error: 'Database client not initialized correctly', dbType: typeof db });
    }

    const { data, error } = await db
      .from('news_articles')
      .select('*')
      .limit(30);
      
    if (error) {
      return res.status(500).json({ error: 'Supabase error', details: error });
    }

    return res.status(200).json({
      count: data ? data.length : 0,
      articles: data || []
    });
  } catch (err) {
    return res.status(500).json({ error: 'Catch error', message: err.message });
  }
}