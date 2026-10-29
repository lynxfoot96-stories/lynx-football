/* ==========================================================
   Football Stories 96 — Favourites (Stage 2)
   Storage key: fs96_user_favorites
   Entry shape: { id, type: 'club'|'player'|'league', name, badge?, url?, ts }

   Mark any element with:
     data-fav-id="57" data-fav-type="club" data-fav-name="Arsenal"
     data-fav-badge="https://.../crest.png" data-fav-url="arsenal.html"
   A heart button is added automatically (also to elements rendered later by JS).
   Loaded on every page by player-search.js, so no per-page tags are needed.
   ========================================================== */
(function () {
  'use strict';
  if (window.FS96Favorites) return;

  var KEY = 'fs96_favs_guest_isolated_v2';
  var storageKey = KEY;
  var generation = 0;
  var EVT = 'fs96:favorites-changed';
  var TYPES = { club: 1, player: 1, league: 1 };
  var MAX = 60;

  // How many days ahead to look for a club's next match. 0 disables fixture lookups
  // (the shelf then shows badges only). Each uncached day costs one API-Football call,
  // shared by all visitors for 25 minutes (see api/scores.js), so keep this small.
  var NEXT_MATCH_DAYS = 3;

  var HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';

  // Styles live here, so there is no separate CSS file to upload.
  var CSS = "/* ==========================================================\n   Football Stories 96 \u2014 Favourites (Stage 2)\n   Uses the site's CSS variables so it follows the theme toggle.\n   ========================================================== */\n\n[data-fav-id] { position: relative; }\n\n.fs-fav {\n  position: absolute; top: 10px; right: 10px; z-index: 5;\n  width: 36px; height: 36px; padding: 0;\n  display: grid; place-items: center;\n  border-radius: 50%; border: 1px solid rgba(255, 255, 255, .22);\n  background: rgba(8, 7, 10, .62); color: #F4F3F6;\n  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);\n  cursor: pointer;\n  transition: transform .18s ease, background .2s, border-color .2s, color .2s, box-shadow .25s;\n}\n.fs-fav svg { width: 18px; height: 18px; fill: transparent; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: fill .2s ease; pointer-events: none; }\n.fs-fav:hover { transform: scale(1.1); border-color: var(--orange, #FF7A1A); }\n.fs-fav:focus-visible { outline: 2px solid var(--orange, #FF7A1A); outline-offset: 2px; }\n.fs-fav[aria-pressed=\"true\"] {\n  color: var(--orange, #FF7A1A); border-color: rgba(255, 122, 26, .7);\n  box-shadow: 0 0 0 4px rgba(255, 122, 26, .14), 0 0 18px rgba(255, 122, 26, .55);\n}\n.fs-fav[aria-pressed=\"true\"] svg { fill: currentColor; }\n.fs-fav.is-pop { animation: fs-fav-pop .38s cubic-bezier(.2, 1.5, .4, 1); }\n@keyframes fs-fav-pop { 0% { transform: scale(.8); } 55% { transform: scale(1.28); } 100% { transform: scale(1); } }\n\n/* heart placed inline in a page header (club pages) */\n.club-title-row > .fs-fav { position: static; margin-left: auto; flex: none; background: var(--panel, #121116); color: var(--white, #F4F3F6); border-color: var(--line, rgba(255,255,255,.2)); }\n.club-title-row > .fs-fav[aria-pressed=\"true\"] { color: var(--orange, #FF7A1A); border-color: rgba(255, 122, 26, .7); }\n\n/* heart inside the header search results */\n.fs-search-row > .fs-fav { top: 50%; right: 6px; width: 30px; height: 30px; margin-top: -15px; background: transparent; border-color: transparent; color: var(--muted, #9A96A3); backdrop-filter: none; -webkit-backdrop-filter: none; }\n.fs-search-row > .fs-fav svg { width: 16px; height: 16px; }\n.fs-search-row > .fs-fav:hover { color: var(--orange, #FF7A1A); border-color: transparent; }\n.fs-search-row > .fs-fav[aria-pressed=\"true\"] { color: var(--orange, #FF7A1A); border-color: transparent; box-shadow: none; filter: drop-shadow(0 0 6px rgba(255, 122, 26, .6)); }\n.fs-search-row[data-fav-id] { padding-right: 42px; }\n\n/* league hero on the standings page */\n.lh-hero-in > .fs-fav { top: 14px; right: 14px; }\n\n/* ---------- Pinned favourites shelf ---------- */\n.fs-favbar {\n  margin: 0 0 18px; padding: 14px 16px; box-sizing: border-box;\n  border-radius: 16px; border: 1px solid rgba(138, 63, 252, .3);\n  background: linear-gradient(135deg, rgba(138, 63, 252, .09), rgba(255, 122, 26, .05));\n}\n.fs-favbar[hidden] { display: none; }\n.fs-favbar__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }\n.fs-favbar__title {\n  margin: 0; display: flex; align-items: center; gap: 8px; color: var(--white, #F4F3F6);\n  font-family: 'Big Shoulders Display', Impact, 'Arial Narrow', sans-serif;\n  font-size: 22px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase;\n}\n.fs-favbar__title svg { width: 18px; height: 18px; color: var(--orange, #FF7A1A); fill: currentColor; }\n.fs-favbar__cta {\n  font: inherit; font-size: 13px; font-weight: 600; color: var(--purple-bright, #A868FF); background: none; border: 0; padding: 4px 0;\n  cursor: pointer; text-decoration: underline; text-underline-offset: 3px;\n}\n.fs-favbar__cta:hover { color: var(--orange, #FF7A1A); }\n\n.fs-favbar__strip {\n  display: flex; gap: 10px; overflow-x: auto; padding-bottom: 6px;\n  scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch;\n}\n.fs-favbar__item {\n  position: relative; flex: 0 0 auto; min-width: 190px; max-width: 270px; scroll-snap-align: start;\n  display: flex; align-items: center; gap: 10px; padding: 10px 34px 10px 10px;\n  border-radius: 12px; border: 1px solid var(--line, rgba(255,255,255,.1));\n  background: var(--panel, #121116); color: var(--white, #F4F3F6); text-decoration: none;\n  transition: transform .18s ease, border-color .2s;\n}\na.fs-favbar__item:hover { transform: translateY(-2px); border-color: var(--purple-bright, #A868FF); }\n.fs-favbar__badge { width: 36px; height: 36px; object-fit: contain; flex: none; border-radius: 8px; background: var(--panel-2, #17151C); padding: 3px; box-sizing: border-box; }\n.fs-favbar__badge--ph { display: grid; place-items: center; padding: 0; font-size: 11px; font-weight: 700; color: var(--muted, #9A96A3); text-transform: uppercase; }\n.fs-favbar__text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }\n.fs-favbar__name { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.fs-favbar__meta { font-size: 12px; color: var(--muted, #9A96A3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\n.fs-favbar__remove {\n  position: absolute; top: 6px; right: 6px; width: 24px; height: 24px; padding: 0;\n  display: grid; place-items: center; border: 0; border-radius: 50%;\n  background: transparent; color: var(--muted, #9A96A3); cursor: pointer; transition: background .2s, color .2s;\n}\n.fs-favbar__remove:hover { background: var(--panel-2, #17151C); color: var(--white, #F4F3F6); }\n.fs-favbar__remove:focus-visible { outline: 2px solid var(--orange, #FF7A1A); }\n\n@media (max-width: 600px) {\n  .fs-favbar { padding: 12px; }\n  .fs-favbar__item { min-width: 170px; }\n}\n@media (prefers-reduced-motion: reduce) {\n  .fs-fav, .fs-fav svg, .fs-favbar__item { transition: none; }\n  .fs-fav.is-pop { animation: none; }\n}\n\n/* ---------- player cards on club pages (club-tabs.js) ---------- */\n.kp-card[data-fav-id] .kp-name { padding-right: 34px; }\n.ct-kp-card > .fs-fav { top: 4px; left: 4px; right: auto; width: 26px; height: 26px; }\n.ct-kp-card > .fs-fav svg { width: 14px; height: 14px; }\n.ct-kp-card[data-fav-id] .ct-kp-photo { margin-left: 0; }\n";
  var styleTag = document.createElement('style');
  styleTag.id = 'fs96-fav-css';
  var CSS2 = "\n/* ---------- v2: heart in the club header strip, player hero, and the Following nav link ---------- */\n.club-strip-inner > .fs-fav { position: static; margin-left: auto; flex: none; width: 40px; height: 40px; background: var(--panel, #121116); color: var(--white, #F4F3F6); border-color: var(--line, rgba(255,255,255,.2)); }\n.club-strip-inner > .fs-fav[aria-pressed=\"true\"] { color: var(--orange, #FF7A1A); border-color: rgba(255, 122, 26, .7); }\n.pl-hero > .fs-fav { top: 14px; right: 0; width: 40px; height: 40px; background: var(--panel, #121116); color: var(--white, #F4F3F6); border-color: var(--line, rgba(255,255,255,.2)); }\n.pl-hero > .fs-fav[aria-pressed=\"true\"] { color: var(--orange, #FF7A1A); border-color: rgba(255, 122, 26, .7); }\n.fs-following-link svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }\n.fs-following-link[aria-current=\"page\"] { border-color: var(--purple-bright, #A868FF); }\n.fs-following-count { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; display: inline-grid; place-items: center; border-radius: 9px; background: var(--orange, #FF7A1A); color: #fff; font: 700 11px/1 Inter, sans-serif; }\n.fs-following-count[hidden] { display: none; }\n";
  styleTag.textContent = CSS + CSS2;
  document.head.appendChild(styleTag);

  /* ---------- storage ---------- */
  var cache = null;
  function read() {
    if (cache) return cache;
    var list = [];
    try {
      var raw = JSON.parse(localStorage.getItem(storageKey) || '[]');
      if (Array.isArray(raw)) list = raw.filter(function (f) { return f && TYPES[f.type] && f.id != null && f.name; });
    } catch (e) { /* corrupt or blocked storage -> start empty */ }
    cache = list;
    return cache;
  }
  function write(list) {
    cache = list;
    try { localStorage.setItem(storageKey, JSON.stringify(list)); } catch (e) { /* private mode / quota: works in memory for this page */ }
    document.dispatchEvent(new CustomEvent(EVT, { detail: { favorites: list.slice() } }));
  }
  // Each account has isolated local favorites. Unclaimed guest favorites are
  // migrated once at first sign-in; never copy Account A's list to Account B.
  var syncReady=false, syncTimer=null, activeEmail='', busy=false;
  function setScope(key) {
    storageKey=key; cache=null;
    document.dispatchEvent(new CustomEvent(EVT,{detail:{favorites:read().slice()}}));
  }
  function sendFavorites() {
    if(!syncReady||busy)return;
    fetch('/api/scores?action=setfavorites',{
      method:'POST',credentials:'same-origin',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({favorites:read()})
    }).catch(function(){});
  }
  function syncFavorites() {
    var g=++generation;
    fetch('/api/scores?action=me',{credentials:'same-origin'})
      .then(function(r){return r.json();})
      .then(function(info){
        if(g!==generation)return;
        var email=info.user&&info.user.email?String(info.user.email).toLowerCase():'';
        if(!email){
          syncReady=false;activeEmail='';
          if(storageKey!==KEY)setScope(KEY);
          return;
        }
        if(activeEmail===email&&syncReady)return;
        syncReady=false;activeEmail=email;
        var scope='fs96_favs_account_'+encodeURIComponent(email);
        // Switch scope immediately: no account may read another account's cache.
        setScope(scope);
        return fetch('/api/scores?action=getfavorites',{
          method:'POST',credentials:'same-origin',
          headers:{'Content-Type':'application/json'},body:'{}'
        }).then(function(r){if(!r.ok)throw Error('sync');return r.json();})
          .then(function(data){
            if(g!==generation)return;
            var items={};
            // Server state and this account's own local copy only. Never import
            // the legacy shared key or anonymous choices into another account.
            read().concat(Array.isArray(data.favorites)?data.favorites:[]).forEach(function(x){
              if(!x||!TYPES[x.type]||x.id==null)return;
              items[x.type+':'+x.id]=x;
            });
            busy=true;
            write(Object.keys(items).map(function(k){return items[k];}).slice(-MAX));
            busy=false;
            syncReady=true;
            sendFavorites();
          }).catch(function(){syncReady=false;});
      }).catch(function(){syncReady=false;});
      }).catch(function(){syncReady=false;});
  }
  document.addEventListener(EVT,function(){
    if(!syncReady||busy)return;
    clearTimeout(syncTimer);
    syncTimer=setTimeout(sendFavorites,600);
  });

  function idx(type, id) {
    var l = read();
    for (var i = 0; i < l.length; i++) if (l[i].type === type && String(l[i].id) === String(id)) return i;
    return -1;
  }

  var api = {
    all: function (type) { return read().filter(function (f) { return !type || f.type === type; }); },
    has: function (type, id) { return idx(type, id) !== -1; },
    toggle: function (item) {
      if (!item || !TYPES[item.type] || item.id == null || item.id === '') return false;
      var l = read().slice(), i = idx(item.type, item.id);
      if (i !== -1) { l.splice(i, 1); write(l); return false; }
      l.push({
        id: String(item.id), type: item.type, name: String(item.name || item.id).slice(0, 80),
        badge: item.badge || '', url: item.url || '', ts: Date.now()
      });
      if (l.length > MAX) l = l.slice(-MAX);
      write(l);
      return true;
    },
    remove: function (type, id) {
      var i = idx(type, id); if (i === -1) return;
      var l = read().slice(); l.splice(i, 1); write(l);
    }
  };
  window.FS96Favorites = api;

  window.addEventListener('storage', function (e) { // keep tabs in sync
    if (e.key === storageKey) { cache = null; document.dispatchEvent(new CustomEvent(EVT, { detail: { favorites: read().slice() } })); }
  });

  /* ---------- heart buttons ---------- */
  function itemFrom(card) {
    return {
      id: card.getAttribute('data-fav-id'),
      type: card.getAttribute('data-fav-type'),
      name: card.getAttribute('data-fav-name') || card.getAttribute('data-fav-id'),
      badge: card.getAttribute('data-fav-badge') || '',
      url: card.getAttribute('data-fav-url') || ''
    };
  }
  function paint(btn) {
    var item = itemFrom(btn._card), on = api.has(item.type, item.id);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', (on ? 'Remove ' : 'Add ') + item.name + (on ? ' from' : ' to') + ' favorites');
    btn.title = on ? 'Remove from favorites' : 'Add to favorites';
  }
  function decorate(card) {
    if (card.hasAttribute('data-fav-ready')) return;
    var item = itemFrom(card);
    if (!item.id || !TYPES[item.type]) return;
    card.setAttribute('data-fav-ready', '');
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'fs-fav'; btn.innerHTML = HEART; btn._card = card;
    paint(btn);
    btn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); // cards are often links
      api.toggle(itemFrom(card));
      btn.classList.remove('is-pop'); void btn.offsetWidth; btn.classList.add('is-pop');
    });
    btn.addEventListener('animationend', function () { btn.classList.remove('is-pop'); });
    card.appendChild(btn);
  }
  function scan() {
    document.querySelectorAll('[data-fav-id]:not([data-fav-ready])').forEach(decorate);
  }
  document.addEventListener(EVT, function () {
    document.querySelectorAll('.fs-fav').forEach(paint);
  });
  api.decorate = function (card, item) {
    card.setAttribute('data-fav-id', item.id); card.setAttribute('data-fav-type', item.type);
    card.setAttribute('data-fav-name', item.name || item.id);
    if (item.badge) card.setAttribute('data-fav-badge', item.badge);
    if (item.url) card.setAttribute('data-fav-url', item.url);
    decorate(card);
  };

  /* ---------- club-meta (ids, aliases, crests) ---------- */
  var metaCbs = null;
  function withMeta(cb) {
    if (window.FSClubMeta) return cb(window.FSClubMeta);
    if (metaCbs) { metaCbs.push(cb); return; }
    metaCbs = [cb];
    var s = document.createElement('script');
    s.src = 'club-meta.js';
    var done = function () { var q = metaCbs; metaCbs = null; q.forEach(function (f) { f(window.FSClubMeta || null); }); };
    s.onload = done; s.onerror = done;
    document.head.appendChild(s);
  }

  /* ---------- heart on club pages (<slug>.html and club.html?id=N) ---------- */
  function decorateClubPage() {
    var row = document.querySelector('.club-title-row, .club-strip-inner');
    if (!row || row.hasAttribute('data-fav-ready') || row.__fsTrying) return;
    var h1 = row.querySelector('h1');
    if (!h1) return;
    var m = location.pathname.match(/([a-z0-9-]+)\.html$/i), slug = m ? m[1].toLowerCase() : '';
    var qid = new URLSearchParams(location.search).get('id');
    if (slug === 'club' && !qid) return;
    row.__fsTrying = true;
    withMeta(function (META) {
      row.__fsTrying = false;
      var own = META && META.CLUBS && META.CLUBS[slug];
      var id, name, badge = '';
      if (own) { id = own.id; name = own.name; badge = META.crest ? META.crest(own.id) : ''; }
      else if (slug === 'club') {
        name = (h1.textContent || '').trim();
        if (!name || /^loading/i.test(name)) return; // title not rendered yet; the observer will call us again
        id = qid; badge = META && META.crest ? (META.crest(qid) || '') : '';
      } else return;
      api.decorate(row, { id: id, type: 'club', name: name, badge: badge || '', url: location.pathname.split('/').pop() + location.search });
    });
  }

  /* ---------- heart on the player page (player.html?name=..&club=..) ----------
     The id is built exactly like the header search builds it (club + name, slugged),
     so a player followed from search, a squad card or this page is the same entry. */
  function playerId(club, name) {
    var n = String((club || '') + ' ' + (name || '')).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
    return n.replace(/[^a-z0-9]+/g, '-');
  }
  function decoratePlayerPage() {
    var hero = document.querySelector('.pl-hero');
    if (!hero || hero.hasAttribute('data-fav-ready')) return;
    var q = new URLSearchParams(location.search);
    var name = (q.get('name') || '').trim(), club = (q.get('club') || '').trim();
    if (!name) return;
    var img = hero.querySelector('.pl-photo-wrap img');
    api.decorate(hero, {
      id: playerId(club, name), type: 'player', name: name,
      badge: img ? (img.getAttribute('src') || '') : '',
      url: 'player.html?name=' + encodeURIComponent(name) + '&club=' + encodeURIComponent(club)
    });
  }

  /* ---------- "Following" link in the top bar (every page that loads this file) ---------- */
  var NAV_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
  function updateNavCount() {
    var n = api.all().length;
    document.querySelectorAll('.fs-following-count').forEach(function (b) {
      b.textContent = n > 99 ? '99+' : String(n); b.hidden = !n;
    });
  }
  function injectNavLink() {
    document.querySelectorAll('.nav-actions').forEach(function (na) {
      if (na.querySelector('.fs-following-link')) return;
      var a = document.createElement('a');
      a.href = 'following.html'; a.className = 'nav-home fs-following-link';
      a.setAttribute('aria-label', 'Following');
      a.innerHTML = NAV_ICON + '<span>Following</span><b class="fs-following-count" hidden></b>';
      if (/following\.html$/i.test(location.pathname)) a.setAttribute('aria-current', 'page');
      var cta = na.querySelector('.nav-cta');
      if (cta) na.insertBefore(a, cta); else na.appendChild(a);
    });
    updateNavCount();
  }
  document.addEventListener(EVT, updateNavCount);

  /* ---------- pinned shelf ---------- */
  var bar = null;
  var BAR_ANCHORS = ['[data-fav-bar-anchor]', '#scores .scores-body', '#scores .scores-header'];

  function findAnchor() {
    for (var i = 0; i < BAR_ANCHORS.length; i++) { var a = document.querySelector(BAR_ANCHORS[i]); if (a) return a; }
    return null;
  }

  // Next fixture per club, from /api/scores?view=date (your existing endpoint).
  // Day lists are kept in sessionStorage for 25 minutes (same window as the server cache).
  function ymd(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function tzName() { try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone; return /^[A-Za-z_]+\/[A-Za-z_\-]+$/.test(z) ? z : ''; } catch (e) { return ''; } }
  function dayFixtures(date) {
    var k = 'fs96_fx_' + date, now = Date.now();
    try { var c = JSON.parse(sessionStorage.getItem(k) || 'null'); if (c && now - c.t < 1500000) return Promise.resolve(c.v); } catch (e) {}
    var tz = tzName();
    return fetch('/api/scores?view=date&date=' + date + '&league=all' + (tz ? '&tz=' + encodeURIComponent(tz) : ''))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var v = j && j.ok ? (j.fixtures || []) : [];
        if (j && j.ok) { try { sessionStorage.setItem(k, JSON.stringify({ t: now, v: v })); } catch (e) {} }
        return v;
      })
      .catch(function () { return []; });
  }
  function nn(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function aliasesFor(club, META) {
    var out = [nn(club.name)];
    if (META && META.CLUBS) Object.keys(META.CLUBS).forEach(function (s) {
      var c = META.CLUBS[s];
      if (String(c.id) === String(club.id)) { out.push(nn(c.name)); (c.alt || []).forEach(function (a) { out.push(nn(a)); }); }
    });
    return out;
  }
  var nextMemo = {};
  function loadNext(clubs) {
    var key = clubs.map(function (c) { return c.id; }).join(',');
    if (nextMemo[key]) return nextMemo[key];
    nextMemo[key] = new Promise(function (resolve) {
      withMeta(function (META) {
        var names = {}, found = {}, remaining = clubs.length;
        clubs.forEach(function (c) { names[c.id] = aliasesFor(c, META); });
        var step = 0;
        (function nextDay() {
          if (step >= NEXT_MATCH_DAYS || !remaining) return resolve(found);
          var d = new Date(); d.setDate(d.getDate() + step); step++;
          dayFixtures(ymd(d)).then(function (list) {
            list.forEach(function (f) {
              var upcoming = f.isLive || f.statusShort === 'NS' || f.statusShort === 'TBD';
              if (!upcoming || !f.home || !f.away) return;
              var h = nn(f.home.name), a = nn(f.away.name), when = Date.parse(f.date || '');
              clubs.forEach(function (c) {
                var isHome = names[c.id].indexOf(h) !== -1, isAway = names[c.id].indexOf(a) !== -1;
                if (!isHome && !isAway) return;
                var cur = found[c.id];
                if (!cur || when < cur.when) {
                  if (!cur) remaining--;
                  found[c.id] = { when: when, live: !!f.isLive, home: isHome, opp: isHome ? f.away.name : f.home.name };
                }
              });
            });
            nextDay();
          });
        })();
      });
    });
    return nextMemo[key];
  }
  function fmtWhen(ts) {
    try { return new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ts); }
    catch (e) { return new Date(ts).toLocaleString(); }
  }

  function chip(f, metaEl) {
    var root = document.createElement(f.url ? 'a' : 'div');
    root.className = 'fs-favbar__item';
    if (f.url) root.href = f.url;

    var badge;
    if (f.badge) { badge = document.createElement('img'); badge.src = f.badge; badge.alt = ''; badge.loading = 'lazy'; badge.className = 'fs-favbar__badge'; badge.onerror = function () { badge.style.display = 'none'; }; }
    else { badge = document.createElement('span'); badge.className = 'fs-favbar__badge fs-favbar__badge--ph'; badge.textContent = f.name.slice(0, 2); }

    var text = document.createElement('span'); text.className = 'fs-favbar__text';
    var n = document.createElement('span'); n.className = 'fs-favbar__name'; n.textContent = f.name;
    var m = document.createElement('span'); m.className = 'fs-favbar__meta'; m.textContent = f.type.charAt(0).toUpperCase() + f.type.slice(1);
    text.appendChild(n); text.appendChild(m);
    metaEl[f.type + ':' + f.id] = m;

    var rm = document.createElement('button');
    rm.type = 'button'; rm.className = 'fs-favbar__remove'; rm.setAttribute('aria-label', 'Remove ' + f.name + ' from favorites');
    rm.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
    rm.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); api.remove(f.type, f.id); });

    root.appendChild(badge); root.appendChild(text); root.appendChild(rm);
    return root;
  }

  function renderBar() {
    var favs = api.all();
    if (!bar) {
      var anchor = findAnchor();
      if (!anchor) return;
      bar = document.createElement('section');
      bar.className = 'fs-favbar'; bar.setAttribute('aria-label', 'Your pinned favorites');
      if (anchor.matches('#scores .scores-body')) {
        anchor.insertAdjacentElement('afterend', bar);
      } else {
        anchor.parentNode.insertBefore(bar, anchor);
      }
    }
    bar.hidden = !favs.length;
    bar.textContent = '';
    if (!favs.length) return;

    var head = document.createElement('div'); head.className = 'fs-favbar__head';
    var h = document.createElement('h2'); h.className = 'fs-favbar__title';
    h.innerHTML = HEART; h.appendChild(document.createTextNode('Your Pinned Favorites'));
    var cta = document.createElement('button'); cta.type = 'button'; cta.className = 'fs-favbar__cta';
    cta.setAttribute('data-newsletter-open', ''); cta.textContent = 'Get matchday alerts for these';
    head.appendChild(h); head.appendChild(cta);

    var strip = document.createElement('div'); strip.className = 'fs-favbar__strip';
    var order = { club: 0, league: 1, player: 2 }, metaEl = {};
    favs.slice().sort(function (a, b) { return order[a.type] - order[b.type] || a.ts - b.ts; })
      .forEach(function (f) { strip.appendChild(chip(f, metaEl)); });
    bar.appendChild(head); bar.appendChild(strip);

    var clubs = favs.filter(function (f) { return f.type === 'club'; });
    if (clubs.length && NEXT_MATCH_DAYS > 0) {
      loadNext(clubs).then(function (found) {
        clubs.forEach(function (c) {
          var nm = found[c.id], el = metaEl['club:' + c.id];
          if (nm && el && el.isConnected) el.textContent = nm.live ? 'Live now vs ' + nm.opp : (nm.home ? 'vs ' : '@ ') + nm.opp + ' · ' + fmtWhen(nm.when);
        });
      });
    }
  }

  /* ---------- init ---------- */
  function init() {
    scan(); decorateClubPage(); decoratePlayerPage(); injectNavLink(); renderBar();
    var queued = false;
    new MutationObserver(function () {
      if (queued) return; queued = true;
      requestAnimationFrame(function () { queued = false; scan(); decorateClubPage(); decoratePlayerPage(); injectNavLink(); });
    }).observe(document.body, { childList: true, subtree: true });
    document.addEventListener(EVT, renderBar);
    syncFavorites();
    window.addEventListener('focus', syncFavorites);
    window.addEventListener('pageshow', syncFavorites);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
