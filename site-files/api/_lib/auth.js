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
  var email = (u && u.email) || '';
  var av = String(m.avatar_url || m.picture || '');
  if (!/^https:\/\//i.test(av)) av = '';
  return {
    name: String(m.name || m.full_name || '').slice(0, 60) || email.split('@')[0],
    email: email,
    avatar: av.slice(0, 500),
    marketing: m.marketing === true,
    clubResultsEmail: m.club_results_email === true,
    color: /^#[0-9a-f]{6}$/i.test(String(m.avatar_color || '')) ? String(m.avatar_color).toLowerCase() : ''
  };
}

function validEmail(e) { return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

// Block cross-site form posts: if the browser sends an Origin, it must be this site.
function sameOrigin(req) {
  var o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === String(req.headers.host || ''); } catch (e) { return false; }
}

/* ---------- Brevo: save every new member as a contact ----------
   Everyone who creates an account is stored in Brevo (so you always have their email).
   Only people who ticked the marketing box are put on the mailing list, so only they
   receive newsletters and promotions. The others are stored as plain contacts with
   SIGNUP_SOURCE = "account-no-marketing" (you can filter on that in Brevo). */
async function addToBrevo(email, name, marketing) {
  var key = process.env.BREVO_API_KEY;
  var listId = Number(process.env.BREVO_LIST_ID);
  if (!key) { console.error('Brevo not configured, member not saved'); return false; }
  var payload = {
    email: email,
    updateEnabled: true,
    // FIRSTNAME exists in every Brevo account; SIGNUP_SOURCE is the one your newsletter already uses.
    attributes: { FIRSTNAME: name, SIGNUP_SOURCE: marketing ? 'account' : 'account-no-marketing' }
  };
  if (marketing && listId) payload.listIds = [listId];
  try {
    var r = await fetch('https://api.brevo.com/v3/contacts', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 201 || r.status === 204) return true;
    console.error('Brevo error', r.status, (await r.text().catch(function () { return ''; })).slice(0, 300));
  } catch (e) { console.error('Brevo request failed', e && e.message); }
  return false;
}

/* Take a member off the mailing list (they stay in Brevo as a contact). */
async function removeFromBrevo(email) {
  var key = process.env.BREVO_API_KEY;
  var listId = Number(process.env.BREVO_LIST_ID);
  if (!key || !listId) return false;
  try {
    var r = await fetch('https://api.brevo.com/v3/contacts/lists/' + listId + '/contacts/remove', {
      method: 'POST',
      headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ emails: [email] }),
      signal: AbortSignal.timeout(8000)
    });
    if (r.status === 201 || r.status === 204 || r.status === 200) return true;
    console.error('Brevo remove error', r.status, (await r.text().catch(function () { return ''; })).slice(0, 300));
  } catch (e) { console.error('Brevo remove failed', e && e.message); }
  return false;
}

/* Independent mailing lists. BREVO_LIST_ID remains news-only; club results
   requires a different list ID to prevent cross-subscription. */
