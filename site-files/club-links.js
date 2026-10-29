/* club-links.js — turns club names into links to the club's page (Overview tab opens by default).
 *
 * Only clubs that have a page in club-meta.js (CLUBS) become clickable.
 * Any other club (Newcastle, AS Roma, Slavia Praha...) stays plain text.
 *
 * USAGE: add before </body> on every page that shows club names:
 *     <script src="club-links.js" defer></script>
 *
 * It works with names that are rendered later by JavaScript (matches, tables, lineups...)
 * by watching the page for changes.
 *
 * TO LINK A NEW PLACE: add its CSS selector to NAME_SELECTORS (the element must contain ONLY the club name).
 * TO ADD A NEW CLUB: add it in club-meta.js (CLUBS), this file picks it up automatically.
 */
(function () {
  'use strict';
  if (window.__fsClubLinks) return;
  window.__fsClubLinks = true;

  /* Elements that contain only a club name. */
  var NAME_SELECTORS = [
    '.match-row .team .n',            // matches.html: list of games
    '.standings-table .club .n',      // matches.html + match-table.html: standings tables
    '.team-col span',                 // standings.html: full tables
    '.player-team span',              // standings.html: top scorers (team name)
    '.name.display',                  // match*.html: team names in the match header
    '.team-name'                      // match-lineups.html + index.html cards
  ].join(',');

  /* ---------- css (no animation, just a normal link look) ---------- */
  var st = document.createElement('style');
  st.textContent =
    'a.club-link,[data-club-href]{color:inherit;text-decoration:none;cursor:pointer}' +
    'a.club-link:hover,[data-club-href]:hover{text-decoration:underline}';
  document.head.appendChild(st);

  /* ---------- name -> page lookup (built from club-meta.js) ---------- */
  var lookup = null;
  function buildLookup() {
    var M = window.FSClubMeta;
    if (!M || !M.CLUBS) return false;
    lookup = {};
    Object.keys(M.CLUBS).forEach(function (slug) {
      var c = M.CLUBS[slug];
      var names = [slug, c.name, c.data].concat(c.alt || []);
      names.forEach(function (n) { if (n) lookup[M.norm(n)] = slug + '.html'; });
    });
    return true;
  }
  function hrefFor(name) {
    if (!lookup) return null;
    return lookup[window.FSClubMeta.norm(name)] || null;
  }

  /* ---------- link the names ---------- */
  function linkAll(root) {
    if (!lookup) return;
    (root || document).querySelectorAll(NAME_SELECTORS).forEach(function (el) {
      if (el.getAttribute('data-fs-club-done')) return;
      // only plain-text name elements (no nested tags except an existing link)
      if (el.children.length) return;
      var href = hrefFor(el.textContent);
      el.setAttribute('data-fs-club-done', '1');
      if (!href) return;                       // club we don't have -> stays plain text

      if (el.closest('a')) {
        // Already inside another link (e.g. a whole match row links to match.html):
        // a link inside a link is invalid HTML, so use a link-like element instead.
        el.setAttribute('data-club-href', href);
        el.setAttribute('role', 'link');
        el.setAttribute('tabindex', '0');
      } else {
        var a = document.createElement('a');
        a.className = 'club-link';
        a.href = href;
        while (el.firstChild) a.appendChild(el.firstChild);
        el.appendChild(a);
      }
    });
  }

  /* ---------- click / keyboard for names that sit inside another link ---------- */
  function go(e, t) {
    var href = t.getAttribute('data-club-href');
    e.preventDefault();
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) window.open(href, '_blank');
    else window.location.href = href;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-club-href]');
    if (t) go(e, t);
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var t = e.target.closest && e.target.closest('[data-club-href]');
    if (t) go(e, t);
  }, true);

  /* Match tabs: make club logos/headers and player cards navigable.
   * player.html uses a name query, not the API player ID. */
  var extraStyle = document.createElement('style');
  extraStyle.textContent =
    '.match-head-team,.players-team-head,.pitch-head .side,.pitch-h-head .side,' +
    '.standings-table td.club,[data-fs-player]{cursor:pointer}' +
    '[data-fs-player]:hover .pname,[data-fs-player]:hover .name,' +
    '.match-head-team:hover .name,.standings-table td.club:hover .n{' +
    'text-decoration:underline;text-decoration-thickness:1px}' +
    '.fs-player-link{color:inherit;text-decoration:none}' +
    '.fs-player-link:hover{text-decoration:underline}';
  document.head.appendChild(extraStyle);

  function navigate(e, href) {
    if (!href) return;
    e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) window.open(href, '_blank');
    else window.location.href = href;
  }
  function matchDestination(target) {
    var player = target.closest('[data-fs-player]');
    if (player) {
      var name = player.getAttribute('data-fs-player');
      return name ? 'player.html?name=' + name : null;
    }
    var clubEl = target.closest('.match-head-team,.players-team-head,.standings-table td.club,.pitch-head .side,.pitch-h-head .side');
    if (!clubEl) return null;
    var nameNode = clubEl.querySelector('.name.display,.team-name,.n');
    var name = nameNode ? nameNode.textContent : clubEl.textContent;
    return hrefFor(name.trim());
  }
  document.addEventListener('click', function (e) {
    if (!lookup || !(e.target instanceof Element) || e.target.closest('a,[data-club-href]')) return;
    navigate(e, matchDestination(e.target));
  }, true);
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !lookup || !(e.target instanceof Element)) return;
    if (e.target.closest('a,[data-club-href]')) return;
    navigate(e, matchDestination(e.target));
  }, true);

  /* ---------- boot ---------- */
  var queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; linkAll(); });
  }
  function start() {
    if (!buildLookup()) return;
    linkAll();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  }
  function boot() {
    if (window.FSClubMeta) return start();
    var s = document.createElement('script');
    s.src = 'club-meta.js';
    s.onload = start;
    document.head.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
