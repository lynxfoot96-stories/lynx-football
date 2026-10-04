'use strict';
const { tokens, jaccard, overlap, fold } = require('./text');

function sameStory(a, b) {
  if (a.link === b.link) return true;
  const ta = a._tok, tb = b._tok;
  const j = jaccard(ta, tb);
  const o = overlap(ta, tb);
  // Same event worded differently: high overlap on a reasonable number of distinctive words.
  return j >= 0.45 || (o >= 0.7 && Math.min(ta.size, tb.size) >= 4);
}

/**
 * Group RSS items that describe the same event. Returns clusters (one per story) with every
 * source that covered it. Lexical only — semantic duplicates ("scores twice" vs "nets brace")
 * are caught later by the AI editor, which is told to merge candidates about the same event.
 */
function cluster(items) {
  const clusters = [];
  for (const raw of items) {
    const item = { ...raw, _tok: tokens(raw.title) };
    const home = clusters.find(c => c.items.some(x => sameStory(x, item)));
    if (home) {
      // Same outlet listing the same story twice should not count as extra confirmation.
      if (!home.items.some(x => x.source === item.source && x.link === item.link)) home.items.push(item);
    } else {
      clusters.push({ items: [item] });
    }
  }
  return clusters.map(c => {
    const sorted = [...c.items].sort((a, b) => (b.weight - a.weight) || ((b.publishedAt || 0) - (a.publishedAt || 0)));
    const sources = [...new Set(sorted.map(i => i.source))];
    return {
      primary: sorted[0],
      items: sorted,
      sources,
      sourceCount: sources.length,
      newestAt: Math.max(...sorted.map(i => i.publishedAt || 0)),
    };
  });
}

function score(c, cfg) {
  const text = fold(c.items.map(i => `${i.title} ${i.snippet}`).join(' '));
  let s = 0;
  for (const k of cfg.priorityKeywords) if (text.includes(k)) s += 2;
  for (const k of cfg.bigClubs) if (new RegExp(`\\b${k}\\b`).test(text)) s += 1.5;
  s += (c.sourceCount - 1) * 6;          // multi-source confirmation matters most
  s += c.primary.weight * 0.5;
  return s;
}

/** Drop low-value stories, then rank. Keeps the AI prompt small and cheap. */
function prefilter(clusters, cfg) {
  const kept = clusters.filter(c => !c.items.every(i => cfg.excludePatterns.some(p => p.test(i.title))));
  return kept.map(c => ({ ...c, score: score(c, cfg) }))
    .sort((a, b) => b.score - a.score || b.newestAt - a.newestAt)
    .slice(0, cfg.maxCandidates);
}

/** Remove candidates that match something already published recently. */
function dropAlreadyPublished(candidates, published, threshold = 0.5) {
  const urls = new Set(published.flatMap(p => [p.source_url, ...(p.source_urls || [])].filter(Boolean)));
  const pubTok = published.map(p => tokens(p.title));
  return candidates.filter(c => {
    if (c.items.some(i => urls.has(i.link))) return false;
    const t = tokens(c.primary.title);
    return !pubTok.some(pt => jaccard(t, pt) >= threshold);
  });
}

module.exports = { cluster, prefilter, dropAlreadyPublished, sameStory };
