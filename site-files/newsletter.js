/* ==========================================================
   Football Stories 96 — Newsletter trigger
   Every "Subscribe" / newsletter button on the site now goes to
   the dedicated subscribe.html page instead of opening a popup.
   ========================================================== */
(function () {
  'use strict';

  function goToSubscribe() {
    location.href = 'subscribe.html';
  }

  /* TRIGGERS ----------
     Preferred: add data-newsletter-open to any button/link.
     Fallback: any button/link whose text mentions "newsletter"
     is captured too, so nothing silently does nothing. */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-newsletter-open],.js-newsletter-open,a[href="#newsletter"]');
    if (!t) {
      var b = e.target.closest('button,a');
      if (b && /newsletter/i.test(b.textContent || '')) t = b;
    }
    if (!t) return;
    e.preventDefault();
    e.stopPropagation();
    goToSubscribe();
  }, true);

  window.FS96Newsletter = { open: goToSubscribe };
})();
