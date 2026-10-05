import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

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
    const limit = parseInt(req.query.limit, 10) || 30;

    const { data, error } = await supabase
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