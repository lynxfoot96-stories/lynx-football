/* youtube-sync.js — puts your newest YouTube uploads on the site automatically.
 *
 * Load it right AFTER videos-ui.js on any page that uses the video list (index.html, videos.html):
 *     <script src="videos-data.js"></script>
 *     <script src="videos-ui.js"></script>
 *     <script src="youtube-sync.js"></script>
 *
 * How it works: before the page builds its video list, this asks /api/youtube for the channel's latest
 * uploads. Every video that is NEWER than the first video already in videos-data.js is added on top
 * (title from YouTube, theme guessed from the title, thumbnail from YouTube). Older videos and anything
 * you wrote by hand in videos-data.js are never touched. If YouTube or the API is slow or down, the page
 * simply shows videos-data.js as before.
 */
(function () {
  'use strict';
  if (!window.FSV || typeof FSV.load !== 'function' || FSV.__ytSync) return;
  FSV.__ytSync = true;

  var CACHE_KEY = 'fs-yt-feed-v1', FRESH_MS = 10 * 60 * 1000, TIMEOUT_MS = 3000;

  function idOf(v) {
    var s = typeof v === 'string' ? v : (v && v.id) || '';
    var m = /(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/.exec(s);
    return m ? m[1] : (/^[\w-]{11}$/.test(s) ? s : '');
  }

  /* theme guess from the title (same themes as videos-data.js); unknown -> "Channel" */
  function guessTheme(t) {
    t = String(t || '');
    if (/ballon/i.test(t)) return "Ballon d'Or";
    if (/world cup/i.test(t)) return 'World Cup';
    if (/champions league|\bucl\b/i.test(t)) return 'Champions League';
    if (/\btop\s*\d+|\b\d+\s+(best|greatest|most|biggest|fastest|worst|underrated|favou?rites?|flops?|players?|footballers?|legends?)|\branked\b|world xi/i.test(t)) return 'Rankings';
    if (/\brecords?\b|unbreakable|origin of/i.test(t)) return 'Records';
    if (/\bvs\.?\b|rivalr|cl[aá]sico|derby/i.test(t)) return 'Rivalries';
    if (/transfer|signs?\b|\bjoins?\b|\bmove\b|\bdeal\b|\bbid\b|linked|wants|trapped/i.test(t)) return 'Transfer News';
    if (/\bstory\b|rise\b|what happened|truth behind|comeback/i.test(t)) return 'Player Story';
    return 'Channel';
  }

  function readCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (c && c.videos) return c;
    } catch (e) {}
    return null;
  }
  function writeCache(videos) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), videos: videos })); } catch (e) {}
  }

  function getFeed() {
    var c = readCache();
    if (c && Date.now() - c.t < FRESH_MS) return Promise.resolve(c.videos);
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) { if (!done) { done = true; resolve(v); } }
      var timer = setTimeout(function () { finish(c ? c.videos : []); }, TIMEOUT_MS);
      fetch('/api/youtube').then(function (r) { return r.json(); }).then(function (d) {
        clearTimeout(timer);
        if (d && d.ok && d.videos && d.videos.length) { writeCache(d.videos); finish(d.videos); }
        else finish(c ? c.videos : []);
      }).catch(function () { clearTimeout(timer); finish(c ? c.videos : []); });
    });
  }

  var merged = false;
  function merge(feed) {
    if (merged || !feed || !feed.length || !window.FS_VIDEOS) return;
    merged = true;
    var known = {};
    window.FS_VIDEOS.forEach(function (v) { var i = idOf(v); if (i) known[i] = true; });
    /* feed is newest-first: everything before the first video we already have is a new upload.
       (No overlap at all = something is off, e.g. wrong channel: add nothing.) */
    var fresh = [];
    for (var i = 0; i < feed.length; i++) {
      if (known[feed[i].id]) break;
      fresh.push(feed[i]);
    }
    var overlap = feed.some(function (f) { return known[f.id]; });
    if (!overlap || !fresh.length) return;
    var add = fresh.map(function (f) { return { id: f.id, c: guessTheme(f.title), t: f.title }; });
    Array.prototype.unshift.apply(window.FS_VIDEOS, add);   // same array object, newest on top
  }

  var original = FSV.load;
  FSV.load = function (cb) {
    var self = this, args = arguments;
    getFeed().then(function (feed) {
      try { merge(feed); } catch (e) {}
      original.apply(self, args);
    });
  };
})();
