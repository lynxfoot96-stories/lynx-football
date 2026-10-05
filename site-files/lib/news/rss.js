'use strict';
/**
 * Minimal, dependency-free RSS 2.0 / Atom reader. Only extracts what the editor needs:
 * title, link, short description, publication date and (optional) image URL.
 */
const { stripHtml, decodeEntities, truncate } = require('./text');
const { log, logError } = require('./log');

function tag(block, name) {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
  const m = re.exec(block);
  return m ? m[1] : '';
}
function attr(block, name, attribute) {
  const m = new RegExp(`<${name}\\b[^>]*?\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'i').exec(block);
  return m ? decodeEntities(m[1]) : '';
}

function allAttrs(block, name, attribute) {
  const re = new RegExp(`<${name}\\b[^>]*?\\b${attribute}\\s*=\\s*["']([^"']+)["']`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(block))) out.push(decodeEntities(m[1]));
  return out;
}

/** Extra, bigger variants of known CDN thumbnail URLs. They are only *candidates*: images.js measures them. */
function biggerVariants(u) {
  const out = [];
  try {
    const url = new URL(u);
    if (url.hostname === 'ichef.bbci.co.uk') {            // BBC: .../standard/240/... -> .../standard/976/...
      out.push(u.replace(/\/(ace\/standard|news|live)\/\d{2,4}\//, '/$1/976/'));
    }
  } catch (_) { /* ignore */ }
  return out.filter(x => x !== u);
}

/** Every https image the RSS item offers, bigger-looking ones first (media:content before thumbnails). */
function findImages(block, description) {
  const raw = [
    ...allAttrs(block, 'media:content', 'url'),
    /image\//i.test(attr(block, 'enclosure', 'type')) ? attr(block, 'enclosure', 'url') : '',
    ...allAttrs(block, 'media:thumbnail', 'url'),
    (/<img[^>]+src=["']([^"']+)["']/i.exec(description) || [])[1] || '',
  ].map(decodeEntities).filter(u => /^https:\/\//i.test(u));
  const withBigger = raw.flatMap(u => [u, ...biggerVariants(u)]);
  return [...new Set(withBigger)];
}

function parseFeed(xml, source, snippetChars = 400) {
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  for (const block of blocks) {
    const title = stripHtml(tag(block, 'title'));
    let link = stripHtml(tag(block, 'link')) || attr(block, 'link', 'href');
    if (!link) link = stripHtml(tag(block, 'guid'));
    const rawDesc = tag(block, 'description') || tag(block, 'summary') || tag(block, 'content:encoded') || tag(block, 'content');
    const dateStr = stripHtml(tag(block, 'pubDate') || tag(block, 'published') || tag(block, 'updated') || tag(block, 'dc:date'));
    const ts = Date.parse(dateStr);
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const images = findImages(block, decodeEntities(rawDesc));
    items.push({
      source: source.name,
      weight: source.weight || 1,
      title,
      link: link.replace(/[?#].*$/, ''), // drop tracking params so the same article dedupes across runs
      snippet: truncate(stripHtml(rawDesc), snippetChars),
      publishedAt: Number.isFinite(ts) ? ts : null,
      image: images[0] || null,
      images,
    });
  }
  return items;
}

async function fetchFeed(source, cfg) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.fetch.timeoutMs);
  try {
    const res = await fetch(source.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': cfg.fetch.userAgent, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const items = parseFeed(await res.text(), source).slice(0, cfg.fetch.maxItemsPerFeed);
    return { source: source.name, ok: true, items };
  } catch (err) {
    logError('feed_failed', err, { source: source.name, url: source.url });
    return { source: source.name, ok: false, items: [], error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch all enabled feeds in parallel. A failing feed never breaks the run. */
async function collect(cfg, now = Date.now()) {
  const sources = cfg.feeds.filter(f => f.enabled !== false);
  const results = await Promise.all(sources.map(s => fetchFeed(s, cfg)));
  const cutoff = now - cfg.maxAgeHours * 3600 * 1000;
  const all = results.flatMap(r => r.items);
  // Items without a date are kept (some feeds omit it); dated items must be recent.
  const recent = all.filter(i => i.publishedAt === null || (i.publishedAt >= cutoff && i.publishedAt <= now + 3600 * 1000));
  log('rss_collected', {
    feeds: results.map(r => ({ source: r.source, ok: r.ok, items: r.items.length })),
    total: all.length, recent: recent.length,
  });
  return { items: recent, total: all.length, feedsOk: results.filter(r => r.ok).length, feedsTotal: results.length };
}

module.exports = { parseFeed, collect };
