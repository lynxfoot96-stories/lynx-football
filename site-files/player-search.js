/* player-search.js — adds a player search box to the header on every page (one
 * <script src="player-search.js"></script> tag per page, nothing else needed).
 *
 * Searches the SAME squad data already used by the Team tab on club pages
 * (club-meta.js + club-players-data.js) -- entirely client-side, no new API
 * call. Lazy-loads those two files itself if the current page hasn't already
 * loaded them (e.g. index.html, news.html, matches.html).
 *
 * Photos: each result shows the player's photo, fetched from /api/squad-photos (the
 * same Wikimedia/curated pipeline + cache as the club Team tab). Until a photo
 * arrives (or if there is none) the initials circle stays.
 *
 * Any footballer: after a short pause, if the typed text is 3+ letters, it also asks
 * /api/player?search=... (TheSportsDB) and adds that player below the club-squad results,
 * so players who are not in any club section (e.g. "Neymar") can be found too.
 *
 * Typing "mb" matches "Mbappé", "Mbuyamba", etc.; clicking a result (or
 * pressing Enter) goes straight to player.html?name=...&club=... -- the full
 * player page, not a card.
 */
(function () {
  'use strict';

  function loadScript(src) {
    return new Promise(function (resolve) {
      if (document.querySelector('script[src="' + src + '"]')) { resolve(); return; }
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = resolve;
      document.head.appendChild(s);
    });
  }

  var css = '' +
    '.fs-search-wrap{position:relative;display:flex;align-items:center}' +
    '.fs-search-btn{background:none;border:1px solid var(--line);border-radius:8px;width:40px;height:40px;display:flex;align-items:center;justify-content:center;color:var(--white);cursor:pointer;transition:border-color .2s}' +
    '.fs-search-btn:hover,.fs-search-btn[aria-expanded="true"]{border-color:var(--purple-bright)}' +
    '.fs-search-panel{display:none;position:absolute;right:0;top:calc(100% + 10px);width:400px;max-width:calc(100vw - 32px);background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.35);padding:10px;z-index:200}' +
    '.fs-search-panel.open{display:block}' +
    '.fs-search-input{width:100%;height:42px;padding:0 14px;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;color:var(--white);font:500 14.5px Inter,sans-serif;outline:0}' +
    '.fs-search-input:focus{border-color:var(--purple-bright)}' +
    '.fs-search-results{margin-top:8px;max-height:380px;overflow:auto}' +
    '.fs-search-chips{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}' +
    '.fs-chip{height:30px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--white);font:700 12.5px Inter,sans-serif;cursor:pointer;transition:border-color .2s,background .2s}' +
    '.fs-chip:hover{border-color:var(--purple-bright)}' +
    '.fs-chip.on{background:linear-gradient(135deg,#7c3aed,#6d28d9);border-color:transparent;color:#fff}' +
    '.fs-search-sec{padding:12px 8px 4px;font:800 10.5px Inter,sans-serif;letter-spacing:.07em;text-transform:uppercase;color:var(--purple-bright)}' +
    '.fs-search-logo{flex:none;position:relative;width:32px;height:32px;border-radius:8px;background:var(--panel-2);display:flex;align-items:center;justify-content:center;font:800 10.5px Inter;color:var(--orange-bright);overflow:hidden}' +
    '.fs-search-logo img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:3px;background:var(--panel-2)}' +
    '.fs-search-row{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:8px;cursor:pointer}' +
    '.fs-search-row:hover,.fs-search-row.active{background:var(--panel-2)}' +
    '.fs-search-ini{flex:none;position:relative;width:32px;height:32px;border-radius:50%;background:var(--panel-2);display:flex;align-items:center;justify-content:center;font:800 12px Inter;color:var(--muted);overflow:hidden}' +
    '.fs-search-ini img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}' +
    '.fs-search-name{font-weight:700;font-size:14px;color:var(--white)}' +
    '.fs-search-club{font-size:12px;color:var(--muted)}' +
    '.fs-search-empty{padding:14px 8px;color:var(--muted);font-size:13px;text-align:center}' +
    '@media(max-width:480px){.fs-search-panel{position:fixed;left:16px;right:16px;top:70px;width:auto}}' +
    /* ---- FotMob-style header: logo | search bar | ... nav | Home / Subscribe / theme ---- */
    '.navbar.has-search{display:flex !important;flex-wrap:nowrap !important;align-items:center;justify-content:flex-start !important;gap:20px}' +
    '.navbar.has-search > *{flex:none;grid-column:auto !important;grid-row:auto !important}' +
    '.navbar.has-search > .fs-search-slot{flex:1 1 380px;max-width:380px;min-width:0;margin-right:auto}' +
    '.navbar.has-search > .nav-actions{display:flex;align-items:center;flex-wrap:nowrap}' +
    '.fs-search-slot{min-width:0;width:100%}' +
    '.fs-search-wrap.fs-bar{display:block;width:100%}' +
    '.fs-bar-field{display:flex;align-items:center;gap:10px;height:42px;padding:0 12px;background:var(--panel);border:1px solid var(--line);border-radius:10px;color:var(--muted);transition:border-color .2s}' +
    '.fs-bar-field:hover,.fs-bar-field:focus-within{border-color:var(--purple-bright)}' +
    '.fs-bar-field svg{flex:none;pointer-events:none}' +
    '.fs-bar .fs-bar-input{flex:1;min-width:0;width:auto;height:100%;padding:0;background:transparent;border:0;border-radius:0;color:var(--white);font:500 14px Inter,sans-serif;outline:0}' +
    '.fs-bar .fs-bar-input::placeholder{color:var(--muted)}' +
    '.fs-bar .fs-bar-kbd{flex:none;font:700 11px Inter,sans-serif;color:var(--muted);background:var(--panel-2);border:1px solid var(--line);border-radius:6px;padding:3px 7px}' +
    '.fs-bar .fs-bar-field:focus-within .fs-bar-kbd{display:none}' +
    '.fs-bar .fs-search-panel{left:0;right:auto;width:max(100%,420px)}' +
    '@media(max-width:640px){.navbar.has-search{gap:12px}' +
      '.navbar.has-search > .fs-search-slot{flex:none;max-width:none;width:auto;margin-left:auto;margin-right:0}' +
      '.fs-bar-field{position:relative;width:40px;height:40px;padding:0;justify-content:center}' +
      '.fs-bar .fs-bar-input{position:absolute;inset:0;width:100%;height:100%;opacity:0;font-size:16px}' +
      '.fs-bar .fs-bar-kbd{display:none}' +
      '.fs-bar .fs-bar-field:focus-within{position:fixed;left:12px;right:12px;top:15px;width:auto;height:46px;padding:0 12px;justify-content:flex-start;z-index:210;box-shadow:0 8px 24px rgba(0,0,0,.3)}' +
      '.fs-bar .fs-bar-field:focus-within .fs-bar-input{position:static;opacity:1}' +
      '.fs-bar .fs-search-panel{position:fixed;left:12px;right:12px;top:70px;width:auto}}';
  var styleTag = document.createElement('style');
  styleTag.textContent = css;
  document.head.appendChild(styleTag);

  var SEARCH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  }
  function initialsOf(name) {
    var w = String(name || '').trim().split(/\s+/);
    return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
  }

  /* ---------- build the player index once (lazy-loads club data if needed) ---------- */
  var indexPromise = null;
  function buildIndex() {
    if (indexPromise) return indexPromise;
    indexPromise = Promise.resolve()
      .then(function () { return window.FSClubMeta ? null : loadScript('club-meta.js'); })
      .then(function () { return (window.FS_PLAYERS && Object.keys(window.FS_PLAYERS).length) ? null : loadScript('club-players-data.js'); })
      .then(function () {
        var list = [];
        var META = window.FSClubMeta, PLAYERS = window.FS_PLAYERS || {};
        if (!META) return list;
        Object.keys(META.CLUBS).forEach(function (slug) {
          var club = META.CLUBS[slug];
          var roster = PLAYERS[club.data] || [];
          roster.forEach(function (p) {
            list.push({ name: p[0], pos: p[1], clubName: club.name, clubSlug: slug, n: norm(p[0]) });
          });
        });
        return list;
      });
    return indexPromise;
  }

  function matches(list, q) {
    var nq = norm(q);
    if (!nq) return [];
    var starts = [], contains = [];
    list.forEach(function (p) {
      if (p.n.indexOf(nq) === 0) starts.push(p);
      else if (p.n.indexOf(nq) !== -1) contains.push(p);
      else {
        // also match by individual name part (e.g. "mbappe" matches surname even
        // when the query doesn't match from the very start of the full string)
        var parts = p.n.split(' ');
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].indexOf(nq) === 0) { contains.push(p); break; }
        }
      }
    });
    return starts.concat(contains).slice(0, 8);
  }

  function playerHref(p) {
    return 'player.html?name=' + encodeURIComponent(p.name) + '&club=' + encodeURIComponent(p.clubName);
  }

  /* ---------- photos (same source as the club Team tab) ---------- */
  var photoCache = {};     // "club|name" -> url, or '' when there is no safe photo
  var photoAsked = {};     // "club|name" -> true once requested
  function pkey(p) { return p.clubName + '|' + p.name; }

  function fetchPhotos(list) {
    var byClub = {};
    list.forEach(function (p) {
      if (photoAsked[pkey(p)]) return;
      photoAsked[pkey(p)] = true;
      (byClub[p.clubName] = byClub[p.clubName] || []).push(p.name);
    });
    Object.keys(byClub).forEach(function (club) {
      var names = byClub[club];
      var attempts = 0;
      (function ask() {
        attempts++;
        fetch('/api/squad-photos?team=' + encodeURIComponent(club) + '&names=' + encodeURIComponent(names.join('|')))
          .then(function (r) { return r.json(); })
          .then(function (res) {
            if (!res || !res.ok) { names.forEach(function (n) { delete photoAsked[club + '|' + n]; }); return; }
            (res.done || []).forEach(function (n) { photoCache[club + '|' + n] = (res.photos && res.photos[n]) || ''; });
            paintPhotos();
            // players the server did not reach in time: ask again once, shortly
            if (res.pending > 0 && attempts < 2) {
              names = names.filter(function (n) { return (res.done || []).indexOf(n) === -1; });
              if (names.length) setTimeout(ask, 1500);
            }
          })
          .catch(function () { names.forEach(function (n) { delete photoAsked[club + '|' + n]; }); });
      })();
    });
  }

  function paintPhotos() {
    document.querySelectorAll('.fs-search-ini[data-pk]').forEach(function (el) {
      var url = photoCache[el.getAttribute('data-pk')];
      if (!url || el.querySelector('img')) return;
      var img = new Image();
      img.alt = '';
      img.onload = function () { if (!el.querySelector('img')) el.appendChild(img); };
      img.src = url;
    });
  }

  /* ---------- leagues + clubs (the same lists as clubs.html) ---------- */
  var LEAGUES = [
    { slug: 'premier-league', name: 'Premier League', country: 'England', id: 39 },
    { slug: 'la-liga', name: 'La Liga', country: 'Spain', id: 140 },
    { slug: 'serie-a', name: 'Serie A', country: 'Italy', id: 135 },
    { slug: 'bundesliga', name: 'Bundesliga', country: 'Germany', id: 78 },
    { slug: 'ligue-1', name: 'Ligue 1', country: 'France', id: 61 },
    { slug: 'primeira-liga', name: 'Primeira Liga', country: 'Portugal', id: 94 },
    { slug: 'brasileirao', name: 'Brasileirão Série A', country: 'Brazil', id: 71 }
  ].map(function (l) { l.n = norm(l.name) + ' ' + norm(l.country) + ' ' + l.slug.replace(/-/g, ' '); return l; });
  var LEAGUE_NAME = { 2: 'European competitions' };
  LEAGUES.forEach(function (l) { LEAGUE_NAME[l.id] = l.name; });

  var dirPromise = null, clubList = null;
  function clubDirectory() {
    if (dirPromise) return dirPromise;
    try {
      var c = JSON.parse(sessionStorage.getItem('fs-club-dir-v1') || 'null');
      if (c && c.d && c.d.length && Date.now() - c.t < 864e5) dirPromise = Promise.resolve(c.d);
    } catch (e) {}
    if (!dirPromise) dirPromise = fetch('/api/player?clubs=1').then(function (r) { return r.json(); }).then(function (j) {
      var d = j && j.ok ? j.clubs : [];
      if (d.length) try { sessionStorage.setItem('fs-club-dir-v1', JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
      return d;
    }).catch(function () { return []; });
    return dirPromise;
  }
  function buildClubs(dir) {
    var META = window.FSClubMeta, bySlug = {}, out = [];
    if (META) Object.keys(META.CLUBS).forEach(function (s) { bySlug[META.CLUBS[s].id] = s; });
    dir.forEach(function (c) {
      var slug = bySlug[c.i], own = slug && META.CLUBS[slug];
      var names = [norm(c.n), norm(c.s)];
      if (own) { names.push(norm(own.name)); (own.alt || []).forEach(function (a) { names.push(norm(a)); }); }
      out.push({ type: 'club', id: c.i, name: own ? own.name : c.s, n: names, tla: norm(c.t), crest: c.c || null, league: c.l, top: !!own,
        href: own ? slug + '.html' : 'club.html?id=' + c.i });
    });
    if (!out.length && META) Object.keys(META.CLUBS).forEach(function (s) {   // directory unavailable: at least the 20 known clubs
      var o = META.CLUBS[s];
      out.push({ type: 'club', id: o.id, name: o.name, n: [norm(o.name)].concat((o.alt || []).map(norm)), tla: '', crest: META.crest(o.id), league: o.league, top: true, href: s + '.html' });
    });
    return out;
  }
  function clubMatches(q, limit) {
    var nq = norm(q), list = clubList || [];
    if (!nq) return list.filter(function (c) { return c.top; }).slice(0, limit);
    var scored = [];
    list.forEach(function (c) {
      var best = 9;
      c.n.forEach(function (n) {
        if (!n) return;
        if (n.indexOf(nq) === 0) best = Math.min(best, 0);
        else if (n.split(' ').some(function (w) { return w.indexOf(nq) === 0; })) best = Math.min(best, 1);
        else if (n.indexOf(nq) !== -1) best = Math.min(best, 2);
      });
      if (c.tla && c.tla === nq) best = Math.min(best, 0);
      if (best < 9) scored.push({ c: c, k: best * 2 + (c.top ? 0 : 1) });
    });
    scored.sort(function (a, b) { return a.k - b.k || a.c.name.localeCompare(b.c.name); });
    return scored.slice(0, limit).map(function (x) { return x.c; });
  }
  function leagueMatches(q) {
    var nq = norm(q);
    return LEAGUES.filter(function (l) { return !nq || l.n.indexOf(nq) !== -1; }).map(function (l) {
      return { type: 'league', name: l.name, sub: l.country, id: l.id, href: 'clubs.html?league=' + l.slug };
    });
  }

  /* ---------- mount into every .nav-actions on the page ---------- */
  var FILTERS = [['all', 'All'], ['clubs', 'Clubs'], ['leagues', 'Leagues'], ['players', 'Players']];
  function mount(navActions) {
    if (navActions.querySelector('.fs-search-wrap')) return;

    // Bar mode: put the search right after the logo (FotMob style). If the header has no
    // .navbar/.logo (e.g. a very different page), fall back to the old icon button in .nav-actions.
    var navbar = navActions.closest('.navbar');
    var logoEl = navbar && navbar.querySelector(':scope > .logo');
    var sharedSlot = navActions.classList.contains('fs-search-slot') && !!navActions.closest('.fs-hd');
    var barMode = sharedSlot || !!(navbar && logoEl);
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

    var wrap = document.createElement('div');
    wrap.className = 'fs-search-wrap' + (barMode ? ' fs-bar' : '');
    var CHIPS = '<div class="fs-search-chips">' + FILTERS.map(function (f, i) { return '<button type="button" class="fs-chip' + (i === 0 ? ' on' : '') + '" data-f="' + f[0] + '">' + f[1] + '</button>'; }).join('') + '</div>' +
      '<div class="fs-search-results"></div>';
    wrap.innerHTML = barMode
      ? '<div class="fs-bar-field">' + SEARCH_ICON +
          '<input type="search" class="fs-search-input fs-bar-input" placeholder="Search players, clubs, leagues&hellip;" autocomplete="off" aria-haspopup="true" aria-expanded="false" aria-label="Search players, clubs and leagues">' +
          '<span class="fs-bar-kbd">' + (isMac ? '\u2318K' : 'Ctrl K') + '</span></div>' +
        '<div class="fs-search-panel">' + CHIPS + '</div>'
      : '<button type="button" class="fs-search-btn" aria-haspopup="true" aria-expanded="false" aria-label="Search players, clubs and leagues">' + SEARCH_ICON + '</button>' +
        '<div class="fs-search-panel">' +
          '<input type="search" class="fs-search-input" placeholder="Search players, clubs, leagues&hellip;" autocomplete="off" aria-label="Search players, clubs and leagues">' +
          CHIPS +
        '</div>';
    if (barMode && !sharedSlot) {
      var slot = document.createElement('div');
      slot.className = 'fs-search-slot';
      slot.appendChild(wrap);
      logoEl.insertAdjacentElement('afterend', slot);
      navbar.classList.add('has-search');
      // Inline !important so no page-level header CSS (grid templates, wrapping, etc.) can override it.
      [['display', 'flex'], ['flex-wrap', 'nowrap'], ['align-items', 'center'], ['justify-content', 'flex-start'], ['grid-template-columns', 'none']].forEach(function (d) {
        navbar.style.setProperty(d[0], d[1], 'important');
      });
      Array.prototype.forEach.call(navbar.children, function (ch) {
        if (ch === slot) return;
        ch.style.setProperty('grid-column', 'auto', 'important');
        ch.style.setProperty('grid-row', 'auto', 'important');
        ch.style.setProperty('justify-self', 'auto', 'important');
        ch.style.setProperty('flex', 'none', 'important');
      });
    } else {
      // Shared header already provides the correctly positioned search slot.
      navActions.insertBefore(wrap, navActions.firstChild);
    }

    var btn = wrap.querySelector('.fs-search-btn') || wrap.querySelector('.fs-bar-input');
    var panel = wrap.querySelector('.fs-search-panel');
    var input = wrap.querySelector('.fs-search-input');
    var results = wrap.querySelector('.fs-search-results');
    var filter = 'all', activeIdx = -1, current = [];

    function open() {
      panel.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { input.focus(); }, 0);
      buildIndex();                       // warm the player index
      clubDirectory().then(function (d) { clubList = buildClubs(d); render(); });
      var META = window.FSClubMeta;       // league logos (cached 7 days, shared with clubs.html / index.html)
      if (META && META.load && !META.leagueLogo(39)) META.load(LEAGUES.map(function (l) { return l.id; })).then(render);
    }
    function close() {
      panel.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
    var localList = [], remoteItem = null, remoteState = 'idle', remoteSeq = 0, remoteTimer = null;

    function hrefOf(it) { return it.type === 'player' ? playerHref(it) : it.href; }
    // favourites: lets favorites.js put a heart on each result
    function favAttrs(p) {
      var id, badge = '', url = hrefOf(p);
      if (p.type === 'league') { id = p.id; var lg = window.FSClubMeta && window.FSClubMeta.leagueLogo(p.id); badge = lg || ''; }
      else if (p.type === 'club') { id = p.id; badge = p.crest || ''; }
      else { id = norm((p.clubName || '') + ' ' + p.name).replace(/[^a-z0-9]+/g, '-'); }
      if (id == null || id === '') return '';
      return ' data-fav-id="' + esc(id) + '" data-fav-type="' + p.type + '" data-fav-name="' + esc(p.name) + '" data-fav-badge="' + esc(badge) + '" data-fav-url="' + esc(url) + '"';
    }
    function rowHtml(p, i) {
      var circle, sub;
      if (p.type === 'league') {
        var lg = window.FSClubMeta && window.FSClubMeta.leagueLogo(p.id);
        circle = '<span class="fs-search-logo">' + esc(p.name.slice(0, 2).toUpperCase()) + (lg ? '<img src="' + esc(lg) + '" alt="" onerror="this.remove()">' : '') + '</span>';
        sub = esc(p.sub) + ' &middot; League';
      } else if (p.type === 'club') {
        circle = '<span class="fs-search-logo">' + esc(p.name.slice(0, 3).toUpperCase()) + (p.crest ? '<img src="' + esc(p.crest) + '" alt="" onerror="this.remove()">' : '') + '</span>';
        sub = esc(LEAGUE_NAME[p.league] || 'Club');
      } else {
        circle = p.remote
          ? '<span class="fs-search-ini">' + esc(initialsOf(p.name)) + (p.photoUrl ? '<img src="' + esc(p.photoUrl) + '" alt="" onerror="this.remove()">' : '') + '</span>'
          : '<span class="fs-search-ini" data-pk="' + esc(pkey(p)) + '">' + esc(initialsOf(p.name)) + '</span>';
        sub = [p.clubName, p.pos].filter(Boolean).map(esc).join(' &middot; ');
      }
      return '<a class="fs-search-row" href="' + esc(hrefOf(p)) + '" data-i="' + i + '"' + favAttrs(p) + '>' + circle +
        '<span><span class="fs-search-name">' + esc(p.name) + '</span><br><span class="fs-search-club">' + sub + '</span></span></a>';
    }
    // Sections in display order: Leagues, Clubs, Players. With one filter selected that type gets more rows.
    function gather(q) {
      var f = filter, all = f === 'all', out = [];
      var lg = (all || f === 'leagues') ? leagueMatches(q).slice(0, all ? 3 : 10) : [];
      var cl = (all || f === 'clubs') ? clubMatches(q, all ? 4 : 12) : [];
      var pl = (all || f === 'players') ? localList.concat(remoteItem ? [remoteItem] : []) : [];
      if (lg.length) out.push(['Leagues', lg]);
      if (cl.length) out.push(['Clubs', cl]);
      if (pl.length) out.push(['Players', pl]);
      return out;
    }
    function render() {
      var q = input.value.trim();
      var wantsEmptyList = !q && (filter === 'leagues' || filter === 'clubs');
      if (!q && !wantsEmptyList) { results.innerHTML = ''; current = []; return; }
      var secs = gather(q);
      current = [];
      secs.forEach(function (s) { current = current.concat(s[1]); });
      if (!current.length) {
        var searching = (remoteState === 'loading' && (filter === 'all' || filter === 'players')) || (!clubList && filter !== 'players' && filter !== 'leagues');
        results.innerHTML = searching
          ? '<div class="fs-search-empty">Searching&hellip;</div>'
          : '<div class="fs-search-empty">No result for &ldquo;' + esc(q) + '&rdquo;.</div>';
        return;
      }
      var i = 0;
      results.innerHTML = secs.map(function (s) {
        return '<div class="fs-search-sec">' + s[0] + '</div>' + s[1].map(function (it) { return rowHtml(it, i++); }).join('');
      }).join('');
      paintPhotos();
      paintActive();
    }
    function lookupRemote(q, seq) {
      fetch('/api/player?search=' + encodeURIComponent(q))
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (seq !== remoteSeq) return; // the user kept typing: ignore this answer
          remoteState = 'done';
          var p = res && res.ok && res.player;
          if (p && p.name) {
            var dup = localList.some(function (l) { return norm(l.name) === norm(p.name); });
            if (!dup) remoteItem = { type: 'player', name: p.name, clubName: p.club || '', pos: null, remote: true, photoUrl: p.photoUrl || null };
          }
          render();
        })
        .catch(function () { if (seq !== remoteSeq) return; remoteState = 'done'; render(); });
    }
    function paintActive() {
      results.querySelectorAll('.fs-search-row').forEach(function (r, i) {
        r.classList.toggle('active', i === activeIdx);
      });
    }

    if (barMode) {
      input.addEventListener('focus', function () { if (!panel.classList.contains('open')) open(); });
      input.addEventListener('click', function (e) { e.stopPropagation(); if (!panel.classList.contains('open')) open(); });
      wrap.__fsOpen = function () { input.focus(); if (!panel.classList.contains('open')) open(); };
    } else {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (panel.classList.contains('open')) close(); else open();
      });
    }
    wrap.querySelector('.fs-search-chips').addEventListener('click', function (e) {
      var c = e.target.closest('.fs-chip');
      if (!c) return;
      filter = c.getAttribute('data-f');
      wrap.querySelectorAll('.fs-chip').forEach(function (x) { x.classList.toggle('on', x === c); });
      activeIdx = -1;
      if ((filter === 'all' || filter === 'players') && input.value.trim().length >= 3 && remoteState === 'idle') { remoteState = 'loading'; lookupRemote(input.value.trim(), remoteSeq); }
      render();
      input.focus();
    });
    var typeTimer = null;
    input.addEventListener('input', function () {
      var q = input.value.trim();
      remoteItem = null; remoteSeq++; clearTimeout(remoteTimer);
      remoteState = q.length >= 3 ? 'loading' : 'idle';
      // club-squad matches appear instantly; photo + TheSportsDB lookups wait for a short pause in typing
      buildIndex().then(function (list) {
        localList = matches(list, input.value).map(function (p) { p.type = 'player'; return p; }); activeIdx = -1;
        render();
        clearTimeout(typeTimer);
        typeTimer = setTimeout(function () { fetchPhotos(localList); }, 250);
      });
      if (q.length >= 3) {
        var seq = remoteSeq;
        remoteTimer = setTimeout(function () { lookupRemote(q, seq); }, 500);
      }
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); if (barMode) input.blur(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, current.length - 1); paintActive(); scrollActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); paintActive(); scrollActive(); }
      else if (e.key === 'Enter') {
        var target = activeIdx >= 0 ? current[activeIdx] : current[0];
        if (target) { e.preventDefault(); location.href = hrefOf(target); }
      }
    });
    function scrollActive() { var a = results.querySelector('.fs-search-row.active'); if (a && a.scrollIntoView) a.scrollIntoView({ block: 'nearest' }); }
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.fs-search-wrap')) return;
    document.querySelectorAll('.fs-search-panel.open').forEach(function (p) {
      p.classList.remove('open');
      var b = p.parentNode.querySelector('.fs-search-btn') || p.parentNode.querySelector('.fs-bar-input');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.fs-search-panel.open').forEach(function (p) { p.classList.remove('open'); });
  });

  document.addEventListener('keydown', function (e) {
    if (!((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K'))) return;
    var w = document.querySelector('.fs-search-wrap');
    if (!w) return;
    e.preventDefault();
    if (w.__fsOpen) { w.__fsOpen(); return; }
    var b = w.querySelector('.fs-search-btn');
    if (b && b.getAttribute('aria-expanded') !== 'true') b.click();
  });

  function boot() {
    document.querySelectorAll('.fs-hd .fs-search-slot, .nav-actions').forEach(mount);
    // Newsletter modal + favourites hearts: loaded here so every page gets them without extra tags.
    loadScript('favorites.js');
    loadScript('newsletter.js');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
