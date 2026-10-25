/* ==========================================================
   Football Stories 96 — Newsletter modal (Stage 1 + Stage 3)
   - Opens from any newsletter button (see TRIGGERS below)
   - Reads favourites from localStorage (Stage 2) and offers
     personalised matchday alerts
   - Posts JSON to /api/subscribe (keeps the provider key private)
   ========================================================== */
(function () {
  'use strict';

  var ENDPOINT = '/api/subscribe';
  var FAV_KEY = 'fs96_user_favorites';
  var LEAGUES = [
    { id: 'premier-league', label: 'Premier League' },
    { id: 'la-liga', label: 'La Liga' },
    { id: 'serie-a', label: 'Serie A' },
    { id: 'bundesliga', label: 'Bundesliga' },
    { id: 'ligue-1', label: 'Ligue 1' },
    { id: 'champions-league', label: 'Champions League' }
  ];

  var dlg = null, form = null, busy = false;

  // Styles live here, so there is no separate CSS file to upload.
  var CSS = "/* ==========================================================\n   Football Stories 96 \u2014 Newsletter modal (Stage 1 + 3)\n   Uses the site's own CSS variables (--panel, --panel-2, --line,\n   --white, --muted, --purple, --orange) so it follows the theme toggle.\n   ========================================================== */\n\ndialog.fs-nl {\n  --fs-bg: var(--panel-2, #17151C);\n  --fs-surface: var(--panel, #121116);\n  --fs-purple: var(--purple, #8A3FFC);\n  --fs-purple-bright: var(--purple-bright, #A868FF);\n  --fs-orange: var(--orange, #FF7A1A);\n  --fs-text: var(--white, #F4F3F6);\n  --fs-muted: var(--muted, #9A96A3);\n  --fs-line: var(--line, rgba(255, 255, 255, .12));\n\n  border: 0;\n  padding: 0;\n  background: transparent;\n  color: var(--fs-text);\n  width: calc(100% - 24px);\n  max-width: 520px;\n  max-height: calc(100dvh - 24px);\n  overflow: visible;\n  font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;\n}\n\ndialog.fs-nl::backdrop {\n  background: rgba(8, 7, 10, .72);\n  backdrop-filter: blur(6px);\n  -webkit-backdrop-filter: blur(6px);\n}\n\ndialog.fs-nl[open] { animation: fs-nl-in .28s cubic-bezier(.2, .8, .2, 1); }\ndialog.fs-nl[open]::backdrop { animation: fs-nl-fade .28s ease; }\n\n@keyframes fs-nl-in { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }\n@keyframes fs-nl-fade { from { opacity: 0; } to { opacity: 1; } }\n\nhtml.fs-nl-open { overflow: hidden; }\n\n.fs-nl__panel {\n  position: relative;\n  max-height: calc(100dvh - 24px);\n  overflow-y: auto;\n  padding: 32px 28px 26px;\n  background:\n    radial-gradient(120% 70% at 100% 0%, rgba(138, 63, 252, .2), transparent 60%),\n    radial-gradient(90% 60% at 0% 100%, rgba(255, 122, 26, .1), transparent 60%),\n    var(--fs-surface);\n  border: 1px solid var(--fs-line);\n  border-radius: 20px;\n  box-shadow: 0 30px 80px rgba(0, 0, 0, .5);\n}\n\n.fs-nl__close {\n  position: absolute; top: 12px; right: 12px;\n  width: 36px; height: 36px;\n  display: grid; place-items: center;\n  border: 1px solid var(--fs-line); border-radius: 50%;\n  background: var(--fs-bg); color: var(--fs-text);\n  cursor: pointer; transition: border-color .2s, transform .2s;\n}\n.fs-nl__close:hover { border-color: var(--fs-purple-bright); transform: rotate(90deg); }\n.fs-nl__close:focus-visible { outline: 2px solid var(--fs-orange); outline-offset: 2px; }\n\n.fs-nl__eyebrow {\n  margin: 0 0 6px; font-size: 12px; font-weight: 700;\n  letter-spacing: .14em; text-transform: uppercase; color: var(--fs-orange);\n}\n.fs-nl__title {\n  margin: 0 0 8px;\n  font-family: 'Big Shoulders Display', Impact, 'Arial Narrow', sans-serif;\n  font-size: clamp(34px, 8vw, 46px); line-height: 1; font-weight: 800;\n  text-transform: uppercase; letter-spacing: .01em; color: var(--fs-text);\n}\n.fs-nl__title:focus { outline: none; }\n.fs-nl__lead { margin: 0 0 20px; font-size: 14.5px; line-height: 1.55; color: var(--fs-muted); }\n\n.fs-nl__label, .fs-nl__legend {\n  display: block; margin: 0 0 8px; padding: 0;\n  font-size: 13px; font-weight: 600; color: var(--fs-text);\n}\n.fs-nl__legend span { font-weight: 400; color: var(--fs-muted); }\n\n.fs-nl__input {\n  width: 100%; box-sizing: border-box; height: 48px; padding: 0 14px;\n  border-radius: 12px; border: 1px solid var(--fs-line);\n  background: var(--fs-bg); color: var(--fs-text);\n  font: inherit; font-size: 16px; /* 16px prevents iOS zoom */\n  transition: border-color .2s, box-shadow .2s;\n}\n.fs-nl__input::placeholder { color: var(--fs-muted); opacity: .8; }\n.fs-nl__input:focus { outline: none; border-color: var(--fs-purple); box-shadow: 0 0 0 3px rgba(138, 63, 252, .3); }\n\n.fs-nl__fieldset { border: 0; margin: 18px 0 0; padding: 0; min-width: 0; }\n.fs-nl__chips { display: flex; flex-wrap: wrap; gap: 8px; }\n.fs-nl__chip { position: relative; }\n.fs-nl__chip input { position: absolute; opacity: 0; inset: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; }\n.fs-nl__chip span {\n  display: inline-block; padding: 8px 14px; border-radius: 999px;\n  border: 1px solid var(--fs-line); background: var(--fs-bg);\n  font-size: 13px; font-weight: 500; color: var(--fs-muted);\n  transition: all .18s ease; user-select: none;\n}\n.fs-nl__chip:hover span { border-color: var(--fs-purple-bright); color: var(--fs-text); }\n.fs-nl__chip input:checked + span {\n  background: rgba(138, 63, 252, .22); border-color: var(--fs-purple); color: var(--fs-text); font-weight: 600;\n}\n.fs-nl__chip input:focus-visible + span { outline: 2px solid var(--fs-orange); outline-offset: 2px; }\n\n.fs-nl__personal {\n  margin-top: 16px; padding: 12px 14px; border-radius: 12px;\n  border: 1px solid rgba(255, 122, 26, .45); background: rgba(255, 122, 26, .09);\n}\n.fs-nl__personal[hidden] { display: none; }\n.fs-nl__personal strong { color: var(--fs-orange); }\n\n.fs-nl__check { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; line-height: 1.5; color: var(--fs-muted); cursor: pointer; }\n.fs-nl__check input { margin: 3px 0 0; width: 16px; height: 16px; flex: none; accent-color: var(--fs-purple); }\n.fs-nl__check a { color: var(--fs-text); text-decoration: underline; text-underline-offset: 2px; }\n.fs-nl__check--consent { margin-top: 16px; }\n\n.fs-nl__hp { position: absolute !important; left: -9999px; width: 1px; height: 1px; opacity: 0; }\n\n.fs-nl__submit {\n  position: relative; margin-top: 20px; width: 100%; height: 50px;\n  display: inline-flex; align-items: center; justify-content: center; gap: 10px;\n  border: 0; border-radius: 12px; cursor: pointer;\n  font: inherit; font-size: 15px; font-weight: 700; color: #fff;\n  background: linear-gradient(135deg, var(--fs-purple), #6a2ad6);\n  box-shadow: 0 8px 24px rgba(138, 63, 252, .35);\n  transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;\n}\n.fs-nl__submit:hover { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(138, 63, 252, .5); filter: brightness(1.08); }\n.fs-nl__submit:active { transform: translateY(0); }\n.fs-nl__submit:focus-visible { outline: 2px solid var(--fs-orange); outline-offset: 3px; }\n.fs-nl__submit[disabled] { cursor: progress; filter: saturate(.7); transform: none; }\n\n.fs-nl__spinner {\n  display: none; width: 18px; height: 18px; border-radius: 50%;\n  border: 2px solid rgba(255, 255, 255, .35); border-top-color: #fff;\n  animation: fs-nl-spin .7s linear infinite;\n}\n.fs-nl__submit[disabled] .fs-nl__spinner { display: inline-block; }\n@keyframes fs-nl-spin { to { transform: rotate(360deg); } }\n\n.fs-nl__status { min-height: 20px; margin: 12px 0 0; font-size: 13px; color: #e5484d; }\n\n.fs-nl__view[hidden] { display: none; }\n.fs-nl__done { text-align: center; padding: 10px 0 4px; }\n.fs-nl__tick {\n  width: 64px; height: 64px; margin: 0 auto 16px; display: grid; place-items: center;\n  border-radius: 50%; color: #fff;\n  background: linear-gradient(135deg, var(--fs-orange), #ff4d4d);\n  box-shadow: 0 0 0 8px rgba(255, 122, 26, .15), 0 0 40px rgba(255, 122, 26, .35);\n  animation: fs-nl-pop .45s cubic-bezier(.2, 1.4, .4, 1);\n}\n@keyframes fs-nl-pop { from { transform: scale(.4); opacity: 0; } to { transform: none; opacity: 1; } }\n\n@media (max-width: 480px) {\n  .fs-nl__panel { padding: 28px 18px 20px; border-radius: 16px; }\n}\n\n@media (prefers-reduced-motion: reduce) {\n  dialog.fs-nl[open], dialog.fs-nl[open]::backdrop, .fs-nl__tick, .fs-nl__spinner { animation-duration: .01ms; animation-iteration-count: 1; }\n  .fs-nl__submit, .fs-nl__close, .fs-nl__chip span { transition: none; }\n}\n";
  var styleTag = document.createElement('style');
  styleTag.id = 'fs96-nl-css';
  styleTag.textContent = CSS;
  document.head.appendChild(styleTag);

  /* ---------- helpers ---------- */
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  function readFavs() {
    try {
      var a = JSON.parse(localStorage.getItem(FAV_KEY) || '[]');
      return Array.isArray(a) ? a.filter(function (f) { return f && f.type && f.name; }) : [];
    } catch (e) { return []; }
  }
  function namesOf(favs, type) {
    return favs.filter(function (f) { return f.type === type; }).map(function (f) { return String(f.name); });
  }

  /* ---------- build modal once ---------- */
  function build() {
    if (dlg) return;
    dlg = document.createElement('dialog');
    dlg.className = 'fs-nl';
    dlg.id = 'fs-nl';
    dlg.setAttribute('aria-labelledby', 'fs-nl-title');
    dlg.setAttribute('aria-describedby', 'fs-nl-desc');
    dlg.innerHTML =
      '<div class="fs-nl__panel">' +
        '<button type="button" class="fs-nl__close" data-close aria-label="Close">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="fs-nl__view" data-view="form">' +
          '<p class="fs-nl__eyebrow">Football Stories 96</p>' +
          '<h2 id="fs-nl-title" class="fs-nl__title">Never miss a story</h2>' +
          '<p id="fs-nl-desc" class="fs-nl__lead">The Monday Football Debrief and the Friday Weekend Preview, straight to your inbox. Free. Unsubscribe anytime.</p>' +
          '<form data-form>' +
            '<label class="fs-nl__label" for="fs-nl-email">Email address</label>' +
            '<input id="fs-nl-email" class="fs-nl__input" type="email" name="email" required maxlength="254" autocomplete="email" inputmode="email" placeholder="you@example.com">' +
            '<fieldset class="fs-nl__fieldset"><legend class="fs-nl__legend">Favorite leagues <span>(optional)</span></legend><div class="fs-nl__chips" data-leagues></div></fieldset>' +
            '<div class="fs-nl__personal" data-personal hidden><label class="fs-nl__check"><input type="checkbox" name="alerts" checked><span data-personal-text></span></label></div>' +
            '<label class="fs-nl__check fs-nl__check--consent"><input type="checkbox" name="consent" required><span>I agree to receive this newsletter and accept the <a href="privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>' +
            '<input class="fs-nl__hp" type="text" name="company" tabindex="-1" autocomplete="off" aria-hidden="true">' +
            '<button type="submit" class="fs-nl__submit"><span data-label>Subscribe</span><span class="fs-nl__spinner" aria-hidden="true"></span></button>' +
            '<p class="fs-nl__status" data-status role="status" aria-live="polite"></p>' +
          '</form>' +
        '</div>' +
        '<div class="fs-nl__view fs-nl__done" data-view="done" hidden>' +
          '<div class="fs-nl__tick"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19 7"/></svg></div>' +
          '<h2 class="fs-nl__title" data-done-title tabindex="-1">You’re in</h2>' +
          '<p class="fs-nl__lead">Check your inbox for a welcome email. If you don’t see it, look in spam or promotions.</p>' +
          '<button type="button" class="fs-nl__submit" data-close>Back to the site</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(dlg);

    form = dlg.querySelector('[data-form]');

    var wrap = dlg.querySelector('[data-leagues]');
    LEAGUES.forEach(function (l) {
      var lab = document.createElement('label'); lab.className = 'fs-nl__chip';
      var inp = document.createElement('input'); inp.type = 'checkbox'; inp.name = 'league'; inp.value = l.id;
      var sp = document.createElement('span'); sp.textContent = l.label;
      lab.appendChild(inp); lab.appendChild(sp); wrap.appendChild(lab);
    });

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });
    dlg.addEventListener('close', function () { document.documentElement.classList.remove('fs-nl-open'); });
    form.addEventListener('submit', onSubmit);
  }

  /* ---------- Stage 3: personalise from favourites ---------- */
  function personalise() {
    var favs = readFavs();
    var clubs = namesOf(favs, 'club');
    var favLeagueIds = namesOf(favs, 'league').map(slug);

    Array.prototype.forEach.call(dlg.querySelectorAll('input[name="league"]'), function (i) {
      if (favLeagueIds.indexOf(i.value) !== -1) i.checked = true;
    });

    var box = dlg.querySelector('[data-personal]');
    var txt = dlg.querySelector('[data-personal-text]');
    txt.textContent = '';
    if (!clubs.length) { box.hidden = true; return; }

    var shown = clubs.slice(0, 3), extra = clubs.length - shown.length;
    txt.appendChild(document.createTextNode('We noticed you favorite '));
    var strong = document.createElement('strong');
    strong.textContent = shown.join(', ') + (extra > 0 ? ' +' + extra + ' more' : '');
    txt.appendChild(strong);
    txt.appendChild(document.createTextNode('. Would you like custom matchday alerts included in your weekly digest?'));
    box.hidden = false;
    box.querySelector('input').checked = true;
  }

  /* ---------- open / close ---------- */
  function open() {
    build();
    personalise();
    dlg.querySelector('[data-view="form"]').hidden = false;
    dlg.querySelector('[data-view="done"]').hidden = true;
    setStatus('');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    document.documentElement.classList.add('fs-nl-open');
    dlg.querySelector('#fs-nl-email').focus();
  }

  function setStatus(msg) { dlg.querySelector('[data-status]').textContent = msg; }
  function setBusy(b) {
    busy = b;
    var btn = form.querySelector('.fs-nl__submit');
    btn.disabled = b;
    btn.querySelector('[data-label]').textContent = b ? 'Subscribing…' : 'Subscribe';
  }

  /* ---------- submit ---------- */
  function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    var fd = new FormData(form);
    var favs = readFavs();
    var alertsBox = form.querySelector('input[name="alerts"]');
    var alerts = !!(alertsBox && !alertsBox.closest('[data-personal]').hidden && alertsBox.checked);

    // Favourites are only sent when the subscriber ticked the alerts box.
    var payload = {
      email: String(fd.get('email') || '').trim(),
      leagues: fd.getAll('league'),
      clubs: alerts ? namesOf(favs, 'club') : [],
      players: alerts ? namesOf(favs, 'player') : [],
      alerts: alerts,
      consent: !!fd.get('consent'),
      company: String(fd.get('company') || ''), // honeypot
      source: location.pathname
    };

    setStatus(''); setBusy(true);
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 12000);

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error((res.d && res.d.error) || 'failed');
        dlg.querySelector('[data-view="form"]').hidden = true;
        dlg.querySelector('[data-view="done"]').hidden = false;
        form.reset();
        dlg.querySelector('[data-done-title]').focus();
      })
      .catch(function (err) {
        var m = 'Something went wrong. Please try again in a moment.';
        if (err.name === 'AbortError') m = 'The request timed out. Please check your connection and try again.';
        else if (err.message === 'invalid_email') m = 'Please enter a valid email address.';
        setStatus(m);
      })
      .then(function () { clearTimeout(timer); setBusy(false); });
  }

  /* ---------- TRIGGERS ----------
     Preferred: add data-newsletter-open to any button/link.
     Fallback: any button/link whose text mentions "newsletter"
     is captured, so the old "unavailable" alert never fires. */
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('dialog.fs-nl')) return;
    var t = e.target.closest('[data-newsletter-open],.js-newsletter-open,a[href="#newsletter"]');
    if (!t) {
      var b = e.target.closest('button,a');
      if (b && /newsletter/i.test(b.textContent || '')) t = b;
    }
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  }, true);

  window.FS96Newsletter = { open: open };
})();
