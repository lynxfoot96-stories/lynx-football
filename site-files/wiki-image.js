/*!
 * wiki-image.js — finds a free photo on Wikimedia Commons for a news title.
 * Shared by news.html and news-article.html so a story gets the SAME photo on its card and on its page.
 *
 *   FSWikiImage.find("Messi unveiled special jersey for farewell Argentina match")
 *     .then(function(r){ r && r.url, r.hi, r.credit })     // never rejects; resolves null when nothing is found
 *
 *   r.url    ~900px wide image (cards)
 *   r.hi     ~1600px version for big banners ('' when the original is smaller)
 *   r.credit "Photo: <author> · <licence> · Wikimedia Commons"  (show it: most Commons licences require credit)
 */
(function (global) {
  'use strict';
  var API = 'https://commons.wikimedia.org/w/api.php';
  var STORE_KEY = 'fs96-wm';
  var STOP = /^(the|a|an|and|or|but|for|of|to|in|on|at|as|by|with|from|after|before|over|under|into|out|up|down|is|are|was|were|be|has|have|had|will|new|first|latest|says|say|said|set|get|gets|leaves|leave|joins|join|faces|face|walks|walk|found|guilty|special|big|major|its|his|her|their|this|that|than|then|vs|v)$/i;
  var BAD_FILE = /(logo|flag|map|crest|coat of arms|signature|stamp|icon|diagram|chart|badge|emblem|kit|jersey|shirt|stadium plan|poster|screenshot)/i;
  var mem = {}, inflight = {}, queue = [], active = 0, MAX = 2;

  function readStore() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } }
  function writeStore(o) { try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) {} }
  function safeUrl(u) {
    u = String(u || '');
    if (!/^https?:\/\//i.test(u)) return '';
    return u.replace(/["'()\\\s]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }
  function stripHtml(h) { var d = document.createElement('div'); d.innerHTML = String(h || ''); return (d.textContent || '').replace(/\s+/g, ' ').trim(); }

  /* "Haaland injury as Portugal clinch Nations League spot" -> ["Haaland Portugal Nations League", "Haaland Portugal", "Haaland"] */
  function extractKeywords(title) {
    var words = String(title || '').replace(/['’]s\b/g, '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean);
    var proper = words.filter(function (w) { return /^\p{Lu}/u.test(w) && !STOP.test(w) && !/^\p{N}+$/u.test(w); });
    var pool = proper.length >= 1 && proper.length < words.length ? proper
      : words.filter(function (w) { return w.length > 3 && !STOP.test(w); });
    pool = pool.filter(function (w, i) { return pool.indexOf(w) === i; }).slice(0, 4);
    var out = [];
    for (var n = pool.length; n >= 1; n--) {
      if (n === pool.length || n <= 2) out.push(pool.slice(0, n).join(' '));
    }
    return out.filter(function (q, i) { return q && out.indexOf(q) === i; });
  }

  function search(query) {
    var params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', generator: 'search',
      gsrsearch: query + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '10',
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '900',
      iiextmetadatafilter: 'Artist|LicenseShortName|ImageDescription'
    });
    var ctl = ('AbortController' in global) ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 7000);
    return fetch(API + '?' + params.toString(), ctl ? { signal: ctl.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        var pages = (j && j.query && j.query.pages) ? Object.keys(j.query.pages).map(function (k) { return j.query.pages[k]; }) : [];
        pages.sort(function (a, b) { return (a.index || 0) - (b.index || 0); });
        return pages;
      }, function (e) { clearTimeout(timer); throw e; });
  }

  function hiRes(thumb, origWidth) {
    var m = /\/(\d+)px-([^\/]+)$/.exec(thumb || '');
    return (m && origWidth >= 1600) ? thumb.replace(/\/\d+px-([^\/]+)$/, '/1600px-$1') : '';
  }

  function pick(pages, query) {
    var tokens = query.toLowerCase().split(/\s+/).filter(function (t) { return t.length > 2; });
    var good = pages.map(function (p) {
      var ii = p.imageinfo && p.imageinfo[0]; if (!ii) return null;
      var meta = ii.extmetadata || {};
      var title = String(p.title || '').replace(/^File:/i, '');
      var hay = (title + ' ' + stripHtml(meta.ImageDescription && meta.ImageDescription.value)).toLowerCase();
      if (!/^image\/(jpeg|png)$/.test(ii.mime || '') || (ii.width || 0) < 600 || (ii.height || 0) < 300) return null;
      if (!tokens.some(function (t) { return hay.indexOf(t) !== -1; }) || BAD_FILE.test(title)) return null;
      var url = safeUrl(ii.thumburl || ii.url); if (!url) return null;
      var artist = stripHtml(meta.Artist && meta.Artist.value).slice(0, 40);
      var lic = stripHtml(meta.LicenseShortName && meta.LicenseShortName.value);
      return { url: url, hi: safeUrl(hiRes(ii.thumburl, ii.width)), w: ii.width, landscape: ii.width >= ii.height,
               credit: 'Photo: ' + (artist || 'Wikimedia Commons') + (lic ? ' · ' + lic : '') + ' · Wikimedia Commons' };
    }).filter(Boolean);
    return good.filter(function (g) { return g.landscape; })[0] || good[0] || null;
  }

  function canLoad(url) {
    return new Promise(function (resolve) {
      var im = new Image(); im.onload = function () { resolve(true); }; im.onerror = function () { resolve(false); }; im.src = url;
    });
  }

  function lookup(title) {
    var queries = extractKeywords(title);
    if (!queries.length) return Promise.resolve(null);
    var key = queries[0].toLowerCase(), store = readStore(), hit = store[key];
    if (mem[key] !== undefined) return Promise.resolve(mem[key]);
    if (inflight[key]) return inflight[key];          /* same story asked twice at once: one request */
    if (hit && Date.now() - hit.t < (hit.url ? 7 : 1) * 86400000) return Promise.resolve(hit.url ? hit : null);
    var i = 0;
    function next() {
      if (i >= queries.length) return Promise.resolve(null);
      var q = queries[i++];
      return search(q).then(function (pages) {
        var p = pick(pages, q);
        if (!p) return next();
        return canLoad(p.url).then(function (ok) { return ok ? p : next(); });
      }, function (err) { console.warn('Wikimedia lookup failed for "' + q + '":', err && err.message); return null; });
    }
    inflight[key] = next().then(function (found) {
      mem[key] = found; delete inflight[key];
      var st = readStore();
      st[key] = found ? { url: found.url, hi: found.hi, w: found.w, credit: found.credit, t: Date.now() } : { url: '', t: Date.now() };
      writeStore(st);
      return found;
    }, function () { delete inflight[key]; return null; });
    return inflight[key];
  }

  /* public: queued (max 2 requests at a time) */
  function find(title) {
    return new Promise(function (resolve) {
      queue.push({ title: title, resolve: resolve });
      pump();
    });
  }
  function pump() {
    while (active < MAX && queue.length) {
      var job = queue.shift(); active++;
      lookup(job.title).then(job.resolve, function () { job.resolve(null); }).then(function () { active--; pump(); });
    }
  }

  global.FSWikiImage = { find: find, extractKeywords: extractKeywords };
})(window);
