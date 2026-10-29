'use strict';
// Saturday "Weekend Preview" email: picks the 5 biggest games from Saturday and Sunday and
// sends them to your Brevo mailing list as a campaign.
// Lives in _lib so it does not count as an extra Vercel function (Hobby limit: 12).
// Called by a Vercel cron from api/scores.js:  GET /api/scores?action=weekly-preview
//
// Env vars (Vercel -> Settings -> Environment Variables):
//   CRON_SECRET            any long random text. Vercel sends it automatically with every cron call.
//   BREVO_API_KEY          already set
//   BREVO_LIST_ID          newsletter opt-in list ONLY (never an all-accounts list).
//   BREVO_SENDER_EMAIL     a sender you verified in Brevo (Senders, Domains & Dedicated IPs)
//   BREVO_SENDER_NAME      optional, default "Football Stories 96"
//   SITE_URL               optional, e.g. https://your-domain.com  (used for the buttons/links)
//   WEEKLY_PREVIEW_SEND    "true" = send automatically. Anything else = only create a DRAFT in Brevo for you to check.
//   API_FOOTBALL_KEY      same key the website uses. The email costs at most 2 calls per week (Saturday + Sunday),
//                         and 0 if visitors already loaded those days in the last 25 minutes.
//   BREVO_PREVIEW_LIST_IDS optional, e.g. "3,7": send to several opt-in lists. Default = BREVO_LIST_ID only.
//
// Testing (all need the header  Authorization: Bearer <CRON_SECRET>):
//   /api/scores?action=weekly-preview&dry=1    any day: returns the email HTML (today + tomorrow), sends nothing
//   /api/scores?action=weekly-preview&test=1   any day: creates a DRAFT in Brevo (never sends), today + tomorrow

const { fixturesForDate } = require('./fixtures');
const { rankUpcoming } = require('./match-priority');

const TZ = 'Europe/Lisbon';        // kickoff times in the email are shown in this timezone
const TZ_LABEL = 'Lisbon time';
const HOW_MANY = 5;

// Same competitions as api/scores.js
const LEAGUES = {
  39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
  2: 'Champions League', 3: 'Europa League', 71: 'Brasileirão Série A', 94: 'Primeira Liga',
  5: 'UEFA Nations League', 29: 'Africa Cup of Nations - Qualification',
};

/* ---------- dates ---------- */
function localDay(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d); } // YYYY-MM-DD
function addDays(ymd, n) {
  var p = ymd.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}
function kickoffLabel(iso) {
  var parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).forEach(function (p) { parts[p.type] = p.value; });
  return (parts.weekday + ' ' + parts.day + ' ' + parts.month).toUpperCase() + ' · ' + parts.hour + ':' + parts.minute;
}

/* ---------- pick the games ---------- */
// The window is TODAY + TOMORROW, the only days your API-Football plan allows.
// On the Saturday 01:00 UTC cron that is exactly Saturday + Sunday.
async function pickGames(now) {
  const lisbonDays = [localDay(now), addDays(localDay(now), 1)];
  const utcToday = now.toISOString().slice(0, 10);
  const utcDays = [utcToday, addDays(utcToday, 1)];
  let all = [];
  let available = 0;
  const sources = [];
  for (const day of utcDays) {
    const r = await fixturesForDate(day);
    sources.push(day + ':' + r.source);
    if (Array.isArray(r.fixtures)) { available++; all = all.concat(r.fixtures); }
  }
  const seen = new Set();
  const unique = [];
  for (const f of all) {
    if (!f || seen.has(f.id) || !f.date) continue;
    seen.add(f.id);
    if (lisbonDays.includes(localDay(new Date(f.date)))) unique.push(f);
  }
  const games = rankUpcoming(unique, HOW_MANY)
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  return { games, available, total: utcDays.length, sources };
}

