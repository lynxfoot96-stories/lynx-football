/* club-meta.js — shared club / league data + logo loading.
 * Used by club-tabs.js (every club page) and by clubs.html.
 *
 * LOGOS: nothing is hardcoded. Club crests and league emblems are read from your own
 * /api/standings endpoint (football-data.org crests), the same logos the standings tables
 * already show, and cached in localStorage for 7 days so most visits cost no extra calls.
 * The league-logo cache uses the SAME key as index.html (fs96-league-logos-v1), so they share it.
 *
 * TO ADD A CLUB: add one line to CLUBS (football-data.org team id, domestic league id first in comps).
 */
(function () {
  'use strict';
  if (window.FSClubMeta) return;

  var COMP_NAMES = {
    39: 'Premier League', 140: 'La Liga', 135: 'Serie A', 78: 'Bundesliga', 61: 'Ligue 1',
    2: 'Champions League', 94: 'Primeira Liga', 71: 'Brasileirão'
  };
  // clubs.html league slug -> competition id used by /api/standings
  var LEAGUE_SLUG = {
    'premier-league': 39, 'serie-a': 135, 'bundesliga': 78, 'la-liga': 140,
    'ligue-1': 61, 'brasileirao': 71, 'primeira-liga': 94
  };

  /* slug = page file name. id = football-data.org team id.
   * data = key used in club-players-data*.js.  alt = other names seen in the site / API (normalised match).
   * comps = competitions whose top-scorer lists are searched (domestic league FIRST). */
  var CLUBS = {
    'real-madrid':       { id: 86,   name: 'Real Madrid',         data: 'real-madrid',     comps: [140, 2], alt: ['real madrid', 'real madrid cf'] },
    'manchester-city':   { id: 65,   name: 'Manchester City',     data: 'manchester-city', comps: [39, 2],  alt: ['man city', 'manchester city fc', 'man-city'] },
    'barcelona':         { id: 81,   name: 'FC Barcelona',        data: 'barcelona',       comps: [140, 2], alt: ['barcelona', 'barca', 'fc barcelona'] },
    'bayern-munich':     { id: 5,    name: 'Bayern Munich',       data: 'bayern-munich',   comps: [78, 2],  alt: ['bayern', 'fc bayern munchen', 'fc bayern munich'] },
    'arsenal':           { id: 57,   name: 'Arsenal',             data: 'arsenal',         comps: [39, 2],  alt: ['arsenal fc'] },
    'psg':               { id: 524,  name: 'Paris Saint-Germain', data: 'psg',             comps: [61, 2],  alt: ['psg', 'paris sg', 'paris saint germain'] },
    'liverpool':         { id: 64,   name: 'Liverpool',           data: 'liverpool',       comps: [39, 2],  alt: ['liverpool fc'] },
    'inter-milan':       { id: 108,  name: 'Inter Milan',         data: 'inter',           comps: [135, 2], alt: ['inter', 'fc internazionale milano', 'internazionale'] },
    'bayer-leverkusen':  { id: 3,    name: 'Bayer 04 Leverkusen', data: 'leverkusen',      comps: [78, 2],  alt: ['leverkusen', 'bayer leverkusen', 'bayer 04 leverkusen'] },
    'atletico-madrid':   { id: 78,   name: 'Atlético Madrid',     data: 'atletico-madrid', comps: [140, 2], alt: ['atletico', 'atleti', 'club atletico de madrid', 'atletico madrid'] },
    'sporting-cp':       { id: 498,  name: 'Sporting CP',         data: 'sporting-cp',     comps: [94, 2],  alt: ['sporting', 'sporting cp', 'sporting clube de portugal'] },
    'atalanta':          { id: 102,  name: 'Atalanta',            data: 'atalanta',        comps: [135, 2], alt: ['atalanta bc'] },
    'borussia-dortmund': { id: 4,    name: 'Borussia Dortmund',   data: 'dortmund',        comps: [78, 2],  alt: ['dortmund', 'bvb', 'borussia dortmund'] },
    'juventus':          { id: 109,  name: 'Juventus',            data: 'juventus',        comps: [135, 2], alt: ['juventus fc', 'juve'] },
    'chelsea':           { id: 61,   name: 'Chelsea',             data: 'chelsea',         comps: [39, 2],  alt: ['chelsea fc'] },
    'aston-villa':       { id: 58,   name: 'Aston Villa',         data: 'aston-villa',     comps: [39, 2],  alt: ['aston villa fc', 'villa'] },
    'ac-milan':          { id: 98,   name: 'AC Milan',            data: 'ac-milan',        comps: [135, 2], alt: ['milan', 'ac milan'] },
    'as-monaco':         { id: 548,  name: 'AS Monaco',           data: 'monaco',          comps: [61, 2],  alt: ['monaco', 'as monaco', 'as monaco fc'] },
    'napoli':            { id: 113,  name: 'SSC Napoli',          data: 'napoli',          comps: [135, 2], alt: ['napoli', 'ssc napoli'] },
    'benfica':           { id: 1903, name: 'SL Benfica',          data: 'benfica',         comps: [94, 2],  alt: ['benfica', 'sl benfica'] }
  };
  Object.keys(CLUBS).forEach(function (s) { CLUBS[s].slug = s; CLUBS[s].league = CLUBS[s].comps[0]; });

  function norm(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // find a club by page slug, data key (e.g. "leverkusen") or the data-club attribute ("man-city")
  function findClub(key) {
    if (!key) return null;
    if (CLUBS[key]) return CLUBS[key];
    var k = norm(key);
    for (var s in CLUBS) {
      var c = CLUBS[s];
      if (c.data === key || norm(c.data) === k || norm(s) === k || c.alt.indexOf(k) !== -1) return c;
    }
    return null;
  }
  // does an API team object ({id,name}) belong to this club?
  function isClubTeam(club, team) {
    if (!club || !team) return false;
    if (team.id === club.id) return true;
    var n = norm(team.name);
    return n === norm(club.name) || club.alt.indexOf(n) !== -1;
  }

  /* ---------- fetch helper (one request per URL per page) ---------- */
  var jsonCache = {};
  function getJSON(url) {
    if (!jsonCache[url]) {
      jsonCache[url] = fetch(url).then(function (r) { return r.json(); }).catch(function () { return { ok: false }; });
    }
    return jsonCache[url];
  }

  /* ---------- logo stores ---------- */
  var CKEY = 'fs-club-crests-v1', LKEY = 'fs96-league-logos-v1', MAX_AGE = 7 * 24 * 3600 * 1000;
  var crests = {}, leagueLogos = {}, subs = [];
  function read(key, field) {
    try {
      var s = JSON.parse(localStorage.getItem(key));
      if (s && s.t && s[field] && Date.now() - s.t < MAX_AGE) return s;
    } catch (e) {}
    return null;
  }
  var cs = read(CKEY, 'crests'); if (cs) crests = cs.crests;
  var ls = read(LKEY, 'logos');  if (ls) leagueLogos = ls.logos;
  var crestT = cs ? cs.t : Date.now(), logoT = ls ? ls.t : Date.now();
  function save() {
    try {
      localStorage.setItem(CKEY, JSON.stringify({ t: crestT, crests: crests }));
      localStorage.setItem(LKEY, JSON.stringify({ t: logoT, logos: leagueLogos }));
    } catch (e) {}
  }
  function notify() { subs.forEach(function (fn) { try { fn(); } catch (e) {} }); }

  var loaded = {};
  function loadLeague(id) {
    if (loaded[id]) return loaded[id];
    loaded[id] = getJSON('/api/standings?league=' + id).then(function (res) {
      var d = res && res.ok && res.data;
      if (!d) return;
      if (d.league && d.league.logo) leagueLogos[id] = d.league.logo;
      (d.standings || []).forEach(function (r) { if (r.team && r.team.id && r.team.logo) crests[r.team.id] = r.team.logo; });
    });
    return loaded[id];
  }
  // load logos for the given competition ids, then tell listeners
  function load(ids) {
    return Promise.all(ids.map(loadLeague)).then(function () { save(); notify(); });
  }

  window.FSClubMeta = {
    CLUBS: CLUBS,
    COMP_NAMES: COMP_NAMES,
    LEAGUE_SLUG: LEAGUE_SLUG,
    norm: norm,
    findClub: findClub,
    isClubTeam: isClubTeam,
    getJSON: getJSON,
    load: load,
    crest: function (teamId) { return crests[teamId] || null; },
    leagueLogo: function (idOrSlug) { return leagueLogos[LEAGUE_SLUG[idOrSlug] || idOrSlug] || null; },
    onUpdate: function (fn) { subs.push(fn); }
  };
})();
