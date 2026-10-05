export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const supabaseUrl = process.env.SUPABASE_URL || 'https://ypbkhxkcvrmooizliijg.supabase.co';
    const supabaseKey = process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseKey) {
      return res.status(500).json({ error: 'Missing Supabase API key in environment variables' });
    }

    const limit = parseInt(req.query.limit, 10) || 30;

    const response = await fetch(`${supabaseUrl}/rest/v1/news_articles?select=*&limit=${limit}`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'Supabase REST error', details: errText });
    }

    const data = await response.json();

    return res.status(200).json({
      articles: (data || []).map(r => ({ 
        ...r, 
        date_label: r.published_date || r.created_at ? new Date(r.published_date || r.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : ''
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'Server error', message: err.message });
  }
}