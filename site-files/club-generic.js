/* club-generic.js — loads ANY club for club.html?id=<football-data.org team id>.
 * Fills the header, Overview, News and Videos tabs, then hands the club to club-tabs.js
 * (Team, Classification, Key Players use the same code as every other club page).
 * Data: /api/player?club=<id>  (football-data.org + TheSportsDB, cached on the server).
 */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var id = parseInt(params.get('id'), 10);
  var $ = function (s) { return document.querySelector(s); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function rx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var css = '' +
    '.ov-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:22px;align-items:start}@media(max-width:860px){.ov-grid{grid-template-columns:1fr}}' +
    '.ov-card{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:26px}' +
    '.ov-card h2{font:800 22px "Big Shoulders Display",sans-serif;text-transform:uppercase;margin-bottom:14px}' +
    '.ov-desc p{color:var(--muted);line-height:1.75;font-size:15px;margin-bottom:12px}' +
    '.ov-desc.clamp{max-height:230px;overflow:hidden;-webkit-mask-image:linear-gradient(#000 70%,transparent);mask-image:linear-gradient(#000 70%,transparent)}' +
    '.ov-more{margin-top:8px;background:none;border:1px solid var(--line);color:var(--white);border-radius:9px;padding:8px 14px;font:700 13px Inter;cursor:pointer}.ov-more:hover{border-color:var(--purple-bright)}' +
    '.ov-facts{display:grid;gap:0}.ov-fact{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--line);font-size:14.5px}.ov-fact:first-child{border-top:0}' +
    '.ov-fact span{color:var(--muted)}.ov-fact b{text-align:right;font-weight:700}.ov-fact a{color:var(--purple-bright)}' +
    '.ov-sw{display:inline-flex;gap:6px;vertical-align:middle}.ov-sw i{width:18px;height:18px;border-radius:50%;border:1px solid var(--line);display:block}' +
    '.ov-kit{display:block;max-width:100%;max-height:220px;margin:0 auto 14px;object-fit:contain}' +
    '.ov-comps{display:flex;gap:8px;flex-wrap:wrap}.ov-chip{font:700 12.5px Inter;padding:5px 11px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line)}' +
    '.ov-note{color:var(--muted);font-size:12.5px;margin-top:16px}' +
    '.club-video-card h4{margin-top:10px}.cv-thumb{background-size:cover;background-position:center}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var COMP = { 39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1', 2: 'Champions League', 94: 'Primeira Liga', 71: 'Brasileirão' };

  function fail(msg) {
    $('#clubName').textContent = 'Club not found';
    $('#clubBadge').textContent = '?';
    $('#clubOverview').innerHTML = '<div class="club-placeholder"><div class="display">' + esc(msg) + '</div><p><a href="clubs.html" style="color:var(--purple-bright)">&larr; Browse all clubs</a></p></div>';
  }

  var resolve;
  window.FS_CLUB_PROMISE = new Promise(function (r) { resolve = r; });

  if (!id) { fail('No club selected'); resolve(); return; }

  /* variants of the club name used to find its news and videos */
  function variants(c) {
    var out = [];
    [c.name, c.shortName].forEach(function (n) {
      var v = norm(n);
      if (v) out.push(v);
      var stripped = v.replace(/\b(fc|afc|cf|sc|ac|as|ssc|ud|cd|sv|vfb|vfl|fsv|rcd|rc|calcio|club|de|fk|bk|sk|ss)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (stripped && stripped.length >= 4) out.push(stripped);
    });
    return out.filter(function (v, i, a) { return v.length >= 4 && a.indexOf(v) === i; });
  }

  function registerTopic(c, vs) {
    var T = window.FSTopics;
    if (!T || !T.CLUBS) return 'fd-' + c.id;
    for (var i = 0; i < T.CLUBS.length; i++) {          // already known to the news system (e.g. Tottenham)
      var tc = T.CLUBS[i];
      if (vs.some(function (v) { return tc.re.test(v); })) return tc.slug;
    }
    var slug = 'fd-' + c.id;
    T.CLUBS.push({
      slug: slug, name: c.shortName || c.name, league: (c.comps && c.comps[0] && c.comps[0] !== 2) ? c.comps[0] : 0, ucl: false,
      re: new RegExp('(?:^|[^a-z0-9])(?:' + vs.map(rx).join('|') + ')(?![a-z0-9])')
    });
    return slug;
  }

  function renderOverview(c) {
    var x = c.extra || {};
    var desc = x.description ? String(x.description).split(/\n+/).filter(Boolean) : [];
    var facts = [];
    var founded = x.formedYear || c.founded;
    if (founded) facts.push(['Founded', esc(founded)]);
    var stadium = c.venue || x.stadium;
    if (stadium) facts.push(['Stadium', esc(stadium)]);
    var place = x.location || c.address;
    if (place) facts.push(['Location', esc(place)]);
    if (c.coach) facts.push(['Head coach', esc(c.coach.name) + (c.coach.nationality ? ' <span style="color:var(--muted);font-weight:500">(' + esc(c.coach.nationality) + ')</span>' : '')]);
    if (x.colours && x.colours.length) facts.push(['Colours', '<span class="ov-sw">' + x.colours.map(function (h) { return '<i style="background:' + esc(h) + '"></i>'; }).join('') + '</span>']);
    else if (c.colours) facts.push(['Colours', esc(c.colours)]);
    var site = safeUrl(c.website) || safeUrl(x.website);
    if (site) facts.push(['Website', '<a href="' + esc(site) + '" target="_blank" rel="noopener">' + esc(site.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '')) + '</a>']);
    [['Twitter / X', x.twitter], ['Instagram', x.instagram], ['Facebook', x.facebook]].forEach(function (s) {
      if (safeUrl(s[1])) facts.push([s[0], '<a href="' + esc(s[1]) + '" target="_blank" rel="noopener">Open</a>']);
    });
    var comps = (c.comps || []).map(function (k) { return '<span class="ov-chip">' + esc(COMP[k] || k) + '</span>'; }).join('');

    var left = desc.length
      ? '<div class="ov-card"><h2>About ' + esc(c.shortName || c.name) + '</h2><div class="ov-desc clamp" id="ovDesc">' + desc.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('') + '</div>' +
        '<button class="ov-more" id="ovMore" type="button">Read more</button></div>'
      : '<div class="ov-card"><h2>About ' + esc(c.shortName || c.name) + '</h2><p class="ov-desc" style="color:var(--muted)"><span style="display:block;line-height:1.7">' +
        esc(c.name) + (founded ? ', founded in ' + esc(founded) : '') + (stadium ? ', play at ' + esc(stadium) : '') + '. A full club description is not available for this club yet.</span></p></div>';
    var right = '<div class="ov-card">' + (x.kit ? '<img class="ov-kit" src="' + esc(x.kit) + '" alt="" onerror="this.remove()">' : '') +
      '<h2>Club info</h2><div class="ov-facts">' + facts.map(function (f) { return '<div class="ov-fact"><span>' + f[0] + '</span><b>' + f[1] + '</b></div>'; }).join('') + '</div>' +
      (comps ? '<div class="ov-fact" style="display:block"><span style="display:block;margin-bottom:10px">Competitions</span><div class="ov-comps">' + comps + '</div></div>' : '') + '</div>';
    $('#clubOverview').innerHTML = '<div class="ov-grid">' + left + right + '</div>';
    var more = $('#ovMore');
    if (more) more.addEventListener('click', function () {
      var d = $('#ovDesc'), open = d.classList.toggle('clamp');
      more.textContent = open ? 'Read more' : 'Show less';
    });
  }

  function renderVideos(c, vs) {
    var host = $('#clubVideos');
    var res = vs.map(function (v) { return new RegExp('(?:^|[^a-z0-9])' + rx(v).replace(/ /g, ' ') + '(?![a-z0-9])'); });
    var list = (window.FS_VIDEOS || []).filter(function (v) {
      if (!v || typeof v !== 'object' || !v.t) return false;
      var t = norm(v.t);
      return res.some(function (r) { return r.test(t); });
    });
    if (!list.length) {
      host.innerHTML = '<div class="club-placeholder"><div class="display">No videos yet</div><p>We have no videos about ' + esc(c.shortName || c.name) + ' yet &mdash; check back soon.</p></div>';
      return;
    }
    host.innerHTML = '<div class="club-video-grid">' + list.map(function (v) {
      return '<a href="https://youtu.be/' + esc(v.id) + '" target="_blank" rel="noopener" class="club-video-card yt-trigger" data-yt="' + esc(v.id) + '">' +
        '<div class="club-video-thumb cv-thumb" style="background-image:url(\'https://i.ytimg.com/vi/' + esc(v.id) + '/hqdefault.jpg\')"><span class="yt-play" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></span></div>' +
        '<h4>' + esc(v.t) + '</h4></a>';
    }).join('') + '</div>';
  }

  fetch('/api/player?club=' + id).then(function (r) { return r.json(); }).then(function (res) {
    if (!res || !res.ok || !res.club) { fail((res && res.error) || 'Club data is unavailable right now.'); resolve(); return; }
    var c = res.club;
    var name = c.shortName && c.shortName.length <= c.name.length && !/\b(fc|afc|cf)\b/i.test(c.shortName) ? c.name : c.name;
    document.title = name + ' — Football Stories';
    $('#clubName').textContent = name;
    $('#clubBadge').textContent = c.tla || '';
    var vs = variants(c);

    var comps = (c.comps || []).slice();
    var slug = registerTopic(c, vs);
    var host = $('#clubNewsFeed');
    host.setAttribute('data-club', slug);
    host.setAttribute('data-label', name);

    window.FS_PLAYERS = window.FS_PLAYERS || {};
    var key = 'fd-' + c.id;
    window.FS_PLAYERS[key] = (c.squad || []).map(function (p) {
      var bits = [];
      if (p.nat) bits.push(p.nat);
      if (p.age != null) bits.push(p.age + ' years old');
      return [p.name, p.pos, '', bits.join(' · ') || 'No further details available.'];
    });
    window.FS_DYNAMIC_CLUB = {
      id: c.id, name: name, data: key, comps: comps, league: comps[0], slug: slug, dynamic: true, crest: c.crest || null,
      alt: vs
    };

    if (c.extra && safeUrl(c.extra.banner)) {
      var b = $('#clubBanner'), im = new Image();
      im.onload = function () { b.style.backgroundImage = 'url("' + c.extra.banner.replace(/"/g, '%22') + '")'; b.style.aspectRatio = ''; b.style.height = ''; };
      im.src = c.extra.banner;
    }
    renderOverview(c);
    renderVideos(c, vs);
    resolve();
  }).catch(function () { fail('Club data is unavailable right now.'); resolve(); });
})();
