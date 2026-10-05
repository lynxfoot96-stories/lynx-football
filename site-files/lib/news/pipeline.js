'use strict';
const defaultConfig = require('./config');
const rss = require('./rss');
const { cluster, prefilter, dropAlreadyPublished } = require('./dedupe');
const ai = require('./ai');
const { validateArticle } = require('./validate');
const db = require('./db');
const { todayISO } = require('./text');
const { log, logError } = require('./log');

/**
 * Full run: RSS -> dedupe -> filter -> ONE AI call -> validate -> save.
 */
async function run({ mode = 'publish', stage = 'full', cfg = defaultConfig, deps = {} } = {}) {
  const d = { rss, ai, db, now: new Date(), ...deps };
  const report = { mode, startedAt: d.now.toISOString(), published: 0, saved: [], rejected: [], notes: [] };
  const today = todayISO(d.now);
  log('job_started', { mode, stage });

  try {
    // 1. Check existing published news
    let published = [];
    try {
      published = await d.db.recentPublished(cfg.dedupeLookbackDays);
      if (mode === 'publish') {
        const already = await d.db.publishedTodayCount(today);
        report.alreadyPublishedToday = already;
        if (already >= cfg.maxPublishedPerDay) {
          report.notes.push(`daily cap reached (${already}/${cfg.maxPublishedPerDay}) — nothing to do`);
          log('daily_cap_reached', { already });
          return report;
        }
      }
    } catch (err) {
      if (mode === 'publish') throw err;
      report.notes.push(`database unavailable in test mode (${err.message}) — duplicate check skipped`);
      logError('db_unavailable_test_mode', err);
    }
    const remainingToday = Math.max(0, cfg.maxPublishedPerDay - (report.alreadyPublishedToday || 0));
    const maxArticles = Math.min(cfg.maxArticlesPerRun, mode === 'publish' ? remainingToday : cfg.maxArticlesPerRun);

    // 2. Fetch + parse RSS feeds safely
    let collected = { total: 0, items: [], feedsOk: 0, feedsTotal: 0 };
    try {
      collected = await d.rss.collect(cfg, d.now.getTime());
    } catch (rssErr) {
      logError('rss_collection_failed', rssErr);
      report.notes.push(`RSS feed collection warning: ${rssErr.message}`);
    }

    report.rssCollected = collected.total;
    report.rssRecent = collected.items.length;
    report.feeds = `${collected.feedsOk}/${collected.feedsTotal} feeds reachable`;
    if (!collected.items || !collected.items.length) {
      report.notes.push('no recent RSS items — nothing published');
      log('no_rss_items', {});
      return report;
    }

    // 3. Dedupe, filter, rank
    const clusters = cluster(collected.items);
    report.duplicatesRemoved = collected.items.length - clusters.length;
    const filtered = prefilter(clusters, cfg);
    const candidates = dropAlreadyPublished(filtered, published);
    report.candidatesSentToAI = candidates.length;
    log('candidates_ready', {
      clusters: clusters.length, duplicatesRemoved: report.duplicatesRemoved,
      afterFilter: filtered.length, afterPublishedCheck: candidates.length,
    });

    if (stage === 'candidates') {
      report.candidates = candidates.map((c, i) => ({
        id: i + 1, sources: c.sources, score: Math.round(c.score * 10) / 10,
        titles: c.items.map(x => `[${x.source}] ${x.title}`),
      }));
      return report;
    }
    if (!candidates.length) {
      report.notes.push('no candidates left after filtering — nothing published');
      return report;
    }

    // 4. AI Call safely
    const recentTitles = published.map(p => p.title).slice(0, 30);
    let result = { articles: [], model: 'none', usage: null };
    try {
      result = await d.ai.editorialCall(candidates, recentTitles, cfg);
    } catch (aiErr) {
      logError('ai_editorial_call_failed', aiErr);
      report.notes.push(`AI processing error: ${aiErr.message}`);
      return report;
    }

    report.model = result.model;
    report.usage = result.usage;
    log('ai_response', { model: result.model, returned: (result.articles || []).length, usage: result.usage });

    // 5. Validate articles
    const used = new Set();
    const valid = [];
    const rawArticles = Array.isArray(result.articles) ? result.articles : [];
    for (const raw of rawArticles.slice(0, maxArticles)) {
      const ids = Array.isArray(raw.candidate_ids) ? raw.candidate_ids : [];
      if (ids.some(id => used.has(id))) {
        report.rejected.push({ title: raw.title, errors: ['overlaps another selected story'] });
        continue;
      }
      const v = validateArticle(raw, candidates, cfg, { recentTitles, now: d.now });
      if (!v.ok) {
        report.rejected.push({ title: raw.title, errors: v.errors });
        log('article_rejected', { title: raw.title, errors: v.errors });
        continue;
      }
      ids.forEach(id => used.add(id));
      valid.push(v.article);
    }
    log('articles_selected', { titles: valid.map(a => a.title) });

    // 6. Save to Supabase
    if (mode === 'test') {
      report.saved = valid.map(a => ({ ...a, status: 'not saved (test mode)' }));
      return report;
    }
    const status = mode === 'draft' ? 'draft' : 'published';
    for (const article of valid) {
      try {
        const r = await d.db.insertArticle(article, status);
        report.saved.push({ slug: article.slug, title: article.title, status: r === 'saved' ? status : 'duplicate (skipped)' });
        if (r === 'saved' && status === 'published') report.published++;
        log(r === 'saved' ? 'article_saved' : 'article_duplicate', { slug: article.slug, status });
      } catch (err) {
        report.saved.push({ slug: article.slug, title: article.title, status: 'error' });
        logError('article_save_failed', err, { slug: article.slug });
      }
    }
    log('job_finished', { published: report.published, saved: report.saved.length });
    return report;
  } catch (err) {
    logError('job_failed', err);
    report.error = err.message;
    return report;
  }
}

module.exports = { run };