/* ---------- the email ---------- */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function img(u) { return /^https:\/\//i.test(u || '') ? u : ''; }

function teamCell(t, align) {
  var logo = img(t.logo);
  var im = logo ? '<img src="' + esc(logo) + '" width="44" height="44" alt="" style="display:block;margin:0 auto 8px;width:44px;height:44px;object-fit:contain;">' : '';
  return '<td width="40%" align="center" valign="top" style="padding:0 6px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#F4F3F6;">' + im + esc(t.name) + '</td>';
}

function buildHtml(games, siteUrl, subject, intro) {
  var base = String(siteUrl || '').replace(/\/+$/, '');
  var rows = games.map(function (g, i) {
    return '<tr><td style="padding-bottom:14px;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#17151C" style="background:#17151C;border:1px solid #2a2635;border-radius:16px;">' +
      '<tr><td width="6" bgcolor="' + (i % 2 ? '#FF7A1A' : '#8A3FFC') + '" style="width:6px;background:' + (i % 2 ? '#FF7A1A' : '#8A3FFC') + ';border-radius:16px 0 0 16px;font-size:0;line-height:0;">&nbsp;</td>' +
      '<td style="padding:18px 16px;">' +
      '<div style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2px;color:' + (i % 2 ? '#FF9540' : '#A868FF') + ';text-transform:uppercase;text-align:center;">' + esc(kickoffLabel(g.date)) + '</div>' +
      '<div style="font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;color:#8D889A;text-align:center;padding:4px 0 14px;">' + esc(g.league.name) + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
      teamCell(g.home) +
      '<td width="20%" align="center" valign="middle" style="font-family:\'Big Shoulders Display\',Impact,Arial,sans-serif;font-weight:800;font-size:26px;color:#6B6677;">VS</td>' +
      teamCell(g.away) +
      '</tr></table></td></tr></table></td></tr>';
  }).join('');

  var btn = base
    ? '<tr><td align="center" style="padding:10px 0 4px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#8A3FFC" style="border-radius:14px;background:#8A3FFC;background-image:linear-gradient(135deg,#9a55ff,#6a2ad6);"><a href="' + esc(base) + '/matches.html" target="_blank" style="display:inline-block;padding:15px 30px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#ffffff;border-radius:14px;">See all games &rarr;</a></td></tr></table></td></tr>'
    : '';
  var logo = base ? '<td valign="middle" style="padding-right:14px;"><img src="' + esc(base) + '/football-stories-logo.png" width="42" alt="" style="display:block;width:42px;height:auto;"></td>' : '';

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><title>' + esc(subject) + '</title>' +
    '<style>@import url(\'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Inter:wght@400;600;700&display=swap\');body{margin:0;padding:0;background:#08070A}@media only screen and (max-width:620px){.wrap{width:100%!important}.px{padding-left:18px!important;padding-right:18px!important}.h1{font-size:50px!important;line-height:50px!important}}</style></head>' +
    '<body style="margin:0;padding:0;background:#08070A;">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#08070A;font-size:1px;">The biggest games from Saturday and Sunday, in kickoff order.</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#08070A" style="background:#08070A;"><tr><td align="center" style="padding:28px 12px 36px;">' +
    '<table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">' +
    '<tr><td bgcolor="#121116" style="background:#121116;background-image:linear-gradient(160deg,#26124a 0%,#15101f 45%,#121116 100%);border-radius:24px 24px 0 0;border:1px solid #2a2635;border-bottom:0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="5" bgcolor="#8A3FFC" style="height:5px;line-height:5px;font-size:0;background:#8A3FFC;background-image:linear-gradient(90deg,#8A3FFC,#FF7A1A);border-radius:24px 24px 0 0;">&nbsp;</td></tr></table>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" class="px" style="padding:34px 36px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"><tr>' + logo +
    '<td valign="middle" style="font-family:\'Big Shoulders Display\',Impact,Arial,sans-serif;font-weight:800;font-size:32px;line-height:34px;letter-spacing:.02em;color:#F4F3F6;text-transform:uppercase;">Football Stories</td></tr></table></td></tr>' +
    '<tr><td align="center" class="px h1" style="padding:16px 36px 0;font-family:\'Big Shoulders Display\',Impact,Arial,sans-serif;font-weight:900;font-size:64px;line-height:62px;color:#F4F3F6;text-transform:uppercase;letter-spacing:1px;">Weekend preview</td></tr>' +
    '<tr><td align="center" class="px" style="padding:14px 48px 28px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:16px;line-height:25px;color:#C4BFD1;">' + esc(intro || ('The ' + games.length + ' biggest games on Saturday and Sunday.')) + ' Kickoff times are in ' + esc(TZ_LABEL) + '.</td></tr></table>' +
    '</td></tr>' +
    '<tr><td bgcolor="#0E0D12" class="px" style="background:#0E0D12;border-left:1px solid #2a2635;border-right:1px solid #2a2635;padding:26px 30px 22px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + rows + btn + '</table></td></tr>' +
    '<tr><td bgcolor="#0A090D" align="center" class="px" style="background:#0A090D;border:1px solid #2a2635;border-top:0;border-radius:0 0 24px 24px;padding:24px 36px 28px;font-family:Inter,Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#6F6A7A;">' +
    'You are getting this because you subscribed to Football Stories updates.<br><a href="{{ unsubscribe }}" style="color:#A7A2B3;text-decoration:underline;">Unsubscribe</a> &nbsp;&middot;&nbsp; <a href="{{ mirror }}" style="color:#A7A2B3;text-decoration:underline;">View in browser</a></td></tr>' +
    '</table></td></tr></table></body></html>';
}

/* ---------- Brevo ---------- */
async function brevo(path, method, body) {
  var r = await fetch('https://api.brevo.com/v3' + path, {
    method: method,
    headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  var text = await r.text().catch(function () { return ''; });
  var data = null; try { data = text ? JSON.parse(text) : null; } catch (e) {}
  return { status: r.status, ok: r.ok, data: data || {}, text: text };
}

/* ---------- Strict, durable send protection ---------- */
// Unlike the website's best-effort cache, this never falls back to process memory.
// One atomic Redis SET NX EX reserves the Saturday campaign before any Brevo call.
async function redisRequired(parts) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('shared_redis_required');
  const response = await fetch(url.replace(/\/+$/, ''), {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify(parts),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('redis_http_' + response.status);
  const body = await response.json();
  if (!body || Object.prototype.hasOwnProperty.call(body, 'error')) throw new Error('redis_command_failed');
  return body.result;
}
async function recordCampaign(key, state) {
  // SET with expiry is ONE operation; errors always abort sending.
  const result = await redisRequired(['SET', key, JSON.stringify(state), 'EX', 9 * 86400]);
  if (result !== 'OK') throw new Error('redis_record_not_confirmed');
}
async function reserveCampaign(key, state) {
  const result = await redisRequired(['SET', key, JSON.stringify(state), 'NX', 'EX', 9 * 86400]);
  if (result === 'OK') return true;
  if (result === null) return false;
  throw new Error('redis_reservation_not_confirmed');
}

/* ---------- entry point ---------- */
async function handleWeeklyPreview(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  const secret = process.env.CRON_SECRET;
  if (!secret) return res.status(503).json({ ok: false, error: 'CRON_SECRET_not_configured' });
  if (String(req.headers.authorization || '') !== 'Bearer ' + secret)
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  // Fail closed when distributed cache isn't configured; otherwise a retry on
  // a different server instance could create duplicate Brevo campaigns.
  const { upstashConfigured } = require('./cache');
  if (!upstashConfigured()) return res.status(503).json({ ok: false, error: 'shared_redis_required' });
  try {
    const now = new Date();
    const saturday = localDay(now);
    const q = req.query || {};
    const isDry = String(q.dry || '') === '1';
    const isTest = String(q.test || '') === '1';   // draft only, never sends, any day
    // A manual retry on a different day must not accidentally send.
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(now);
    if (weekday !== 'Sat' && !isDry && !isTest) return res.status(200).json({ ok: true, skipped: 'not_saturday_lisbon' });
    const data = await pickGames(now);
    const { games } = data;
    if (data.available !== data.total) return res.status(503).json({ ok: false, error: 'incomplete_weekend_data_no_campaign_created', daysLoaded: data.available, checkedDays: data.total, sources: data.sources });
    if (!games.length) return res.status(200).json({ ok: true, skipped: 'no_fixtures_found', daysLoaded: data.available, checkedDays: data.total, sources: data.sources });
    const siteUrl = process.env.SITE_URL || (req.headers.host ? 'https://' + req.headers.host : '');
    const testing = isDry || isTest || weekday !== 'Sat';
    const subject = (testing ? '[TEST] ' : '') + 'Weekend preview: the ' + games.length + ' games you cannot miss';
    const intro = testing ? 'TEST EMAIL: the ' + games.length + ' biggest games today and tomorrow.' : undefined;
    const html = buildHtml(games, siteUrl, subject, intro);
    if (isDry) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(html);
    }
    const listSource = String(process.env.BREVO_PREVIEW_LIST_IDS || process.env.BREVO_LIST_ID || '');
    const lists = listSource.split(',').map(x => Number(String(x).trim())).filter(n => Number.isSafeInteger(n) && n > 0);
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    if (!process.env.BREVO_API_KEY || !lists.length || !senderEmail)
      return res.status(503).json({ ok: false, error: 'brevo_configuration_missing' });

    // Tests are drafts only and use unique names: never occupy the real weekly reservation.
    // A real Saturday gets exactly one durable reservation; ambiguous errors stay blocked.
    const guard = 'weekly-preview:campaign:' + saturday;
    if (!isTest) {
      const reserved = await reserveCampaign(guard, { state: 'creating', at: now.toISOString() });
      if (!reserved) return res.status(200).json({ ok: true, skipped: 'already_attempted_check_brevo' });
    }

    const created = await brevo('/emailCampaigns', 'POST', {
      name: (isTest ? 'TEST Weekend Preview ' : 'Weekend Preview ') + saturday + (isTest ? ' ' + now.toISOString() : ''),
      subject,
      sender: { name: process.env.BREVO_SENDER_NAME || 'Football Stories', email: senderEmail },
      htmlContent: html,
      recipients: { listIds: [...new Set(lists)] },
    });
    if (!created.ok || !created.data.id) {
      console.error('Brevo draft creation failed', created.status, created.text.slice(0, 200));
      // Never erase the reservation automatically: an ambiguous response might mean a draft exists.
      if (!isTest) await recordCampaign(guard, { state: 'create_unconfirmed', brevoStatus: created.status, at: new Date().toISOString() });
      return res.status(502).json({ ok: false, error: 'brevo_create_failed_inspect_dashboard', brevoStatus: created.status });
    }
    const campaignId = created.data.id;
    if (!isTest) await recordCampaign(guard, { state: 'draft', campaignId });
    const automatic = !isTest && !testing && String(process.env.WEEKLY_PREVIEW_SEND || '').toLowerCase() === 'true';
    if (!automatic) {
      return res.status(200).json({ ok: true, createdDraft: true, automatic: false, campaignId,
        matches: games.map(g => g.home.name + ' vs ' + g.away.name), sources: data.sources });
    }
    // Must be confirmed by Redis before we ask Brevo to send. An uncertain send
    // is never retried by this function: inspect its status in Brevo instead.
    await recordCampaign(guard, { state: 'send_attempted', campaignId, at: new Date().toISOString() });
    const sent = await brevo('/emailCampaigns/' + encodeURIComponent(campaignId) + '/sendNow', 'POST');
    if (!sent.ok) {
      console.error('Brevo campaign send failed', sent.status, sent.text.slice(0, 200));
      return res.status(502).json({ ok: false, error: 'brevo_send_unconfirmed_check_dashboard', campaignId,
        brevoStatus: sent.status });
    }
    await recordCampaign(guard, { state: 'send_requested', campaignId, at: new Date().toISOString() });
    return res.status(200).json({ ok: true, automatic: true, sendRequested: true, campaignId,
      matches: games.map(g => g.home.name + ' vs ' + g.away.name), sources: data.sources });
  } catch (err) {
    console.error('weekly-preview error', err && err.message);
    return res.status(502).json({ ok: false, error: 'newsletter_preparation_failed' });
  }
}

module.exports = { handleWeeklyPreview, _test: { buildHtml, pickGames } };
