/* Football Stories: latest 15 public, full-length YouTube uploads.
   Try RSS endpoints first, then the channel's public /videos page if RSS is unavailable.
   Optional Vercel variable YT_CHANNEL_ID: the public UC... channel ID.
   No YouTube Data API key is needed, but YouTube can change/block public endpoints. */
const CHANNEL_HANDLE = '@football-stories-96';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
let cachedChannelId = null;
let lastGood = null;

function decode(s) {
  return String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}
async function request(url) {
  const r = await fetch(url, { headers: {
    'user-agent': UA, 'accept-language': 'en-US,en;q=0.9',
    'accept': 'text/html,application/xml,text/xml;q=0.9,*/*;q=0.8'
  }, signal: AbortSignal.timeout(8500) });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' from ' + new URL(url).pathname);
  return r.text();
}
function parseFeed(xml) {
  const out = [];
  for (const e of xml.split(/<entry(?:\s[^>]*)?>/).slice(1)) {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!id) continue;
    const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1] || '';
    if (/\/shorts\//.test(link)) continue;
    out.push({ id, title: decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).trim(),
      published: (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '',
      thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' });
  }
  return out.slice(0, 15);
}
function extractObject(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      try { return JSON.parse(html.slice(start, i + 1)); } catch (_) { return null; }
    }
  }
  return null;
}
function findVideoRenderers(data) {
  const found = [];
  function visit(x, depth) {
    if (!x || depth > 35 || found.length >= 25) return;
    if (Array.isArray(x)) { for (const item of x) visit(item, depth + 1); return; }
    if (typeof x !== 'object') return;
    // Video grid entries on the channel's Videos tab.
    if (x.videoRenderer) found.push(x.videoRenderer);
    if (x.gridVideoRenderer) found.push(x.gridVideoRenderer);
    // Browse search/shorts are deliberately excluded.
    for (const [key, value] of Object.entries(x)) {
      if (key === 'videoRenderer' || key === 'gridVideoRenderer' || key === 'reelItemRenderer' || key === 'shortsLockupViewModel') continue;
      visit(value, depth + 1);
    }
  }
  visit(data, 0);
  return found;
}
function textOf(x) {
  if (!x) return '';
  if (typeof x.simpleText === 'string') return x.simpleText;
  return (x.runs || []).map(x => x.text || '').join('');
}
function parseVideoPage(html) {
  const data = extractObject(html, 'var ytInitialData =') ||
    extractObject(html, 'window["ytInitialData"] =') ||
    extractObject(html, 'ytInitialData =');
  if (!data) return [];
  const seen = new Set(), out = [];
  for (const v of findVideoRenderers(data)) {
    const id = v.videoId;
    if (!/^[\w-]{11}$/.test(id || '') || seen.has(id)) continue;
    const title = textOf(v.title) || textOf(v.headline);
    if (!title) continue;
    seen.add(id);
    out.push({ id, title, published: textOf(v.publishedTimeText),
      thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' });
    if (out.length === 15) break;
  }
  return out;
}
async function resolveChannelId() {
  const config = (process.env.YT_CHANNEL_ID || '').trim();
  if (config) {
    if (!/^UC[\w-]{22}$/.test(config)) throw new Error('Invalid YT_CHANNEL_ID: expected UC followed by 22 characters');
    return config;
  }
  if (cachedChannelId) return cachedChannelId;
  const html = await request('https://www.youtube.com/' + CHANNEL_HANDLE);
  const m = html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) ||
    html.match(/"channelId":"(UC[\w-]{22})"/) ||
    html.match(/"externalId":"(UC[\w-]{22})"/);
  if (!m) throw new Error('Could not resolve YouTube channel ID for ' + CHANNEL_HANDLE);
  cachedChannelId = m[1];
  return cachedChannelId;
}
module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const errors = [];
  let channelId = null;
  try { channelId = await resolveChannelId(); } catch (e) { errors.push(String(e.message || e)); }
  if (channelId) {
    const urls = [
      'https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId,
      'https://www.youtube.com/xml/feeds/videos.xml?channel_id=' + channelId
    ];
    for (const url of urls) {
      try {
        const videos = parseFeed(await request(url));
        if (videos.length) {
          lastGood = { ok: true, channelId, videos, source: 'rss' };
          res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
          return res.status(200).json(lastGood);
        }
        errors.push('RSS returned zero videos');
      } catch (e) { errors.push(String(e.message || e)); }
    }
  }
  const path = channelId ? '/channel/' + channelId + '/videos' : '/' + CHANNEL_HANDLE + '/videos';
  try {
    const videos = parseVideoPage(await request('https://www.youtube.com' + path + '?view=0&sort=dd'));
    if (videos.length) {
      lastGood = { ok: true, channelId, videos, source: 'channel-page' };
      res.setHeader('Cache-Control', 'public, s-maxage=900, stale-while-revalidate=86400');
      return res.status(200).json(lastGood);
    }
    errors.push('Channel Videos page returned no readable videos');
  } catch (e) { errors.push(String(e.message || e)); }
  if (lastGood) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ...lastGood, stale: true });
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ ok: false, channelId, videos: [], error: errors.join('; ') });
};
module.exports.parseFeed = parseFeed;
module.exports.parseVideoPage = parseVideoPage;
