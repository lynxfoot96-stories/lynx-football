'use strict';
const { wordCount, tokens, jaccard, slugify, fold } = require('./text');

const QUOTE_CHARS = /["“”«»„]/;

function digitsIn(s) {
  return (String(s).match(/\d+/g) || []);
}

/**
 * Validate one AI-written article against the house style and basic factual guard-rails.
 * Returns { ok, errors, article } — article is the cleaned record when ok.
 */
function validateArticle(raw, candidates, cfg, { recentTitles = [], now = new Date() } = {}) {
  const errors = [];
  const s = cfg.style;
  const str = v => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');

  const title = str(raw.title).replace(/[.]+$/, '');
  const summary = str(raw.summary);
  const highlight = str(raw.highlight);
  const category = str(raw.category);
  const body = Array.isArray(raw.body) ? raw.body.map(str).filter(Boolean) : [];
  const ids = Array.isArray(raw.candidate_ids) ? [...new Set(raw.candidate_ids.filter(Number.isInteger))] : [];

  const cited = ids.map(id => candidates[id - 1]).filter(Boolean);
  if (!cited.length) errors.push('no valid candidate_ids');

  const tw = wordCount(title);
  if (tw < s.title.minWords || tw > s.title.maxWords || title.length > s.title.maxChars) errors.push(`title length (${tw} words)`);
  if (/[!?]/.test(title)) errors.push('title contains ! or ?');

  const sw = wordCount(summary);
  if (sw < s.summary.minWords || sw > s.summary.maxWords) errors.push(`summary length (${sw} words)`);

  if (body.length < s.paragraphs.min || body.length > s.paragraphs.max) errors.push(`paragraph count (${body.length})`);
  const total = body.reduce((n, p) => n + wordCount(p), 0);
  if (total < s.bodyWords.min || total > s.bodyWords.max) errors.push(`body length (${total} words)`);
  if (body.some(p => wordCount(p) < s.paragraphs.minWords || wordCount(p) > s.paragraphs.maxWords)) errors.push('paragraph too short/long');

  const hw = wordCount(highlight);
  if (hw < s.highlight.minWords || hw > s.highlight.maxWords) errors.push(`highlight length (${hw} words)`);

  const all = [title, summary, highlight, ...body].join(' ');
  if (QUOTE_CHARS.test(all)) errors.push('contains quotation marks (quotes are not allowed)');
  if (/[<>]|\*\*|^#|\n-\s/m.test(all)) errors.push('contains markup');

  // Category: configured list, or (if allowed) a short club-style name.
  const known = cfg.categories.find(c => fold(c) === fold(category));
  let finalCategory = known || '';
  if (!finalCategory && cfg.allowClubAsCategory && /^[A-Za-zÀ-ÿ0-9'. -]{2,28}$/.test(category)) finalCategory = category;
  if (!finalCategory) errors.push(`category not allowed (${category})`);

  // Anti-fabrication guard: every number written must appear in the cited source text.
  const sourceText = cited.flatMap(c => c.items.map(i => `${i.title} ${i.snippet}`)).join(' ');
  const allowedDigits = new Set([...digitsIn(sourceText), String(now.getUTCFullYear())]);
  const badNums = [...new Set(digitsIn(all))].filter(d => !allowedDigits.has(d));
  if (badNums.length) errors.push(`numbers not found in sources: ${badNums.slice(0, 5).join(', ')}`);

  // Not a repeat of something recently published.
  const tt = tokens(title);
  if (recentTitles.some(t => jaccard(tt, tokens(t)) >= 0.5)) errors.push('too similar to a recently published headline');

  if (errors.length) return { ok: false, errors, article: null };

  const primary = [...cited].sort((a, b) => b.primary.weight - a.primary.weight)[0].primary;
  const image = cfg.useSourceImages ? (cited.map(c => c.items.find(i => i.image)).find(Boolean) || {}).image || null : null;
  const iso = now.toISOString().slice(0, 10);

  return {
    ok: true,
    errors: [],
    article: {
      slug: `${slugify(title, 56)}-${iso.slice(5)}`,
      title,
      summary,
      body,
      highlight,
      category: finalCategory,
      published_date: iso,
      source_name: primary.source,
      source_url: primary.link,
      source_urls: [...new Set(cited.flatMap(c => c.items.map(i => i.link)))],
      image_url: image,
    },
  };
}

module.exports = { validateArticle };
