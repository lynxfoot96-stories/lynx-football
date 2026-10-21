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
    '.fs-search-panel{display:none;position:absolute;right:0;top:calc(100% + 10px);width:320px;max-width:calc(100vw - 32px);background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.35);padding:10px;z-index:200}' +
    '.fs-search-panel.open{display:block}' +
    '.fs-search-input{width:100%;height:42px;padding:0 14px;background:var(--panel-2);border:1px solid var(--line);border-radius:9px;color:var(--white);font:500 14.5px Inter,sans-serif;outline:0}' +
    '.fs-search-input:focus{border-color:var(--purple-bright)}' +
    '.fs-search-results{margin-top:8px;max-height:320px;overflow:auto}' +
    '.fs-search-row{display:flex;align-items:center;gap:10px;padding:9px 8px;border-radius:8px;cursor:pointer}' +
    '.fs-search-row:hover,.fs-search-row.active{background:var(--panel-2)}' +
    '.fs-search-ini{flex:none;position:relative;width:32px;height:32px;border-radius:50%;background:var(--panel-2);display:flex;align-items:center;justify-content:center;font:800 12px Inter;color:var(--muted);overflow:hidden}' +
    '.fs-search-ini img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%}' +
    '.fs-search-name{font-weight:700;font-size:14px;color:var(--white)}' +
    '.fs-search-club{font-size:12px;color:var(--muted)}' +
    '.fs-search-empty{padding:14px 8px;color:var(--muted);font-size:13px;text-align:center}' +
    '@media(max-width:480px){.fs-search-panel{position:fixed;left:16px;right:16px;top:70px;width:auto}}';
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

  /* ---------- mount into every .nav-actions on the page ---------- */
  function mount(navActions) {
    if (navActions.querySelector('.fs-search-wrap')) return;

    var wrap = document.createElement('div');
    wrap.className = 'fs-search-wrap';
    wrap.innerHTML =
      '<button type="button" class="fs-search-btn" aria-haspopup="true" aria-expanded="false" aria-label="Search players">' + SEARCH_ICON + '</button>' +
      '<div class="fs-search-panel">' +
        '<input type="search" class="fs-search-input" placeholder="Search a player&hellip;" autocomplete="off" aria-label="Search a player">' +
        '<div class="fs-search-results"></div>' +
      '</div>';
    navActions.insertBefore(wrap, navActions.firstChild);

    var btn = wrap.querySelector('.fs-search-btn');
    var panel = wrap.querySelector('.fs-search-panel');
    var input = wrap.querySelector('.fs-search-input');
    var results = wrap.querySelector('.fs-search-results');
    var activeIdx = -1, current = [];

    function open() {
      panel.classList.add('open');
      btn.setAttribute('aria-expanded', 'true');
      setTimeout(function () { input.focus(); }, 0);
      buildIndex(); // warm the index as soon as the box opens, before the user even types
    }
    function close() {
      panel.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
    }
    function draw(list) {
      current = list; activeIdx = -1;
      if (!input.value.trim()) { results.innerHTML = ''; return; }
      if (!list.length) { results.innerHTML = '<div class="fs-search-empty">No player matches &ldquo;' + esc(input.value.trim()) + '&rdquo;.</div>'; return; }
      results.innerHTML = list.map(function (p, i) {
        return '<a class="fs-search-row" href="' + playerHref(p) + '" data-i="' + i + '">' +
          '<span class="fs-search-ini" data-pk="' + esc(pkey(p)) + '">' + esc(initialsOf(p.name)) + '</span>' +
          '<span><span class="fs-search-name">' + esc(p.name) + '</span><br><span class="fs-search-club">' + esc(p.clubName) + (p.pos ? ' &middot; ' + esc(p.pos) : '') + '</span></span>' +
        '</a>';
      }).join('');
      paintPhotos();
    }
    function paintActive() {
      results.querySelectorAll('.fs-search-row').forEach(function (r, i) {
        r.classList.toggle('active', i === activeIdx);
      });
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.classList.contains('open')) close(); else open();
    });
    var typeTimer = null;
    input.addEventListener('input', function () {
      // list updates instantly; photo lookups only run for what is still on screen after a short pause
      buildIndex().then(function (list) {
        draw(matches(list, input.value));
        clearTimeout(typeTimer);
        typeTimer = setTimeout(function () { fetchPhotos(current); }, 250);
      });
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, current.length - 1); paintActive(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); paintActive(); }
      else if (e.key === 'Enter') {
        var target = activeIdx >= 0 ? current[activeIdx] : current[0];
        if (target) { e.preventDefault(); location.href = playerHref(target); }
      }
    });
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.fs-search-wrap')) return;
    document.querySelectorAll('.fs-search-panel.open').forEach(function (p) {
      p.classList.remove('open');
      var b = p.parentNode.querySelector('.fs-search-btn');
      if (b) b.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.fs-search-panel.open').forEach(function (p) { p.classList.remove('open'); });
  });

  function boot() {
    document.querySelectorAll('.nav-actions').forEach(mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
