/*
 * news-feed.js — filtered news for League pages, Club pages and the homepage club carousel.
 *
 *   FSNewsFeed.mount(element, {club:'real-madrid', label:'Real Madrid'})   // big story + 9 cards + pager
 *   FSNewsFeed.mount(element, {league:39, label:'Premier League'})
 *   FSNewsFeed.latest({club:'arsenal'}, 3).then(function(list){ ... })     // for small homepage blocks
 *
 * Needs: news-topics.js (before this file), news-feed.css (for mount), wiki-image.js (optional photo fallback).
 * Data: the same sources as news.html — the hand-written stories below + /api/news (automated stories).
 */
(function () {
  'use strict';

  /* Hand-written stories. Keep in sync with STATIC in news.html (add a new hand-written story in both).
     Images are the same pictures as news.html, saved as files in /news-img/. */
  var STATIC = [
    {id:'vinicius-pressure', date:'2026-10-05', label:'Oct 5, 2026', cat:'Real Madrid', img:'im-vini2', pos:'center 20%',
     title:'Vinícius Jr. faces pressure at Real Madrid',
     dek:'The Brazilian superstar is facing criticism after a difficult start to the season with Real Madrid.'},
    {id:'ronaldo-leaves-portugal-camp', date:'2026-10-01', label:'Oct 1, 2026', cat:'Portugal', img:'im-ronaldo', pos:'center 12%',
     title:'Cristiano Ronaldo walks out of Portugal camp',
     dek:"Cristiano Ronaldo's relationship with Portugal's new manager Jorge Jesus has erupted into a major controversy."},
    {id:'city-114-breaches', date:'2026-09-29', label:'Sep 29, 2026', cat:'Premier League', img:'im-city', pos:'center 30%',
     title:'Manchester City found guilty of 114 financial breaches',
     dek:'Manchester City have been found guilty of 114 of the 115 financial breaches brought against the club by the Premier League.'},
    {id:'mbappe-on', date:'2026-09-24', label:'Sep 24, 2026', cat:'Business', img:'im-mbappe', pos:'center 30%',
     title:'Mbappé leaves Nike and joins On',
     dek:'Mbappé leaves Nike after 20 years and joins On. The Real Madrid star becomes the face of the Swiss brand’s entry into football.'},
    {id:'alvarez-atletico', date:'2026-09-23', label:'Sep 23, 2026', cat:'Transfers', img:'im-alvarez', pos:'center 30%',
     title:'Julián Álvarez stays at Atlético Madrid',
     dek:'Julián Álvarez remains at Atlético Madrid after failed transfer attempt. The Argentine striker now faces a difficult situation at the Spanish club.'},
    {id:'ballon-dor-2026', date:'2026-09-22', label:'Sep 22, 2026', cat:"Ballon d'Or", img:'im-ballon', pos:'center 30%',
     title:"Ballon d'Or 2026: the race is wide open",
     dek:"The Ballon d'Or race is heating up. Mbappé, Yamal, Dembélé and Kane are among the biggest names competing for the award."},
    {id:'vinicius-difficult-moment', date:'2026-09-21', label:'Sep 21, 2026', cat:'Real Madrid', img:'im-vini', pos:'center 30%',
     title:'Vinícius Jr. faces a difficult moment at Real Madrid',
     dek:'Vinícius Jr. is going through one of the most difficult periods of his Real Madrid career. The Brazilian now has to respond after a disappointing Madrid derby.'},
    {id:'rodrygo-future', date:'2026-09-20', label:'Sep 20, 2026', cat:'Real Madrid', img:'im-rodrygo', pos:'center 30%',
     title:"Rodrygo's Real Madrid future enters another chapter",
     dek:"Rodrygo is getting closer to his return at Real Madrid. But his future could become one of the club's biggest questions."}
  ];

  var PER_PAGE = 10;                 // 1 big story + 9 cards, like news.html
  var BASE = (function () {          // folder this script was loaded from, so images work from any page
    var s = document.currentScript && document.currentScript.src;
    return s ? s.replace(/[^\/]*$/, '') : '/';
  })();

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function safeUrl(u) {
    u = String(u || '');
    if (!/^https?:\/\//i.test(u)) return '';
    return u.replace(/["'()\\\s]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
  }

  /* ---------- data (loaded once, shared by every mount on the page) ---------- */
  var master = null, loading = null;

  function build(dbRows) {
    var list = STATIC.map(function (s, i) {
      return {title: s.title, dek: s.dek, cat: s.cat, date: s.date, label: s.label, ts: 0, order: i,
              href: 'news-article.html?id=' + encodeURIComponent(s.id),
              imgUrl: BASE + 'news-img/' + s.img + '.jpg', pos: s.pos, credit: ''};
    });
    dbRows.forEach(function (a, i) {
      var day = String(a.published_date || a.created_at || '').slice(0, 10);
      list.push({title: a.title || 'Untitled', dek: a.summary || a.highlight || '', cat: a.category || 'News',
                 date: day, label: a.date_label || day, ts: Date.parse(a.created_at || '') || 0, order: 100 + i,
                 href: a.slug ? 'news-article.html?slug=' + encodeURIComponent(a.slug) : '#',
                 imgUrl: safeUrl(a.image_url), pos: 'center', credit: ''});
    });
    list.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if (a.ts !== b.ts) return b.ts - a.ts;
      return a.order - b.order;
    });
    list.forEach(function (a, i) { a.uid = 'f' + i; a.tags = FSTopics.tag(a); });
    return list;
  }

  function load() {
    if (master) return Promise.resolve(master);
    if (loading) return loading;
    loading = fetch('/api/news?limit=1000&compact=1', {headers: {Accept: 'application/json'}})
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) { master = build((d && d.articles) || []); master.partial = false; return master; })
      .catch(function (err) {
        console.error('News feed: automated stories could not be loaded', err);
        master = build([]); master.partial = true;   // hand-written stories still show
        return master;
      });
    return loading;
  }

  function pick(spec) {
    return load().then(function (all) {
      return Object.assign(all.filter(function (a) { return FSTopics.matches(a.tags, spec); }), {partial: all.partial});
    });
  }

  /* ---------- rendering (same markup/classes as news.html) ---------- */
  function creditHTML(a) { return a.credit ? '<span class="img-credit" title="' + esc(a.credit) + '">' + esc(a.credit) + '</span>' : ''; }
  function mediaHTML(a) {
    if (a.imgUrl) {
      return '<div class="nx-img" style="background-image:url(&quot;' + a.imgUrl + '&quot;);background-size:cover;background-position:' + esc(a.pos) + '"></div>' + creditHTML(a);
    }
    return '<div class="nx-img noimg" data-uid="' + esc(a.uid) + '" data-label="' + esc(a.cat) + '"></div>';
  }
  var ARROW_R = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  function cardHTML(a) {
    return '<a class="nx-card" href="' + esc(a.href) + '" data-cat="' + esc(a.cat) + '">' +
      '<div class="nx-card-media">' + mediaHTML(a) + '</div>' +
      '<div class="nx-card-body"><span class="nx-cat">' + esc(a.cat) + '</span>' +
      '<h3 class="nx-card-title">' + esc(a.title) + '</h3>' +
      '<time class="nx-date" datetime="' + esc(a.date) + '">' + esc(a.label) + '</time></div></a>';
  }
  function featuredHTML(a) {
    return '<a class="nx-featured" href="' + esc(a.href) + '" data-cat="' + esc(a.cat) + '">' +
      '<div class="nx-featured-media">' + mediaHTML(a) + '</div>' +
      '<div class="nx-featured-body"><div class="nx-kicker"><span class="nx-cat">' + esc(a.cat) + '</span><span aria-hidden="true">&bull;</span><time datetime="' + esc(a.date) + '">' + esc(a.label) + '</time></div>' +
      '<h2 class="nx-featured-title">' + esc(a.title) + '</h2>' +
      '<p class="nx-featured-dek">' + esc(a.dek) + '</p>' +
      '<div class="nx-featured-foot"><span class="nx-date">Latest story</span>' +
      '<span class="nx-read">Read the full story ' + ARROW_R + '</span></div></div></a>';
  }

  function pagerHTML(cur, pages) {
    if (pages <= 1) return '';
    var arrow = function (d) { return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>'; };
    var btn = function (p, inner, aria) { return '<button type="button" class="pg" data-page="' + p + '" aria-label="' + aria + '">' + inner + '</button>'; };
    var items = [];
    items.push(cur > 1 ? btn(cur - 1, arrow('M15 18l-6-6 6-6') + '<span class="pg-label">Previous</span>', 'Previous page')
      : '<span class="pg is-disabled" aria-hidden="true">' + arrow('M15 18l-6-6 6-6') + '<span class="pg-label">Previous</span></span>');
    var prev = 0;
    for (var p = 1; p <= pages; p++) {
      if (!(p === 1 || p === pages || Math.abs(p - cur) <= 1)) continue;
      if (p - prev > 1) items.push('<span class="pg-gap" aria-hidden="true">&hellip;</span>');
      items.push(p === cur ? '<span class="pg" aria-current="page" aria-label="Page ' + p + ', current page">' + p + '</span>' : btn(p, p, 'Page ' + p));
      prev = p;
    }
    items.push(cur < pages ? btn(cur + 1, '<span class="pg-label">Next</span>' + arrow('M9 18l6-6-6-6'), 'Next page')
      : '<span class="pg is-disabled" aria-hidden="true"><span class="pg-label">Next</span>' + arrow('M9 18l6-6-6-6') + '</span>');
    return items.join('');
  }

  /* ---------- missing images: Wikimedia fallback, same as news.html ---------- */
  var wmQueue = [], wmActive = 0, wmTried = {};
  function applyImage(art, found) {
    art.imgUrl = found.url; art.credit = found.credit;
    Array.prototype.forEach.call(document.querySelectorAll('.nx-img.noimg[data-uid="' + art.uid + '"]'), function (n) {
      var holder = n.parentNode;
      n.classList.remove('noimg'); n.removeAttribute('data-label');
      n.style.backgroundImage = 'url("' + found.url + '")'; n.style.backgroundSize = 'cover'; n.style.backgroundPosition = 'center';
      var big = holder.classList.contains('nx-card-media') || holder.classList.contains('nx-featured-media');
      if (big && !holder.querySelector('.img-credit')) holder.insertAdjacentHTML('beforeend', creditHTML(art));
    });
  }
  function pump() {
    while (wmActive < 2 && wmQueue.length) {
      var art = wmQueue.shift(); wmActive++;
      (window.FSWikiImage ? window.FSWikiImage.find(art.title) : Promise.resolve(null))
        .then(function (found) { if (found) applyImage(this, found); }.bind(art))
        .catch(function () {}).then(function () { wmActive--; pump(); });
    }
  }
  function fillMissingImages() {
    if (!master) return;
    Array.prototype.forEach.call(document.querySelectorAll('.nx-img.noimg[data-uid]'), function (n) {
      var uid = n.getAttribute('data-uid');
      if (wmTried[uid]) return; wmTried[uid] = 1;
      var art = master.filter(function (a) { return a.uid === uid; })[0];
      if (art) wmQueue.push(art);
    });
    pump();
  }

  /* ---------- mount: full feed inside a tab ---------- */
  function mount(el, spec, opts) {
    opts = opts || {};
    var label = opts.label || '';
    var token = {}; el.__nfToken = token;                // a newer mount() on the same element cancels this one
    el.classList.add('nf-wrap');
    el.innerHTML = '<div class="nf-top" tabindex="-1" style="outline:none"></div>' +
      '<p class="news-count nf-count" aria-live="polite"></p><div class="nf-note"></div>' +
      '<div class="nf-featured"></div><div class="nx-grid nx-grid-3 nf-grid"><p class="nx-empty">Loading news&hellip;</p></div>' +
      '<nav class="pager nf-pager" aria-label="News pages"></nav>';
    var topEl = el.querySelector('.nf-top'), countEl = el.querySelector('.nf-count'), noteEl = el.querySelector('.nf-note'),
        featEl = el.querySelector('.nf-featured'), gridEl = el.querySelector('.nf-grid'), pagerEl = el.querySelector('.nf-pager');
    var list = [], page = 1;

    function render(moveFocus) {
      var pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
      page = Math.min(Math.max(page, 1), pages);
      if (!list.length) {
        featEl.innerHTML = ''; pagerEl.innerHTML = ''; countEl.textContent = '';
        gridEl.innerHTML = '<p class="nx-empty">No stories about ' + esc(label || 'this yet') + ' yet. Check back soon.</p>';
        return;
      }
      var start = (page - 1) * PER_PAGE;
      featEl.innerHTML = featuredHTML(list[start]);
      gridEl.innerHTML = list.slice(start + 1, start + PER_PAGE).map(cardHTML).join('');
      countEl.textContent = list.length + (list.length === 1 ? ' story' : ' stories') + (pages > 1 ? ' · Page ' + page + ' of ' + pages : '');
      pagerEl.innerHTML = pagerHTML(page, pages);
      fillMissingImages();
      if (moveFocus) {
        topEl.scrollIntoView({behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start'});
        topEl.focus({preventScroll: true});
      }
    }

    pagerEl.addEventListener('click', function (e) {
      var b = e.target.closest('button.pg[data-page]'); if (!b) return;
      page = parseInt(b.getAttribute('data-page'), 10); render(true);
    });

    pick(spec).then(function (res) {
      if (el.__nfToken !== token) return;
      list = res;
      if (res.partial) noteEl.innerHTML = '<p class="news-note" role="status">Automated stories could not be loaded right now. Showing the main stories only.</p>';
      render(false);
    });
  }

  /* ---------- latest N for small blocks (homepage carousel) ---------- */
  function latest(spec, n) {
    return pick(spec).then(function (res) { return res.slice(0, n || 3); });
  }

  window.FSNewsFeed = {mount: mount, latest: latest, fillMissingImages: fillMissingImages, esc: esc};
})();
