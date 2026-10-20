/* club-tabs.js — drives every club page (all 20 clubs). One <script src="club-tabs.js"> per page, nothing else needed.
 *
 *   Team            the full squad cards (Footballer identity, Alternative positions) + the
 *                   "6 goals · #1 Bundesliga" badge for players who are in a top-scorer list.
 *   Key Players     ONLY this club's players currently in the top scorers (their league + Champions League).
 *   Classification  league table (+ Champions League slide), club row highlighted.
 *   Header          adds "News", turns "Home" into "Clubs" (ball icon), shows the club crest instead of "B04".
 *
 * Club ids / competitions live in club-meta.js (loaded automatically). Squad data: club-players-data*.js.
 * Nothing is hardcoded per player: scorers come from /api/stats, tables from /api/standings.
 */
(function () {
  'use strict';

  function loadScript(src) {
    return new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = resolve; // never block the page on a missing file
      document.head.appendChild(s);
    });
  }

  /* ---------- styles ---------- */
  var css = '' +
    /* shared */
    '.ct-state{padding:48px 16px;text-align:center;color:var(--muted);font-size:14px}' +
    /* header: crest in the club strip, ball icon button */
    '.club-strip-badge.ct-has-crest{background:var(--panel-2);border:1px solid var(--line);padding:6px}' +
    '.club-strip-badge.ct-has-crest img{width:100%;height:100%;object-fit:contain;display:block}' +
    /* Team tab (squad cards) */
    '.kp-head{margin-bottom:26px}.kp-head h2{font-size:30px;text-transform:uppercase}.kp-head p{color:var(--muted);margin-top:6px;font-size:14.5px}' +
    '.kp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}@media(max-width:960px){.kp-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.kp-grid{grid-template-columns:1fr}}' +
    '.kp-card{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;transition:transform .25s,border-color .25s}.kp-card:hover{transform:translateY(-3px);border-color:var(--purple-bright)}' +
    '.kp-top{display:flex;align-items:center;gap:12px;margin-bottom:14px}.kp-pos{flex:none;min-width:44px;height:44px;padding:0 8px;border-radius:11px;display:grid;place-items:center;font:800 14px Inter;color:#fff;background:linear-gradient(135deg,#7c3aed,#6d28d9)}' +
    '.kp-pos.gk{background:linear-gradient(135deg,#f59e0b,#d97706)}.kp-pos.df{background:linear-gradient(135deg,#0ea5e9,#2563eb)}.kp-pos.mf{background:linear-gradient(135deg,#10b981,#059669)}.kp-pos.fw{background:linear-gradient(135deg,#ff7a1a,#e11d48)}' +
    /* Team tab: player photo (same look as Key Players) with the colored position badge on its corner */
    '.kp-ph{position:relative;flex:none;width:62px;height:62px;margin-right:8px}' +
    '.kp-photo,.kp-ini{position:absolute;top:0;left:0;width:62px;height:62px;border-radius:50%;border:2px solid var(--purple)}' +
    '.kp-photo{object-fit:cover;object-position:center top;background:var(--panel-2)}' +
    '.kp-ini{display:grid;place-items:center;background:var(--panel-2);color:var(--muted);font:800 18px Inter}' +
    '.kp-ph .kp-pos{position:absolute;right:-10px;bottom:-4px;min-width:34px;height:24px;padding:0 6px;border-radius:8px;font-size:12px;border:2px solid var(--panel)}' +
    /* Team tab toolbar: search + select position (same look as the search bar / league picker on clubs.html) */
    '.kp-tools{display:flex;gap:14px;align-items:center;margin:20px 0 24px;flex-wrap:wrap}' +
    '.kp-search{flex:1;min-width:220px;height:46px;display:flex;align-items:center;gap:12px;padding:0 16px;background:var(--panel);border:1px solid var(--line);border-radius:10px;color:var(--muted);transition:border-color .2s}' +
    '.kp-search:focus-within{border-color:var(--purple-bright)}' +
    '.kp-search svg{flex:none}' +
    '.kp-search input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--white);font:500 15px Inter,sans-serif}' +
    '.kp-search input::placeholder{color:var(--muted)}' +
    '.kp-pos-wrap{position:relative}' +
    '.kp-pos-btn{height:46px;display:flex;align-items:center;gap:10px;padding:0 20px;background:var(--panel);border:1px solid var(--line);border-radius:10px;color:var(--white);font:800 13.5px Inter,sans-serif;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;white-space:nowrap;transition:border-color .2s}' +
    '.kp-pos-btn:hover,.kp-pos-btn[aria-expanded="true"]{border-color:var(--purple-bright)}' +
    '.kp-pos-menu{display:none;position:absolute;right:0;top:calc(100% + 8px);min-width:230px;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.35);z-index:30}' +
    '.kp-pos-menu.open{display:block}' +
    '.kp-pos-opt{width:100%;display:flex;align-items:center;gap:12px;padding:11px 12px;background:none;border:0;border-radius:8px;color:var(--white);font:700 14px Inter,sans-serif;text-align:left;cursor:pointer}' +
    '.kp-pos-opt:hover{background:var(--panel-2)}' +
    '.kp-pos-opt.on{background:var(--panel-2)}' +
    '.kp-pos-opt .kp-tick{margin-left:auto;opacity:0;color:var(--purple-bright)}.kp-pos-opt.on .kp-tick{opacity:1}' +
    '.kp-dot{flex:none;width:12px;height:12px;border-radius:4px;background:var(--muted)}' +
    '.kp-dot.gk{background:linear-gradient(135deg,#f59e0b,#d97706)}.kp-dot.df{background:linear-gradient(135deg,#0ea5e9,#2563eb)}.kp-dot.mf{background:linear-gradient(135deg,#10b981,#059669)}.kp-dot.fw{background:linear-gradient(135deg,#ff7a1a,#e11d48)}' +
    '.kp-name{font:800 22px "Big Shoulders Display",sans-serif;text-transform:uppercase;line-height:1}' +
    '.kp-goal{display:inline-flex;gap:6px;align-items:center;margin-top:5px;font:700 11px Inter;color:var(--orange-bright);background:rgba(255,122,26,.12);border:1px solid rgba(255,122,26,.3);border-radius:20px;padding:3px 9px}' +
    '.kp-lbl{font:800 10.5px Inter;letter-spacing:.06em;text-transform:uppercase;color:var(--purple-bright);margin-bottom:6px}' +
    '.kp-id{color:var(--muted);font-size:14.5px;line-height:1.65;flex:1}' +
    '.kp-alt{margin-top:16px;padding-top:14px;border-top:1px solid var(--line)}.kp-chips{display:flex;gap:6px;flex-wrap:wrap}.kp-chip{font:700 12px Inter;padding:4px 10px;border-radius:7px;background:var(--panel-2);border:1px solid var(--line);color:var(--white)}.kp-none{color:var(--muted);font-size:13px}' +
    /* Key Players tab (top scorers) */
    '.ct-kp-section{margin-bottom:32px}' +
    '.ct-kp-section h3{display:flex;align-items:center;gap:12px;font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:22px;text-transform:uppercase;color:var(--purple-bright);margin-bottom:14px}' +
    '.ct-kp-logo{width:34px;height:34px;object-fit:contain;flex-shrink:0}' +
    '.ct-kp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}' +
    '.ct-kp-card{display:flex;align-items:center;gap:14px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}' +
    '.ct-kp-photo{width:64px;height:64px;border-radius:50%;object-fit:cover;background:var(--panel-2);flex-shrink:0;border:2px solid var(--purple)}' +
    '.ct-kp-info{min-width:0;flex:1}' +
    '.ct-kp-role{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--orange-bright);margin-bottom:4px}' +
    '.ct-kp-name{font-weight:700;font-size:16px;color:var(--white);line-height:1.2}' +
    '.ct-kp-sub{font-size:12px;color:var(--muted);margin-top:2px}' +
    '.ct-kp-stat{text-align:right;flex-shrink:0}' +
    '.ct-kp-num{font-family:"Big Shoulders Display",sans-serif;font-weight:900;font-size:36px;line-height:1;color:var(--purple-bright)}' +
    '.ct-kp-unit{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}' +
    /* Classification tab */
    '.ct-st-head{display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:16px}' +
    '.ct-st-arrow{width:40px;height:40px;border-radius:50%;border:1px solid var(--line);background:var(--panel);color:var(--white);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:border-color .2s,background .2s}' +
    '.ct-st-arrow:hover{border-color:var(--purple-bright);background:var(--panel-2)}' +
    '.ct-st-title{min-width:200px;text-align:center}' +
    '.ct-st-title b{display:flex;align-items:center;justify-content:center;gap:8px;font-family:"Big Shoulders Display",sans-serif;font-weight:700;font-size:24px;text-transform:uppercase;color:var(--purple-bright)}' +
    '.ct-st-title b img{width:26px;height:26px;object-fit:contain}' +
    '.ct-st-dots{display:flex;gap:6px;justify-content:center;margin-top:6px}' +
    '.ct-st-dots i{width:7px;height:7px;border-radius:50%;background:var(--line);display:block}' +
    '.ct-st-dots i.on{background:var(--orange-bright)}' +
    '.ct-st-wrap{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:auto;max-height:620px}' +
    '.ct-st-table{width:100%;border-collapse:collapse;font-size:14px;min-width:560px}' +
    '.ct-st-table th{position:sticky;top:0;z-index:2;background:var(--panel-2);color:var(--muted);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:10px 8px;text-align:center}' +
    '.ct-st-table td{padding:9px 8px;text-align:center;border-top:1px solid var(--line);color:var(--white)}' +
    '.ct-st-table th.l,.ct-st-table td.l{text-align:left}' +
    '.ct-st-team{display:flex;align-items:center;gap:10px}' +
    '.ct-st-team img{width:22px;height:22px;object-fit:contain;flex-shrink:0}' +
    '.ct-st-table td.pts{font-weight:800}' +
    '.ct-st-table tr.me td{background:rgba(138,63,252,.22);font-weight:700}' +
    '.ct-st-table tr.me td:first-child{box-shadow:inset 4px 0 0 var(--orange-bright)}' +
    '.ct-st-table tr.me .ct-st-name{color:var(--orange-bright)}' +
    '@media (max-width:600px){.ct-st-title{min-width:0}.ct-st-title b{font-size:20px}}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- HEADER (runs on every club page) ---------- */
  var BALL_ICON =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9.5"/><path d="M12 7.3l4 2.9-1.5 4.7h-5L8 10.2z"/>' +
    '<path d="M12 7.3V2.6M16 10.2l4.4-1.5M14.5 14.9l2.8 3.8M9.5 14.9l-2.8 3.8M8 10.2L3.6 8.7"/></svg>';

  function patchHeader() {
    var nav = document.querySelector('.club-topbar nav.links');
    if (nav && !nav.querySelector('[data-fs-news]')) {
      var a = document.createElement('a');
      a.href = 'index.html#news';
      a.textContent = 'News';
      a.setAttribute('data-fs-news', '');
      var about = Array.prototype.filter.call(nav.children, function (x) { return /about/i.test(x.textContent); })[0];
      nav.insertBefore(a, about || null); // Videos · News · About · Latest, same order as index.html
    }
    var home = document.querySelector('.club-topbar .nav-home');
    if (home && !home.hasAttribute('data-fs-clubs')) {
      home.setAttribute('data-fs-clubs', '');
      home.href = 'clubs.html';
      home.setAttribute('aria-label', 'Browse all clubs');
      var svg = home.querySelector('svg'), label = home.querySelector('span');
      if (svg) svg.outerHTML = BALL_ICON;
      if (label) label.textContent = 'Clubs';
    }
  }
  patchHeader();

  function boot() {
    var META = window.FSClubMeta;
    var file = (location.pathname.split('/').pop() || '').replace(/\.html?$/, '');
    var feed = document.getElementById('clubNewsFeed');
    var club = META.findClub(file) || META.findClub(feed && feed.getAttribute('data-club'));
    if (!club) return;

    var panels = {
      team: document.querySelector('.club-tabpanel[data-panel="team"]'),
      kp: document.querySelector('.club-tabpanel[data-panel="key-players"]'),
      cl: document.querySelector('.club-tabpanel[data-panel="classification"]')
    };
    function compName(id) { return META.COMP_NAMES[id] || ('Competition ' + id); }
    function isClub(team) { return META.isClubTeam(club, team); }

    /* ---------- club crest instead of the "B04"-style letters ---------- */
    function applyCrest() {
      var badge = document.querySelector('.club-strip-badge');
      var url = META.crest(club.id);
      if (!badge || !url || badge.querySelector('img')) return;
      var img = new Image();
      img.alt = '';
      img.onload = function () { badge.textContent = ''; badge.classList.add('ct-has-crest'); badge.appendChild(img); };
      img.src = url; // if it fails to load the letters simply stay
    }
    applyCrest();
    META.load([club.league]).then(applyCrest);

    /* ---------- top scorers (shared by Team badges and Key Players; one request per competition) ---------- */
    function scorers(comp) {
      return META.getJSON('/api/stats?league=' + comp + '&type=scorers').then(function (res) {
        var ok = !!(res && res.ok && Array.isArray(res.data));
        return { comp: comp, ok: ok, rows: ok ? res.data : [] };
      });
    }
    function clubHits() { // this club's players found in any of its top-scorer lists, best rank first
      return Promise.all(club.comps.map(scorers)).then(function (all) {
        var hits = [];
        all.forEach(function (r) {
          r.rows.filter(function (p) { return isClub(p.team); }).forEach(function (p) {
            hits.push({ name: p.name, goals: p.goals, rank: p.rank, comp: r.comp, photo: p.photo, apps: p.appearances });
          });
        });
        hits.sort(function (a, b) { return a.rank - b.rank; });
        return { hits: hits, anyOk: all.some(function (r) { return r.ok; }) };
      });
    }

    /* ---------- TEAM ---------- */
    var norm = function (s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); };
    var grp = function (p) { return p === 'GK' ? 'gk' : /B$|^CB$/.test(p) ? 'df' : /M$|^DM$|^AM$/.test(p) ? 'mf' : 'fw'; };
    function same(a, b) {
      a = norm(a); b = norm(b);
      if (a === b) return true;
      var x = a.split(' '), y = b.split(' ');
      var lx = x[x.length - 1], ly = y[y.length - 1];
      return lx === ly && lx.length > 3 && (x[0][0] === y[0][0] || x.length === 1 || y.length === 1);
    }
    function roster() { return (window.FS_PLAYERS || {})[club.data] || []; }
    function ensureRoster() {
      if (roster().length) return Promise.resolve();
      // data.js assigns window.FS_PLAYERS, data-2.js adds to it, so load them in this order
      return loadScript('club-players-data.js').then(function () { return loadScript('club-players-data-2.js'); });
    }
    /* ---------- squad photos (Team tab) ---------- */
    var photos = {}, photoTries = 0, photosBusy = false;   // photos[name] = url, or '' when none exists
    function initialsOf(name) {
      var w = String(name || '').trim().split(/\s+/);
      return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : w[0].slice(0, 2)).toUpperCase();
    }
    function applyPhotos() {
      if (!panels.team) return;
      panels.team.querySelectorAll('.kp-ph').forEach(function (box) {
        var u = photos[box.getAttribute('data-name')];
        if (!u || box.querySelector('.kp-photo')) return;
        var img = new Image();
        img.className = 'kp-photo'; img.alt = '';
        img.onload = function () { var ini = box.querySelector('.kp-ini'); if (ini) ini.style.display = 'none'; box.insertBefore(img, box.firstChild); };
        img.src = u; // if it fails to load, the initials circle simply stays
      });
    }
    function loadPhotos(list) {
      var need = list.map(function (p) { return p[0]; }).filter(function (n) { return !(n in photos); });
      if (photosBusy || !need.length || photoTries >= 4) return;
      photosBusy = true; photoTries++;
      fetch('/api/squad-photos?team=' + encodeURIComponent(club.name) + '&names=' + encodeURIComponent(need.join('|')))
        .then(function (r) { return r.json(); })
        .then(function (res) {
          photosBusy = false;
          if (!res || !res.ok) return;
          Object.keys(res.photos || {}).forEach(function (n) { photos[n] = res.photos[n]; });
          (res.done || []).forEach(function (n) { if (!(n in photos)) photos[n] = ''; });
          applyPhotos();
          if (res.pending > 0) setTimeout(function () { loadPhotos(list); }, 1500); // the rest were not reached in time
        })
        .catch(function () { photosBusy = false; });
    }
    /* ---------- Team tab: search + position filter state ---------- */
    var teamQ = '', teamGrp = '';   // search text, and the chosen position group ('' = all)
    var POS_GROUPS = [['', 'All positions'], ['gk', 'Goalkeeper'], ['df', 'Defender'], ['mf', 'Midfielder'], ['fw', 'Forward']];
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.kp-pos-wrap')) return;
      document.querySelectorAll('.kp-pos-menu.open').forEach(function (m) {
        m.classList.remove('open');
        var b = m.parentNode.querySelector('.kp-pos-btn'); if (b) b.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      document.querySelectorAll('.kp-pos-menu.open').forEach(function (m) { m.classList.remove('open'); });
    });
    function playerCard(p, hit) {
      var alt = p[2]
        ? p[2].split(',').map(function (a) { return '<span class="kp-chip">' + esc(a.trim()) + '</span>'; }).join('')
        : '<span class="kp-none">Plays one position only</span>';
      return '<article class="kp-card" data-grp="' + grp(p[1]) + '" data-n="' + esc(norm(p[0])) + '"><div class="kp-top"><div class="kp-ph" data-name="' + esc(p[0]) + '"><span class="kp-ini">' + esc(initialsOf(p[0])) + '</span><span class="kp-pos ' + grp(p[1]) + '">' + esc(p[1]) + '</span></div><div><div class="kp-name">' + esc(p[0]) + '</div>' +
        (hit ? '<span class="kp-goal">&#9917; ' + hit.goals + (hit.goals === 1 ? ' goal' : ' goals') + ' &middot; #' + hit.rank + ' ' + esc(compName(hit.comp)) + '</span>' : '') +
        '</div></div><div class="kp-lbl">Footballer identity</div><p class="kp-id">' + esc(p[3]) + '</p>' +
        '<div class="kp-alt"><div class="kp-lbl">Alternative positions</div><div class="kp-chips">' + alt + '</div></div></article>';
    }
    function loadTeam() {
      if (!panels.team) return;
      panels.team.innerHTML = '<div class="ct-state">Loading squad…</div>';
      ensureRoster().then(function () {
        var list = roster();
        if (!list.length) {
          panels.team.innerHTML = '<div class="club-placeholder"><div class="display">Coming soon</div><p>Squad data for ' + esc(club.name) + ' is on the way &mdash; check back soon for the full breakdown.</p></div>';
          return;
        }
        function cardsHtml(hits) {
          return list.map(function (p) {
            return playerCard(p, hits.filter(function (h) { return same(h.name, p[0]); })[0]);
          }).join('');
        }
        function applyFilter() {
          var grid = panels.team.querySelector('.kp-grid');
          if (!grid) return;
          var qq = norm(teamQ), shown = 0;
          grid.querySelectorAll('.kp-card').forEach(function (c) {
            var ok = (!teamGrp || c.getAttribute('data-grp') === teamGrp) && (!qq || c.getAttribute('data-n').indexOf(qq) !== -1);
            c.style.display = ok ? '' : 'none';
            if (ok) shown++;
          });
          var none = panels.team.querySelector('.kp-empty');
          if (none) none.style.display = shown ? 'none' : '';
        }
        function bindTools() {
          var input = panels.team.querySelector('.kp-search input'),
              btn = panels.team.querySelector('.kp-pos-btn'),
              menu = panels.team.querySelector('.kp-pos-menu');
          input.value = teamQ;
          input.addEventListener('input', function () { teamQ = input.value; applyFilter(); });
          function paint() {
            var g = POS_GROUPS.filter(function (x) { return x[0] === teamGrp; })[0];
            btn.querySelector('.kp-pos-label').textContent = teamGrp ? g[1] : 'Select position';
            btn.querySelector('.kp-dot').className = 'kp-dot ' + teamGrp;
            menu.querySelectorAll('.kp-pos-opt').forEach(function (o) { o.classList.toggle('on', o.getAttribute('data-g') === teamGrp); });
          }
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            var open = !menu.classList.contains('open');
            menu.classList.toggle('open', open);
            btn.setAttribute('aria-expanded', open ? 'true' : 'false');
          });
          menu.addEventListener('click', function (e) {
            var o = e.target.closest('.kp-pos-opt');
            if (!o) return;
            teamGrp = o.getAttribute('data-g');
            paint();
            menu.classList.remove('open');
            btn.setAttribute('aria-expanded', 'false');
            applyFilter();
          });
          paint();
        }
        function draw(hits) {
          var grid = panels.team.querySelector('.kp-grid');
          if (!grid) { // first draw: header + search/filter bar + grid
            var opts = POS_GROUPS.map(function (g) {
              return '<button type="button" class="kp-pos-opt" data-g="' + g[0] + '"><span class="kp-dot ' + g[0] + '"></span>' + g[1] + '<svg class="kp-tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg></button>';
            }).join('');
            panels.team.innerHTML = '<div class="kp-head"><h2 class="display">Team</h2><p>The ' + list.length + ' players who matter most this season.</p></div>' +
              '<div class="kp-tools">' +
                '<label class="kp-search"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg><input type="search" placeholder="Search a player&hellip;" autocomplete="off" aria-label="Search a player"></label>' +
                '<div class="kp-pos-wrap"><button type="button" class="kp-pos-btn" aria-haspopup="true" aria-expanded="false"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M7 12h10M10 17h4"/></svg><span class="kp-dot"></span><span class="kp-pos-label">Select position</span></button>' +
                '<div class="kp-pos-menu">' + opts + '</div></div>' +
              '</div>' +
              '<div class="kp-grid"></div><div class="ct-state kp-empty" style="display:none">No player matches your search.</div>';
            bindTools();
            grid = panels.team.querySelector('.kp-grid');
          }
          grid.innerHTML = cardsHtml(hits);
          applyPhotos();
          applyFilter();
        }
        draw([]);
        loadPhotos(list);
        clubHits().then(function (r) { if (r.hits.length) draw(r.hits); });
      });
    }

    /* ---------- KEY PLAYERS (club players who are in the top scorers) ---------- */
    function loadKeyPlayers() {
      if (!panels.kp) return;
      panels.kp.innerHTML = '<div class="ct-state">Loading key players…</div>';
      Promise.all([clubHits(), META.load(club.comps)]).then(function (out) {
        var r = out[0], html = '';
        club.comps.forEach(function (comp) {
          var cards = r.hits.filter(function (h) { return h.comp === comp; }).map(function (h) {
            return '<div class="ct-kp-card">' +
              '<img class="ct-kp-photo" src="' + esc(h.photo || '') + '" alt="' + esc(h.name) + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
              '<div class="ct-kp-info">' +
                '<div class="ct-kp-role">' + esc(compName(comp)) + ' Top Scorer</div>' +
                '<div class="ct-kp-name">' + esc(h.name) + '</div>' +
                '<div class="ct-kp-sub">#' + esc(h.rank) + ' in ' + esc(compName(comp)) + (h.apps != null ? ' &middot; ' + esc(h.apps) + ' apps' : '') + '</div>' +
              '</div>' +
              '<div class="ct-kp-stat"><div class="ct-kp-num">' + esc(h.goals) + '</div><div class="ct-kp-unit">goals</div></div>' +
            '</div>';
          }).join('');
          var logo = META.leagueLogo(comp);
          if (cards) html += '<div class="ct-kp-section"><h3>' + (logo ? '<img class="ct-kp-logo" src="' + esc(logo) + '" alt="" onerror="this.style.display=\'none\'">' : '') +
            '<span>' + esc(compName(comp)) + '</span></h3><div class="ct-kp-grid">' + cards + '</div></div>';
        });
        panels.kp.innerHTML = html ||
          '<div class="ct-state">' + (r.anyOk
            ? 'No ' + esc(club.name) + ' players are in the top scorer lists right now.'
            : 'Top scorer data is temporarily unavailable. Please try again shortly.') + '</div>';
      });
    }

    /* ---------- CLASSIFICATION ---------- */
    function loadStandings() {
      var clPanel = panels.cl;
      if (!clPanel) return;
      clPanel.innerHTML = '<div class="ct-state">Loading standings…</div>';
      Promise.all(club.comps.map(function (comp) {
        return META.getJSON('/api/standings?league=' + comp).then(function (res) { return { comp: comp, res: res }; });
      })).then(function (all) {
        var views = all.filter(function (a) { return a.res && a.res.ok && a.res.data && a.res.data.standings; });
        if (!views.length) {
          clPanel.innerHTML = '<div class="ct-state">Standings are temporarily unavailable. Please try again shortly.</div>';
          return;
        }
        var idx = 0;
        clPanel.innerHTML =
          '<div class="ct-st-head">' +
            '<button class="ct-st-arrow" data-d="-1" aria-label="Previous competition">&#8249;</button>' +
            '<div class="ct-st-title"></div>' +
            '<button class="ct-st-arrow" data-d="1" aria-label="Next competition">&#8250;</button>' +
          '</div><div class="ct-st-wrap"></div>';
        var title = clPanel.querySelector('.ct-st-title');
        var wrap = clPanel.querySelector('.ct-st-wrap');
        var arrows = clPanel.querySelectorAll('.ct-st-arrow');
        if (views.length < 2) arrows.forEach(function (a) { a.style.visibility = 'hidden'; });

        function render() {
          var v = views[idx], d = v.res.data;
          var dots = views.map(function (_, i) { return '<i class="' + (i === idx ? 'on' : '') + '"></i>'; }).join('');
          title.innerHTML = '<b>' + (d.league && d.league.logo ? '<img src="' + esc(d.league.logo) + '" alt="">' : '') +
            esc(compName(v.comp)) + '</b>' + (views.length > 1 ? '<div class="ct-st-dots">' + dots + '</div>' : '');
          var rows = d.standings.map(function (r) {
            var gd = r.goalsDiff > 0 ? '+' + r.goalsDiff : r.goalsDiff;
            return '<tr class="' + (isClub(r.team) ? 'me' : '') + '">' +
              '<td>' + esc(r.rank) + '</td>' +
              '<td class="l"><div class="ct-st-team">' + (r.team.logo ? '<img src="' + esc(r.team.logo) + '" alt="" loading="lazy">' : '') +
                '<span class="ct-st-name">' + esc(r.team.name) + '</span></div></td>' +
              '<td>' + esc(r.played) + '</td><td>' + esc(r.won) + '</td><td>' + esc(r.draw) + '</td><td>' + esc(r.lost) + '</td>' +
              '<td>' + esc(r.goalsFor) + ':' + esc(r.goalsAgainst) + '</td><td>' + esc(gd) + '</td>' +
              '<td class="pts">' + esc(r.points) + '</td></tr>';
          }).join('');
          wrap.innerHTML = '<table class="ct-st-table"><thead><tr><th>#</th><th class="l">Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>Goals</th><th>GD</th><th>Pts</th></tr></thead><tbody>' + rows + '</tbody></table>';
          var me = wrap.querySelector('tr.me');
          if (me) wrap.scrollTop = Math.max(0, me.offsetTop - wrap.clientHeight / 2 + me.offsetHeight / 2);
        }
        arrows.forEach(function (a) {
          a.addEventListener('click', function () {
            idx = (idx + parseInt(a.getAttribute('data-d'), 10) + views.length) % views.length;
            render();
          });
        });
        render();
      });
    }

    /* ---------- load lazily when a tab is first opened ---------- */
    var loaded = {};
    function onTab(name) {
      if (loaded[name]) return;
      loaded[name] = true;
      if (name === 'team') loadTeam();
      if (name === 'key-players') loadKeyPlayers();
      if (name === 'classification') loadStandings();
    }
    document.querySelectorAll('.club-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { onTab(tab.getAttribute('data-tab')); });
    });
    var active = document.querySelector('.club-tab.active');
    if (active) onTab(active.getAttribute('data-tab'));
  }

  if (window.FSClubMeta) boot();
  else loadScript('club-meta.js').then(function () { if (window.FSClubMeta) boot(); });
})();
