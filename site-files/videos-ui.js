/* ============================================================================
   videos-ui.js  -  shared by index.html and videos.html.  You don't need to edit this file.
   To add a video, edit videos-data.js only.
   ============================================================================ */
(function(){
  var ICON = {
    all:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>',
    fallback:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/></svg>'
  };
  /* The home-page "Browse by theme" tiles and the videos-page chips follow this list (order = display order). */
  var THEMES = [
    {n:"Ballon d'Or", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 4h8v4a4 4 0 0 1-8 0V4z\"/><path d=\"M8 5H5a2 2 0 0 0 0 4h1\"/><path d=\"M16 5h3a2 2 0 0 1 0 4h-1\"/><path d=\"M12 12v4\"/><path d=\"M9 20h6\"/><path d=\"M10 16h4l1 4H9l1-4z\"/></svg>"},
    {n:"Transfer News", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M7 7h11l-3-3\"/><path d=\"M18 7l-3 3\"/><path d=\"M17 17H6l3-3\"/><path d=\"M6 17l3 3\"/></svg>"},
    {n:"Rankings", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 20V10\"/><path d=\"M12 20V4\"/><path d=\"M20 20v-7\"/></svg>"},
    {n:"World Cup", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 4h8v4a4 4 0 0 1-8 0V4z\"/><path d=\"M8 5H5a2 2 0 0 0 0 4h1\"/><path d=\"M16 5h3a2 2 0 0 1 0 4h-1\"/><circle cx=\"12\" cy=\"16\" r=\"4\"/></svg>"},
    {n:"Champions League", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 3v3M12 18v3M3 12h3M18 12h3\"/><path d=\"m6.5 6.5 2 2M15.5 15.5l2 2M6.5 17.5l2-2M15.5 8.5l2-2\"/></svg>"},
    {n:"Player Story", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"8\" r=\"3.2\"/><path d=\"M5 20c0-3.5 3-6 7-6s7 2.5 7 6\"/></svg>"},
    {n:"Records", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"9\" r=\"5\"/><path d=\"M9 13.5 7.5 21 12 18l4.5 3-1.5-7.5\"/></svg>"},
    {n:"Rivalries", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 4l6 6-6 6\"/><path d=\"M18 4l-6 6 6 6\"/></svg>"},
    {n:"Channel", i:"<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"M10 9.5v5l4.5-2.5z\"/></svg>"}
  ];

  function idFrom(s){
    s = String(s || '').trim();
    var m = /(?:youtu\.be\/|[?&]v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/.exec(s);
    if (m) return m[1];
    return /^[A-Za-z0-9_-]{11}$/.test(s) ? s : null;
  }
  function themeName(c){
    var raw = String(c || '').trim(), l = raw.toLowerCase();
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].n.toLowerCase() === l) return THEMES[i].n;
    return raw;
  }
  /* Used only when a video line has no category */
  function guess(t){
    t = String(t || '').toLowerCase();
    if (/ballon d.or|golden ball/.test(t)) return "Ballon d'Or";
    if (/world cup/.test(t)) return 'World Cup';
    if (/champions league|ucl/.test(t)) return 'Champions League';
    if (/never be broken|unbreakable|records?\b|panenka/.test(t)) return 'Records';
    if (/\bvs\b|rivalr|clasico|legends who played/.test(t)) return 'Rivalries';
    if (/transfer|move to|joins|signs|leaving|return\?|comeback|barcelona wants/.test(t)) return 'Transfer News';
    if (/^(top )?\d+ |\bgreatest\b|\bbest\b|\bmost\b|ranked|ranking/.test(t)) return 'Rankings';
    return 'Channel';
  }
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  var CKEY = 'fsv-titles-v1';
  function readCache(){ try{ return JSON.parse(localStorage.getItem(CKEY) || '{}'); }catch(e){ return {}; } }
  function writeCache(c){ try{ localStorage.setItem(CKEY, JSON.stringify(c)); }catch(e){} }

  function fetchTitle(id){
    return new Promise(function(res){
      var done = false, t = setTimeout(function(){ if(!done){ done = true; res(''); } }, 4000);
      try{
        fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent('https://youtu.be/' + id))
          .then(function(r){ return r.ok ? r.json() : {}; })
          .then(function(j){ if(!done){ done = true; clearTimeout(t); res((j && j.title) || ''); } })
          .catch(function(){ if(!done){ done = true; clearTimeout(t); res(''); } });
      }catch(e){ if(!done){ done = true; clearTimeout(t); res(''); } }
    });
  }

  /* load(cb): cb(list) gets the videos, newest first. Missing titles are fetched from YouTube (and remembered). */
  function load(cb){
    var seen = {}, list = [];
    (window.FS_VIDEOS || []).forEach(function(e){
      if (typeof e === 'string') e = {id:e};
      var id = idFrom(e.id || e.url || e.link);
      if (!id || seen[id]) return;
      seen[id] = 1;
      list.push({id:id, c:e.c || e.cat || e.category || '', t:e.t || e.title || ''});
    });
    var cache = readCache(), jobs = [];
    list.forEach(function(v){
      if (!v.t && cache[v.id]) v.t = cache[v.id];
      if (!v.t) jobs.push(fetchTitle(v.id).then(function(t){ if (t){ v.t = t; cache[v.id] = t; } }));
    });
    Promise.all(jobs).then(function(){
      writeCache(cache);
      list.forEach(function(v){
        if (!v.t) v.t = 'Watch on YouTube';
        v.c = v.c ? themeName(v.c) : guess(v.t);
      });
      cb(list);
    });
  }

  var PLAY = '<div class="mini-play"><svg width="14" height="14" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg></div>';
  function cardHTML(v){
    return '<div class="video-card" data-cat="' + esc(v.c) + '"><a href="https://youtu.be/' + v.id + '" class="card-link yt-trigger" data-yt="' + v.id + '">' +
      '<div class="video-thumb" data-vid="' + v.id + '">' + PLAY + '</div>' +
      '<div class="video-body"><div class="cat">' + esc(v.c) + '</div><h4>' + esc(v.t) + '</h4></div></a></div>';
  }

  /* Thumbnails: your own picture in /video-thumbs/<id>.jpg if it exists, otherwise YouTube's. Loaded only when a card scrolls into view. */
  function setThumb(el){
    var id = el.getAttribute('data-vid');
    if (!id || el.getAttribute('data-ok')) return;
    el.setAttribute('data-ok', '1');
    var srcs = ['video-thumbs/' + id + '.jpg', 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg', 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'];
    if (el.getAttribute('data-hq')) srcs = [srcs[1], srcs[0], srcs[2]];   // big featured picture: prefer YouTube's HD one
    var yt = function(i){ return srcs[i].indexOf('maxresdefault') > -1; };
    (function next(i){
      if (i >= srcs.length) return;
      var im = new Image();
      im.onload = function(){
        if (yt(i) && im.naturalWidth < 320) return next(i + 1);   // YouTube's grey "no picture" placeholder
        el.style.backgroundImage = "url('" + srcs[i] + "')";
      };
      im.onerror = function(){ next(i + 1); };
      im.src = srcs[i];
    })(0);
  }
  var io = null;
  function hydrate(root){
    var els = [].slice.call((root || document).querySelectorAll('.video-thumb[data-vid], .featured-media[data-vid]'));
    if (!('IntersectionObserver' in window)){ els.forEach(setThumb); return; }
    io = io || new IntersectionObserver(function(es){
      es.forEach(function(en){ if (en.isIntersecting){ setThumb(en.target); io.unobserve(en.target); } });
    }, {rootMargin:'400px 0px'});
    els.forEach(function(el){ if (!el.getAttribute('data-ok')) io.observe(el); });
  }

  window.FSV = {THEMES:THEMES, ICON:ICON, load:load, cardHTML:cardHTML, hydrate:hydrate, esc:esc};
})();
