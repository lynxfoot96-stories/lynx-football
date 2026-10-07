'use strict';
/**
 * GET /api/automated-news-openrouter                       -> production run (called by Vercel Cron, daily @ 8:00 PM)
 * GET /api/automated-news-openrouter?test=true             -> dry run: returns the generated articles, saves NOTHING
 * GET /api/automated-news-openrouter?test=true&save=draft  -> same, but saves valid articles as status=draft
 * GET /api/automated-news-openrouter?test=true&stage=candidates -> no AI call (free): shows what the editor would see
 *
 * This is the SECOND, independent news pipeline. It reuses the exact same
 * engine as /api/automated-news (lib/news/pipeline.js) -- same RSS collection,
 * same dedupe/validate/save logic, same house style -- but:
 *   - calls OpenRouter instead of Groq for the editorial AI step (lib/news/ai-openrouter.js)
 *   - uses its own feed/filter config (lib/news/config-openrouter.js)
 *   - is tagged pipeline='openrouter' in Supabase, so its daily publish cap is
 *     tracked separately from the Groq pipeline's cap
 *
 * Cross-pipeline duplicate protection still applies: both pipelines check
 * against ALL recently published articles (regardless of which pipeline wrote
 * them), so Groq and OpenRouter can never both publish the same story.
 *
 * Every mode requires: Authorization: Bearer <CRON_SECRET>
 * (same secret as the Groq pipeline -- Vercel Cron sends it automatically.)
 */
const crypto = require('crypto');
const pipeline = require('../lib/news/pipeline');
const openrouterAi = require('../lib/news/ai-openrouter');
const openrouterCfg = require('../lib/news/config-openrouter');

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed: no secret configured => nobody gets in
  const header = String(req.headers['authorization'] || '');
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.CRON_SECRET) {
    return res.status(500).json({ error: 'CRON_SECRET is not configured on the server' });
  }
  if (!authorised(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured on the server' });
  }

  const q = req.query || {};
  const isTest = q.test === 'true';
  const mode = isTest ? (q.save === 'draft' ? 'draft' : 'test') : 'publish';
  const stage = q.stage === 'candidates' ? 'candidates' : 'full';

  const report = await pipeline.run({
    mode,
    stage,
    cfg: openrouterCfg,
    pipelineName: 'openrouter',
    deps: { ai: openrouterAi },
  });

  return res.status(report.error ? 502 : 200).json(report);
};
