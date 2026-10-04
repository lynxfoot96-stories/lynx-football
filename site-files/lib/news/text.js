'use strict';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STOP = new Set(('a an and are as at be by for from has have he her his in is it its of on or that the their ' +
  'they this to was were will with after over into out up how what why who when new says say said could would ' +
  'should may might report reports latest news first second all not but more than just about against vs v').split(' '));

function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function stripHtml(s) {
  return decodeEntities(String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ').trim();
}

function truncate(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
}

function fold(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function tokens(s) {
  return new Set(fold(s).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t)));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / Math.min(a.size, b.size);
}

function slugify(s, max = 60) {
  const slug = fold(s).replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/, '') || 'story';
}

function wordCount(s) {
  return String(s).trim().split(/\s+/).filter(Boolean).length;
}

// 'YYYY-MM-DD' -> 'Sep 24, 2026' (the exact format used on the existing site; no timezone maths).
function dateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return '';
  return `${MONTHS[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

function todayISO(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

module.exports = { decodeEntities, stripHtml, truncate, fold, tokens, jaccard, overlap, slugify, wordCount, dateLabel, todayISO };
