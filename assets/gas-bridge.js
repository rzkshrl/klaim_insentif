/**
 * GAS BRIDGE — menjalankan form Apps Script di luar Google (mis. Vercel).
 * ----------------------------------------------------------------------
 * Form asli memanggil server lewat google.script.run.withSuccessHandler(..).withFailureHandler(..).namaFungsi(args).
 * File ini menyediakan objek google.script.run tiruan yang meneruskan panggilan tsb ke
 * Web App Apps Script (doPost) memakai fetch, sehingga kode form tidak perlu diubah.
 *
 * Pemakaian: <script src="/assets/config.js"></script>
 *            <script src="/assets/gas-bridge.js" data-app="sales"></script>
 */
(function () {
  var script = document.currentScript;
  var app = script && script.getAttribute('data-app');
  var cfg = window.KLAIM_CONFIG || {};
  var url = (cfg.api || {})[app] || '';
  var timeoutMs = cfg.timeoutMs || 180000;
  var configured = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url);

  function friendly(err) {
    var msg = String((err && err.message) || err || '');
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Tidak dapat terhubung ke server klaim. Periksa koneksi internet lalu coba lagi.';
    if (/aborted|AbortError/i.test(msg)) return 'Server terlalu lama merespons. Coba lagi beberapa saat lagi.';
    return msg || 'Terjadi kesalahan.';
  }

  function call(fn, args) {
    if (!configured) return Promise.reject(new Error('Alamat server untuk form ini belum diatur (assets/config.js → api.' + app + ').'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    return fetch(url, {
      method: 'POST',
      redirect: 'follow',
      // text/plain = "simple request" → tidak memicu CORS preflight yang tidak didukung Apps Script
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: JSON.stringify({fn: fn, args: args}),
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) throw new Error('Server error (' + res.status + ').');
      return res.text();
    }).then(function (text) {
      var data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error('Server tidak mengembalikan data. Pastikan Web App Apps Script sudah di-deploy versi terbaru dengan akses "Anyone".'); }
      if (!data || data.ok !== true) throw new Error((data && data.error) || 'Respons server tidak valid.');
      return data.data;
    }).catch(function (err) {
      throw new Error(friendly(err));
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function runner(onOk, onFail) {
    var api = {
      withSuccessHandler: function (f) { return runner(f, onFail); },
      withFailureHandler: function (f) { return runner(onOk, f); }
    };
    return new Proxy(api, {
      get: function (target, name) {
        if (name in target) return target[name];
        if (typeof name !== 'string') return undefined;
        return function () {
          var args = Array.prototype.slice.call(arguments);
          call(name, args).then(function (d) { if (onOk) onOk(d); }, function (e) { if (onFail) onFail(e); else console.error(e); });
        };
      }
    });
  }

  window.google = window.google || {};
  window.google.script = {run: runner(null, null)};

  // tautan kembali ke portal
  document.addEventListener('DOMContentLoaded', function () {
    var a = document.createElement('a');
    a.href = '/';
    a.textContent = '← Portal Klaim';
    a.style.cssText = 'display:inline-block;margin:0 0 14px;font:600 13px "Plus Jakarta Sans",system-ui,sans-serif;color:#0f5c4a;text-decoration:none';
    var wrap = document.querySelector('.wrap');
    if (wrap) wrap.insertBefore(a, wrap.firstChild);
  });
})();