function clubListId() {
  var id = Number(process.env.BREVO_CLUB_RESULTS_LIST_ID);
  var news = Number(process.env.BREVO_LIST_ID);
  return Number.isSafeInteger(id) && id > 0 && id !== news ? id : 0;
}
async function brevoMembership(email) {
  if(!process.env.BREVO_API_KEY)throw Error('brevo_not_configured');
  var r=await fetch('https://api.brevo.com/v3/contacts/'+encodeURIComponent(email),{
    headers:{'api-key':process.env.BREVO_API_KEY,accept:'application/json'},
    signal:AbortSignal.timeout(8000)
  });
  if(r.status===404)return [];
  if(!r.ok)throw Error('brevo_contact_lookup_'+r.status);
  var data=await r.json();
  return Array.isArray(data.listIds)?data.listIds.map(Number):[];
}
async function setClubBrevo(email,name,enabled) {
  var id=clubListId(), key=process.env.BREVO_API_KEY;
  if(!id||!key)throw Error('club_list_not_configured');
  var url=enabled?'https://api.brevo.com/v3/contacts':'https://api.brevo.com/v3/contacts/lists/'+id+'/contacts/remove';
  var data=enabled?{email:email,updateEnabled:true,listIds:[id]}:{emails:[email]};
  var response=await fetch(url,{method:'POST',headers:{'api-key':key,'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify(data),signal:AbortSignal.timeout(8000)});
  if(![200,201,204].includes(response.status))throw Error('brevo_club_list_update_'+response.status);
}

/* ---------- who is logged in? (refreshes an expired session automatically) ---------- */
async function getSession(req, res) {
  var ck = parseCookies(req);
  if (ck[AT]) {
    var u = await gotrue('/user', { method: 'GET', token: ck[AT] }).catch(function () { return null; });
    if (u && u.ok && u.data && u.data.id) return { user: u.data, token: ck[AT] };
  }
  if (ck[RT]) {
    var r = await gotrue('/token?grant_type=refresh_token', { body: { refresh_token: ck[RT] } }).catch(function () { return null; });
    if (r && r.ok && r.data.access_token) {
      setSession(req, res, r.data);
      return { user: r.data.user || null, token: r.data.access_token };
    }
  }
  return null;
}
async function currentUser(req, res) {
  var s = await getSession(req, res);
  return s && s.user ? s.user : null;
}

const clubResults = require('./club-results');

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

      var r = await gotrue('/signup', { body: { email: email, password: pw, data: { name: name, marketing: b.marketing === true } } });
      if (!r.ok) {
        var code = String(r.data.error_code || r.data.msg || '');
        if (/already|exists/i.test(code)) return res.status(409).json({ error: 'exists' });
        if (/weak|password/i.test(code)) return res.status(400).json({ error: 'weak_password' });
        if (r.status === 429 || /rate/i.test(code)) return res.status(429).json({ error: 'rate_limited' });
        console.error('signup failed', r.status, JSON.stringify(r.data).slice(0, 300));
        return res.status(502).json({ error: 'provider_error' });
      }

      // Everyone is saved in Brevo; only people who ticked the (unticked-by-default) box join the mailing list.
      await addToBrevo(email, name, b.marketing === true);

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

    /* ----- ACCOUNT PAGE ACTIONS (need to be logged in) ----- */
    if (action === 'updateprofile' || action === 'changepassword' || action === 'setmarketing' || action === 'setavatar' || action === 'setclubresults' || action === 'getemailpreferences' || action === 'previewclubresults') {
      var ss = await getSession(req, res);
      if (!ss || !ss.user) return res.status(401).json({ error: 'not_logged_in' });

      if (action === 'updateprofile') {
        var nn = String(b.name || '').replace(/[\r\n<>]/g, ' ').trim().slice(0, 60);
        if (!nn) return res.status(400).json({ error: 'name_required' });
        var up = await gotrue('/user', { method: 'PUT', token: ss.token, body: { data: { name: nn } } });
        if (!up.ok) { console.error('updateprofile failed', up.status, JSON.stringify(up.data).slice(0, 300)); return res.status(502).json({ error: 'provider_error' }); }
        return res.status(200).json({ ok: true, user: publicUser(up.data) });
      }

      if (action === 'setavatar') {
        var col = String(b.color || '').trim();
        if (col && !/^#[0-9a-f]{6}$/i.test(col)) return res.status(400).json({ error: 'invalid_color' });
        var au = await gotrue('/user', { method: 'PUT', token: ss.token, body: { data: { avatar_color: col.toLowerCase() } } });
        if (!au.ok) { console.error('setavatar failed', au.status, JSON.stringify(au.data).slice(0, 300)); return res.status(502).json({ error: 'provider_error' }); }
        return res.status(200).json({ ok: true, user: publicUser(au.data) });
      }

      if (action === 'changepassword') {
        var cur = String(b.current_password || '');
        var npw = String(b.password || '');
        if (!cur) return res.status(400).json({ error: 'current_required' });
        if (npw.length < 8 || npw.length > 72) return res.status(400).json({ error: 'weak_password' });
        var chk = await gotrue('/token?grant_type=password', { body: { email: ss.user.email, password: cur } });
        if (!chk.ok) return res.status(chk.status === 429 ? 429 : 401).json({ error: chk.status === 429 ? 'rate_limited' : 'wrong_password' });
        var pu = await gotrue('/user', { method: 'PUT', token: ss.token, body: { password: npw } });
        if (!pu.ok) {
          var pc = String(pu.data.error_code || pu.data.msg || '');
          if (/same/i.test(pc)) return res.status(400).json({ error: 'same_password' });
          if (/weak|password/i.test(pc)) return res.status(400).json({ error: 'weak_password' });
          console.error('changepassword failed', pu.status, JSON.stringify(pu.data).slice(0, 300));
          return res.status(502).json({ error: 'provider_error' });
        }
        return res.status(200).json({ ok: true });
      }

      if (action === 'getfavorites') {
        var favs = ss.user.user_metadata && ss.user.user_metadata.fs_favorites;
        return res.status(200).json({ ok: true, favorites: Array.isArray(favs) ? favs : [] });
      }

      if (action === 'setfavorites') {
        if (!Array.isArray(b.favorites) || b.favorites.length > 60)
          return res.status(400).json({ error: 'invalid_favorites' });
        var types = { club: 1, player: 1, league: 1 }, unique = {};
        var favorites = [];
        for (var fi = 0; fi < b.favorites.length; fi++) {
          var x = b.favorites[fi] || {}, typ = String(x.type || '');
          var id = String(x.id == null ? '' : x.id).trim().slice(0, 90);
          if (!types[typ] || !id || unique[typ + ':' + id]) continue;
          unique[typ + ':' + id] = true;
          favorites.push({
            id: id, type: typ,
            name: String(x.name || id).replace(/[<>\r\n]/g, '').slice(0, 80),
            badge: /^https:\/\//i.test(String(x.badge || '')) ? String(x.badge).slice(0, 500) : '',
            url: /^[a-z0-9-]+\.html(?:\?[^#]*)?$/i.test(String(x.url || '')) ? String(x.url).slice(0, 250) : '',
            ts: Number.isFinite(Number(x.ts)) ? Number(x.ts) : Date.now()
          });
        }
        var updated = await gotrue('/user', { method: 'PUT', token: ss.token, body: { data: { fs_favorites: favorites } } });
        if (!updated.ok) return res.status(502).json({ error: 'favorites_sync_failed' });
        return res.status(200).json({ ok: true, count: favorites.length });
      }

      if (action === 'previewclubresults') {
        const own=Array.isArray(ss.user.user_metadata&&ss.user.user_metadata.fs_favorites)?
          ss.user.user_metadata.fs_favorites:[];
        const clubs=own.filter(x=>x&&x.type==='club');
        const result=await clubResults.getResults(clubs);
        if(String(b.format||'')==='html'){
          res.setHeader('Content-Type','text/html; charset=utf-8');
          return res.status(200).send(clubResults.html(result.matches,clubs,result.missing));
        }
        return res.status(200).json({ok:true,previewOnly:true,clubCount:clubs.length,
          matches:result.matches.map(f=>({id:f.id,date:f.date,home:f.home.name,away:f.away.name,
            score:f.goals.home+'-'+f.goals.away})),missingDays:result.missing});
      }

      if (action === 'getemailpreferences') {
        var ids=await brevoMembership(ss.user.email);
        return res.status(200).json({ok:true,marketing:ids.includes(Number(process.env.BREVO_LIST_ID)),
          clubResultsEmail:!!clubListId() && ids.includes(clubListId())});
      }

      if (action === 'setclubresults') {
        var enabled=b.enabled===true;
        if(!clubListId())return res.status(503).json({error:'club_results_list_not_configured'});
        try { await setClubBrevo(ss.user.email,publicUser(ss.user).name,enabled); }
        catch(e){console.error('club email preference sync',e.message);return res.status(502).json({error:'provider_error'});}
        var saved=await gotrue('/user',{method:'PUT',token:ss.token,
          body:{data:{club_results_email:enabled}}});
        if(!saved.ok)return res.status(502).json({error:'preferences_update_failed'});
        return res.status(200).json({ok:true,enabled:enabled});
      }

      if (action === 'setmarketing') {
        var want=b.marketing===true;
        var pub=publicUser(ss.user);
        var synced=want?await addToBrevo(pub.email,pub.name,true):await removeFromBrevo(pub.email);
        if(!synced)return res.status(502).json({error:'provider_error'});
        var mu=await gotrue('/user',{method:'PUT',token:ss.token,body:{data:{marketing:want}}});
        if(!mu.ok)return res.status(502).json({error:'preferences_update_failed'});
        return res.status(200).json({ok:true,marketing:want,synced:true});
      }
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (err) {
    console.error('auth error', action, err && err.message);
    return res.status(502).json({ error: 'provider_unreachable' });
  }
}

module.exports = { handleAuth };
