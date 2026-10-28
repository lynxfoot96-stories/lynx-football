/* api/youtube.js — your channel's newest uploads, for the website.
 *
 * Reads the channel's public YouTube feed (free, no API key, no quota) and returns the latest
 * videos as JSON:  GET /api/youtube  ->  { ok:true, videos:[{id,title,published,thumb}, ...] }
 * (newest first, Shorts left out). The website (youtube-sync.js) puts any video that is not yet in
 * videos-data.js on top of the list, so new uploads appear by themselves.
 *
 * SETUP: nothing is required. By default the channel is looked up from its handle (CHANNEL_HANDLE).
 * For a faster, more reliable setup add an Environment Variable in Vercel:
 *     YT_CHANNEL_ID = UCxxxxxxxxxxxxxxxxxxxxxx      (YouTube Studio > Settings > Channel > Advanced settings)
 */
const CHANNEL_HANDLE = '@football-stories-96';
const UA = 'Mozilla/5.0 (compatible; FootballStoriesBot/1.0)';

let cachedChannelId = null;   // kept while the serverless instance stays warm
let lastSuccessfulVideos = null; // best-effort fallback on a warm function

function decode(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

async function resolveChannelId() {
  if (process.env.YT_CHANNEL_ID) return process.env.YT_CHANNEL_ID.trim();
  if (cachedChannelId) return cachedChannelId;
  const r = await fetch('https://www.youtube.com/' + CHANNEL_HANDLE, {
    headers: { 'user-agent': UA, 'accept-language': 'en' }
  });
  const html = await r.text();
  const m = html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) ||
            html.match(/"channelId":"(UC[\w-]{22})"/) ||
            html.match(/"externalId":"(UC[\w-]{22})"/);
  if (!m) throw new Error('could not find the channel id for ' + CHANNEL_HANDLE);
  cachedChannelId = m[1];
  return cachedChannelId;
}

async function fetchFeedWithRetry(channelId) {
  const urls = [
    'https://www.youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(channelId),
    'https://youtube.com/feeds/videos.xml?channel_id=' + encodeURIComponent(channelId)
  ];
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const url = urls[attempt % urls.length];
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/atom+xml,application/xml,text/xml' },
        signal: AbortSignal.timeout(7000)
      });
      if (!response.ok) throw new Error('YouTube feed returned HTTP ' + response.status);
      const xml = await response.text();
      if (!xml.includes('<feed')) throw new Error('YouTube did not return an XML feed');
      return xml;
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  throw lastError;
}

function parseFeed(xml) {
  const out = [];
  const entries = xml.split('<entry>').slice(1);
  entries.forEach((e) => {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!id) return;
    const title = decode((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).trim();
    const link = (e.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/) || [])[1] || '';
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1] || '';
    if (/\/shorts\//.test(link)) return;               // keep the site to full videos
    out.push({ id, title, published, thumb: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg' });
  });
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // cached by Vercel's edge for 30 min, and served stale for a day if YouTube is slow/down
  res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
  try {
    const channelId = await resolveChannelId();
    const videos = parseFeed(await fetchFeedWithRetry(channelId));
    if (!videos.length) throw new Error('YouTube returned a feed with no videos');
    lastSuccessfulVideos = { channelId, videos };
    res.status(200).send(JSON.stringify({ ok: true, channelId, videos }));
  } catch (err) {
    if (lastSuccessfulVideos) {
      res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=1800');
      res.status(200).send(JSON.stringify({ ok: true, ...lastSuccessfulVideos, stale: true }));
      return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(JSON.stringify({ ok: false, error: String(err && err.message || err), videos: [] }));
  }
};

module.exports.parseFeed = parseFeed;   // used by tests only
