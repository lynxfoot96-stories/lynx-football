/* club-tabs.js
 * Fills the "Key Players" and "Classification" tabs of every club page.
 * Add this ONE line before </body> of each club page (real-madrid.html, barcelona.html, ...):
 *     <script src="club-tabs.js"></script>
 *
 * Systematic: nothing is hardcoded per player. Data comes from the existing
 * /api/stats (top scorers, and top assists as soon as that endpoint returns data)
 * and /api/standings endpoints, so changes upstream show up automatically.
 *
 * To add a club: add one line to CLUBS (football-data.org team id + competitions,
 * domestic league FIRST). Page is matched by file name or by data-club of #clubNewsFeed.
 */
(function () {
  'use strict';

  var COMP_NAMES = {
    39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
    2: 'Champions League', 94: 'Primeira Liga', 71: 'Brasileirão'
  };

  // id = football-data.org team id (same ids /api/standings and /api/stats return)
  var CLUBS = {
    'real-madrid':   { id: 86,  name: 'Real Madrid',   comps: [140, 2] },
    'barcelona':     { id: 81,  name: 'Barcelona',     comps: [140, 2] },
    'arsenal':       { id: 57,  name: 'Arsenal',       comps: [39, 2] },
    'psg':           { id: 524, name: 'Paris Saint-Germain', comps: [61, 2] },
    'bayern-munich': { id: 5,   name: 'Bayern Munich', comps: [78, 2] }
  };

  function resolveClub() {
    var file = (location.pathname.split('/').pop() || '').replace(/\.html?$/, '');
    var feed = document.getElementById('clubNewsFeed');
    var attr = feed && feed.getAttribute('data-club');
    return CLUBS[file] || CLUBS[attr] || null;
  }

  var club = resolveClub();
  var kpPanel = document.querySelector('.club-tabpanel[data-panel="key-players"]');
  var clPanel = document.querySelector('.club-tabpanel[data-panel="classification"]');
  if (!club || (!kpPanel && !clPanel)) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function compName(id) { return COMP_NAMES[id] || ('Competition ' + id); }
  // football-data.org competition emblems (same provider as the API files)
  var COMP_LOGO_IDS = { 39: 2021, 140: 2014, 135: 2019, 78: 2002, 61: 2015, 2: 2001, 94: 2017, 71: 2013 };
  function compLogo(id) {
    return COMP_LOGO_IDS[id] ? '<img class="ct-kp-logo" src="https://crests.football-data.org/' + COMP_LOGO_IDS[id] + '.png" alt="" onerror="this.style.display=\'none\'">' : '';
  }
  function isClub(team) {
    if (!team) return false;
    if (team.id === club.id) return true;
    var n = String(team.name || '').toLowerCase();
    return n === club.name.toLowerCase();
  }

  var jsonCache = {};
  function getJSON(url) {
    if (!jsonCache[url]) {
      jsonCache[url] = fetch(url).then(function (r) { return r.json(); }).catch(function () {
        return { ok: false };
      });
    }
    return jsonCache[url];
  }

  /* ---------- styles (use the site's own CSS variables, so light/dark both work) ---------- */
  var css = '' +
    '.ct-state{padding:48px 16px;text-align:center;color:var(--muted);font-size:14px}' +
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

  /* ---------- KEY PLAYERS ---------- */
  var KP_TYPES = [
    { type: 'scorers', label: 'Top Scorer', unit: 'goals', field: 'goals' },
    { type: 'assists', label: 'Top Assist Provider', unit: 'assists', field: 'assists' }
  ];

  function loadKeyPlayers() {
    if (!kpPanel) return;
    kpPanel.innerHTML = '<div class="ct-state">Loading key players…</div>';
    var jobs = [];
    club.comps.forEach(function (comp) {
      KP_TYPES.forEach(function (t) {
        jobs.push(getJSON('/api/stats?league=' + comp + '&type=' + t.type).then(function (res) {
          return { comp: comp, t: t, res: res };
        }));
      });
    });
    Promise.all(jobs).then(function (results) {
      var html = '';
      club.comps.forEach(function (comp) {
        var cards = '';
        results.filter(function (r) { return r.comp === comp; }).forEach(function (r) {
          if (!r.res || !r.res.ok || !Array.isArray(r.res.data)) return; // e.g. assists not available yet
          r.res.data.filter(function (p) { return isClub(p.team); }).forEach(function (p) {
            var val = p[r.t.field];
            if (val == null) return;
            cards += '<div class="ct-kp-card">' +
              '<img class="ct-kp-photo" src="' + esc(p.photo || '') + '" alt="' + esc(p.name) + '" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
              '<div class="ct-kp-info">' +
                '<div class="ct-kp-role">' + esc(compName(comp)) + ' ' + esc(r.t.label) + '</div>' +
                '<div class="ct-kp-name">' + esc(p.name) + '</div>' +
                '<div class="ct-kp-sub">#' + esc(p.rank) + ' in ' + esc(compName(comp)) +
                  (p.appearances != null ? ' · ' + esc(p.appearances) + ' apps' : '') + '</div>' +
              '</div>' +
              '<div class="ct-kp-stat"><div class="ct-kp-num">' + esc(val) + '</div><div class="ct-kp-unit">' + r.t.unit + '</div></div>' +
            '</div>';
          });
        });
        if (cards) html += '<div class="ct-kp-section"><h3>' + compLogo(comp) + '<span>' + esc(compName(comp)) + '</span></h3><div class="ct-kp-grid">' + cards + '</div></div>';
      });
      kpPanel.innerHTML = html ||
        '<div class="ct-state">No ' + esc(club.name) + ' players in the top scorer lists right now.</div>';
    });
  }

  /* ---------- CLASSIFICATION ---------- */
  function loadStandings() {
    if (!clPanel) return;
    clPanel.innerHTML = '<div class="ct-state">Loading standings…</div>';
    Promise.all(club.comps.map(function (comp) {
      return getJSON('/api/standings?league=' + comp).then(function (res) { return { comp: comp, res: res }; });
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
        // bring the club's row into view inside the table box (not the whole page)
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

  /* ---------- load lazily when the tab is first opened ---------- */
  var loaded = {};
  function onTab(name) {
    if (loaded[name]) return;
    loaded[name] = true;
    if (name === 'key-players') loadKeyPlayers();
    if (name === 'classification') loadStandings();
  }
  document.querySelectorAll('.club-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { onTab(tab.getAttribute('data-tab')); });
  });
  var active = document.querySelector('.club-tab.active');
  if (active) onTab(active.getAttribute('data-tab'));
})();
