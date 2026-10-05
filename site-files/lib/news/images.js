'use strict';
/**
 * Picks the best (largest) image for an article.
 *
 * RSS feeds usually only offer a small thumbnail. This module:
 *   1. collects candidates: the article page's og:image / twitter:image + every image the RSS item had,
 *   2. downloads just the first bytes of each and reads the real pixel size from the file header,
 *   3. keeps the widest one, and rejects it if it is narrower than cfg.minImageWidth
 *      (the website then shows a video thumbnail / gradient instead of a blurry photo).
 * It never throws: on any problem the caller keeps the image it already had.
 */

const HEAD_BYTES = 262144; // 256 KB is enough to find the size in virtually every JPEG/PNG/WebP/GIF

/** Read width/height from the first bytes of an image file. Returns {width,height} or null. */
function imageSize(b) {
  if (!b || b.length < 24) return null;
  // PNG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  }
  // GIF
  if (b.toString('ascii', 0, 4) === 'GIF8') {
    return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
  }
  // WebP
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const kind = b.toString('ascii', 12, 16);
    if (kind === 'VP8 ' && b.length >= 30) return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (kind === 'VP8L' && b.length >= 25) {
      return {
        width: 1 + (((b[22] & 0x3f) << 8) | b[21]),
        height: 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6)),
      };
    }
    if (kind === 'VP8X' && b.length >= 30) return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    return null;
  }
  // JPEG: walk the markers until a "start of frame"
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

async function readLimited(res, limit) {
  if (!res.body || !res.body.getReader) return Buffer.from(await res.arrayBuffer()).subarray(0, limit);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
    total += value.length;
  }
  try { await reader.cancel(); } catch (_) { /* ignore */ }
  return Buffer.concat(chunks).subarray(0, limit);
}

async function timedFetch(url, init, cfg, fetchImpl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.imageTimeoutMs || 5000);
  try {
    return await fetchImpl(url, { ...init, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/** Width of the image at `url`, or null if it cannot be measured. */
async function measure(url, cfg, fetchImpl) {
  try {
    const res = await timedFetch(url, {
      headers: { 'User-Agent': cfg.fetch.userAgent, Accept: 'image/*', Range: `bytes=0-${HEAD_BYTES - 1}` },
    }, cfg, fetchImpl);
    if (!res.ok) return null;
    const size = imageSize(await readLimited(res, HEAD_BYTES));
    return size && size.width > 0 ? { url, ...size } : null;
  } catch (_) {
    return null;
  }
}

const META_RE = /<meta\b[^>]*>/gi;
function metaImages(html, pageUrl) {
  const out = [];
  for (const tag of html.match(META_RE) || []) {
    const key = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag);
    const val = /content\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!key || !val) continue;
    if (!/^(og:image(:secure_url|:url)?|twitter:image(:src)?)$/i.test(key[1])) continue;
    try {
      const u = new URL(val[1].replace(/&amp;/g, '&'), pageUrl).toString();
      if (/^https:\/\//i.test(u)) out.push(u);
    } catch (_) { /* ignore bad url */ }
  }
  return out;
}

/** og:image / twitter:image of an article page (the full-size picture the publisher shares). */
async function pageImages(pageUrl, cfg, fetchImpl) {
  try {
    const res = await timedFetch(pageUrl, {
      headers: { 'User-Agent': cfg.fetch.userAgent, Accept: 'text/html,application/xhtml+xml' },
    }, cfg, fetchImpl);
    if (!res.ok) return [];
    const html = (await readLimited(res, 400000)).toString('utf8');
    return metaImages(html, res.url || pageUrl);
  } catch (_) {
    return [];
  }
}

/**
 * @param {{rssImages:string[], pages:string[]}} input
 * @returns {{decided:boolean,url:string|null,width:number|null,note:string}}
 *   decided=false  -> nothing could be measured; caller should keep the image it already has.
 */
async function pickBest({ rssImages = [], pages = [] }, cfg, { fetchImpl = fetch } = {}) {
  const minWidth = cfg.minImageWidth || 0;
  const fromPages = (await Promise.all(pages.map(p => pageImages(p, cfg, fetchImpl)))).flat();
  const candidates = [...new Set([...fromPages, ...rssImages])].slice(0, 8);
  if (!candidates.length) return { decided: false, url: null, width: null, note: 'no image candidates' };

  const measured = (await Promise.all(candidates.map(u => measure(u, cfg, fetchImpl)))).filter(Boolean);
  if (!measured.length) return { decided: false, url: null, width: null, note: 'could not measure any image' };

  // Widest wins; on a tie the earlier candidate (page og:image) wins because sort is stable.
  measured.sort((a, b) => b.width - a.width);
  const best = measured[0];
  if (best.width < minWidth) {
    return { decided: true, url: null, width: best.width, note: `best image only ${best.width}px wide (< ${minWidth}px) - skipped` };
  }
  return { decided: true, url: best.url, width: best.width, note: `${best.width}x${best.height}` };
}

module.exports = { pickBest, imageSize, metaImages, measure };
