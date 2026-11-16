/**
 * KLAIM UI — header tetap + entrance halaman form (Vercel).
 * Pemakaian: <script src="/assets/klaim-ui.js" data-title="Insentif Salesman"></script>
 */
(function () {
  var s = document.currentScript, title = (s && s.getAttribute('data-title')) || 'Form Klaim';
  var root = document.documentElement;
  root.classList.add('kx');
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('kx-enter');
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  document.addEventListener('DOMContentLoaded', function () {
    var h = document.createElement('header');
    h.className = 'kx-nav';
    h.innerHTML = '<div class="kx-nav__in">' +
      '<a class="kx-brand" href="/" aria-label="Portal Klaim Insentif — beranda"><span class="kx-mark" aria-hidden="true">H</span><span>Klaim Insentif</span></a>' +
      '<nav class="kx-crumb" aria-label="Lokasi halaman"><a class="kx-crumb__portal" href="/">Portal</a><span class="kx-sep" aria-hidden="true">/</span><span aria-current="page">' + esc(title) + '</span></nav>' +
      '<a class="kx-nav__cta" href="/" aria-label="Kembali ke semua program"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>Semua program</span></a>' +
      '</div>';
    document.body.insertBefore(h, document.body.firstChild);
    // entrance sekali, saat isi form pertama kali tampil (setelah pengaturan dimuat dari server)
    var app = document.getElementById('app');
    var done = function () { setTimeout(function () { root.classList.remove('kx-enter'); }, 900); };
    if (!app || app.querySelector('h1')) return done();
    var mo = new MutationObserver(function () { if (app.querySelector('h1')) { mo.disconnect(); done(); } });
    mo.observe(app, {childList: true});
    setTimeout(function () { mo.disconnect(); root.classList.remove('kx-enter'); }, 30000);
  });
})();
