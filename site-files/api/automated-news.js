'use strict';
/**
 * GET /api/automated-news                       -> production run (called by Vercel Cron)
 * GET /api/automated-news?test=true             -> dry run: returns the generated articles, saves NOTHING
 * GET /api/automated-news?test=true&save=draft  -> same, but saves valid articles as status=draft
 * GET /api/automated-news?test=true&stage=candidates -> no AI call (free): shows what the editor would see
 *
 * Every mode requires:  Authorization: Bearer <CRON_SECRET>
 * (Vercel Cron sends this header automatically when the CRON_SECRET env var is set.)
 */
const crypto = require('crypto');
const pipeline = require('../lib/news/pipeline');

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

  const q = req.query || {};
  const isTest = q.test === 'true';
  const mode = isTest ? (q.save === 'draft' ? 'draft' : 'test') : 'publish';
  const stage = q.stage === 'candidates' ? 'candidates' : 'full';

  // Support both module.exports = { run } AND module.exports = run
  const runFn = typeof pipeline === 'function' ? pipeline : (pipeline.run || pipeline.default);

  if (typeof runFn !== 'function') {
    return res.status(500).json({
      error: 'Pipeline export error: run is not a function in lib/news/pipeline.js'
    });
  }

  const report = await runFn({ mode, stage });
  return res.status(report.error ? 502 : 200).json(report);
};