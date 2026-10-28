'use strict';
// Account system (sign up / log in / log out / who am I / password reset).
// Lives in _lib so it does NOT count as an extra Vercel function (Hobby limit: 12).
// It is called from api/scores.js:  /api/scores?action=signup | login | logout | me | reset | newpassword
//
// Passwords are handled by Supabase Auth (they are never stored or seen by this code).
// New members who tick the marketing box are also added to Brevo.
//
// Env vars (Vercel -> Settings -> Environment Variables):
//   SUPABASE_URL                 already set (same one the news system uses)
//   SUPABASE_SERVICE_ROLE_KEY    already set
//   BREVO_API_KEY                already set (newsletter)
//   BREVO_LIST_ID                already set (newsletter list). Members go here too...
//   BREVO_MEMBERS_LIST_ID        OPTIONAL: numeric id of a separate "Members" list in Brevo

const AT = 'fs_at'; // access cookie
const RT = 'fs_rt'; // refresh cookie

/* ---------- small helpers ---------- */
function sbCfg() {
  var url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  var key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url, key: key };
}

async function gotrue(path, opts) {
  opts = opts || {};
  var c = sbCfg();
  if (!c) throw new Error('supabase_not_configured');
  var headers = { apikey: c.key, 'content-type': 'application/json' };
  headers.authorization = 'Bearer ' + (opts.token || c.key);
  var r = await fetch(c.url + '/auth/v1' + path, {
    method: opts.method || 'POST',
    headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  var data = null;
  var text = await r.text().catch(function () { return ''; });
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
  return { status: r.status, ok: r.ok, data: data || {} };
}

function parseCookies(req) {
  var out = {};
  String(req.headers.cookie || '').split(';').forEach(function (p) {
    var i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function cookie(req, name, value, maxAge) {
  var host = String(req.headers.host || '');
  var secure = /^localhost|^127\./.test(host) ? '' : '; Secure';
  return name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + secure;
}

function setSession(req, res, s) {
  res.setHeader('Set-Cookie', [
    cookie(req, AT, s.access_token, Math.max(60, Number(s.expires_in) || 3600)),
    cookie(req, RT, s.refresh_token, 60 * 60 * 24 * 30)
  ]);
}

function clearSession(req, res) {
  res.setHeader('Set-Cookie', [cookie(req, AT, '', 0), cookie(req, RT, '', 0)]);
}

function body(req) {
  var b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  return b || {};
}

function publicUser(u) {
  var m = (u && u.user_metadata) || {};
  return { name: String(m.name || '').slice(0, 60) || String((u && u.email) || '').split('@')[0], email: u && u.email };
}

function validEmail(e) { return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

// Block cross-site form posts: if the browser sends an Origin, it must be this site.
function sameOrigin(req) {
  var o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers.host || ''); } catch (e) { return false; }
}

/* ---------- Brevo: add the new member to your mailing list ---------- */
async function addToBrevo(email, name) {
  var key = process.env.BREVO_API_KEY;
  var listId = Number(process.env.BREVO_MEMBERS_LIST_ID) || Number(process.env.BREVO_LIST_ID);
  if (!key || !listId) { console.error('Brevo not configured, member not added to list'); return false; }
  try {
    var r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        email: email,
        listIds: [listId],
        updateEnabled: true,
        // FIRSTNAME exists in every Brevo account; SIGNUP_SOURCE is the one your newsletter already uses.
        attributes: { FIRSTNAME: name, SIGNUP_SOURCE: 'account' }
      }),
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 201 || r.status === 204) return true;
    console.error('Brevo error', r.status, (await r.text().catch(function () { return ''; })).slice(0, 300));
  } catch (e) { console.error('Brevo request failed', e && e.message); }
  return false;
}

/* ---------- who is logged in? (refreshes an expired session automatically) ---------- */
async function currentUser(req, res) {
  var ck = parseCookies(req);
  if (ck[AT]) {
    var u = await gotrue('/user', { method: 'GET', token: ck[AT] }).catch(function () { return null; });
    if (u && u.ok && u.data && u.data.id) return u.data;
  }
  if (ck[RT]) {
    var r = await gotrue('/token?grant_type=refresh_token', { body: { refresh_token: ck[RT] } }).catch(function () { return null; });
    if (r && r.ok && r.data.access_token) {
      setSession(req, res, r.data);
      return r.data.user || null;
    }
  }
  return null;
}

/* ---------- main entry ---------- */
async function handleAuth(req, res, action) {
  res.setHeader('Cache-Control', 'no-store');

  if (!sbCfg()) return res.status(500).json({ error: 'not_configured' });

  if (action === 'me') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    var u = await currentUser(req, res);
    return res.status(200).json({ user: u ? publicUser(u) : null });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  if (!sameOrigin(req)) return res.status(403).json({ error: 'forbidden' });

  var b = body(req);

  try {
    /* ----- SIGN UP ----- */
    if (action === 'signup') {
      if (b.company) return res.status(200).json({ ok: true, needsConfirm: true }); // honeypot
      var name = String(b.name || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 60);
      var email = String(b.email || '').trim().toLowerCase();
      var pw = String(b.password || '');
      if (!name) return res.status(400).json({ error: 'name_required' });
      if (!validEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      if (pw.length < 8 || pw.length > 72) return res.status(400).json({ error: 'weak_password' });

      var r = await gotrue('/signup', { body: { email: email, password: pw, data: { name: name } } });
      if (!r.ok) {
        var code = String(r.data.error_code || r.data.msg || '');
        if (/already|exists/i.test(code)) return res.status(409).json({ error: 'exists' });
        if (/weak|password/i.test(code)) return res.status(400).json({ error: 'weak_password' });
        if (r.status === 429 || /rate/i.test(code)) return res.status(429).json({ error: 'rate_limited' });
        console.error('signup failed', r.status, JSON.stringify(r.data).slice(0, 300));
        return res.status(502).json({ error: 'provider_error' });
      }

      // Only people who ticked the (unticked-by-default) marketing box go into Brevo.
      if (b.marketing === true) await addToBrevo(email, name);

      if (r.data.access_token) { // email confirmation is switched off in Supabase: log in right away
        setSession(req, res, r.data);
        return res.status(200).json({ ok: true, loggedIn: true, user: publicUser(r.data.user) });
      }
      return res.status(200).json({ ok: true, needsConfirm: true });
    }

    /* ----- LOG IN ----- */
    if (action === 'login') {
      var em = String(b.email || '').trim().toLowerCase();
      var pwd = String(b.password || '');
      if (!validEmail(em) || !pwd) return res.status(400).json({ error: 'invalid_credentials' });
      var l = await gotrue('/token?grant_type=password', { body: { email: em, password: pwd } });
      if (!l.ok) {
        var lc = String(l.data.error_code || '');
        if (lc === 'email_not_confirmed') return res.status(403).json({ error: 'email_not_confirmed' });
        if (l.status === 429) return res.status(429).json({ error: 'rate_limited' });
        if (l.status === 400 || l.status === 401 || lc === 'invalid_credentials') return res.status(401).json({ error: 'invalid_credentials' });
        console.error('login failed', l.status, JSON.stringify(l.data).slice(0, 300));
        return res.status(502).json({ error: 'provider_error' });
      }
      setSession(req, res, l.data);
      return res.status(200).json({ ok: true, user: publicUser(l.data.user) });
    }

    /* ----- LOG OUT ----- */
    if (action === 'logout') {
      var ck = parseCookies(req);
      if (ck[AT]) await gotrue('/logout?scope=local', { token: ck[AT] }).catch(function () {});
      clearSession(req, res);
      return res.status(200).json({ ok: true });
    }

    /* ----- FORGOT PASSWORD: sends the reset email (always answers ok, so nobody can probe which emails exist) ----- */
    if (action === 'reset') {
      var re = String(b.email || '').trim().toLowerCase();
      if (!validEmail(re)) return res.status(400).json({ error: 'invalid_email' });
      var proto = /^localhost|^127\./.test(String(req.headers.host || '')) ? 'http' : 'https';
      var redirect = encodeURIComponent(proto + '://' + req.headers.host + '/reset-password.html');
      var rr = await gotrue('/recover?redirect_to=' + redirect, { body: { email: re } });
      if (rr.status === 429) return res.status(429).json({ error: 'rate_limited' });
      return res.status(200).json({ ok: true });
    }

    /* ----- NEW PASSWORD (from the link in the reset email) ----- */
    if (action === 'newpassword') {
      var tok = String(b.access_token || '');
      var np = String(b.password || '');
      if (!tok) return res.status(400).json({ error: 'invalid_link' });
      if (np.length < 8 || np.length > 72) return res.status(400).json({ error: 'weak_password' });
      var p = await gotrue('/user', { method: 'PUT', token: tok, body: { password: np } });
      if (!p.ok) {
        if (p.status === 401 || p.status === 403) return res.status(401).json({ error: 'invalid_link' });
        if (/weak|password/i.test(String(p.data.error_code || p.data.msg || ''))) return res.status(400).json({ error: 'weak_password' });
        console.error('newpassword failed', p.status, JSON.stringify(p.data).slice(0, 300));
        return res.status(502).json({ error: 'provider_error' });
      }
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    console.error('auth error', action, err && err.message);
    return res.status(502).json({ error: 'provider_unreachable' });
  }
}

module.exports = { handleAuth };
