/**
 * FORM KLAIM INSENTIF NOO OPAK — Google Apps Script
 * ------------------------------------------------------------------
 * Pasang di Google Sheet admin (Extensions > Apps Script), terpisah dari form klaim insentif salesman.
 * Alur: distributor submit (web app) → admin cek per outlet → Status "Diverifikasi" → PDF untuk finance.
 */

var SHEET = {data: 'Data Klaim', sales: 'Data Salesman', outlet: 'Data Outlet', set: 'Pengaturan', print: 'Cetak', log: 'Log Revisi'};
var TZ = 'Asia/Jakarta';
var STATUS = ['Baru', 'Diverifikasi', 'Disetujui', 'Dibayar', 'Ditolak'];
var VERIFIED = ['Diverifikasi', 'Disetujui', 'Dibayar'];
var PDF_PENDING = 'Menunggu PDF…', PDF_WAIT = 'Menunggu verifikasi';
var PDF_HANDLER = 'processPdfQueue', STATUS_HANDLER = 'onStatusEdit';
var EDIT_MARK = '#fff3c4';

var SETTINGS = [
  ['Insentif per outlet NOO (Rp)', 2000, 'perOutlet'],
  ['Minimal outlet NOO valid per salesman', 25, 'minOutlet'],
  ['Minimal pembelian BMX Opak per outlet di periode (karton / dus)', 1, 'minDus'],
  ['Konversi isi per dus khusus (KATA KUNCI=pcs per dus:renceng per dus; pisahkan ;)', '40PCS=40:4', 'packRules'],
  ['Outlet existing dihitung NOO jika tidak beli BMX Opak selama (bulan)', 3, 'lookback'],
  ['Periode tanpa syarat 3 bulan — bulan awal program (YYYY-MM, pisahkan koma)', "'2026-10", 'noLookback'],
  ['Batas rekening sendiri tanpa pajak (Rp)', 500000, 'ownThr'],
  ['Batas kumulatif titip rekening (Rp)', 5000000, 'titipThr'],
  ['Pajak titip rekening (%)', 2.5, 'titipRate'],
  ['Pajak rekening perusahaan (%)', 15, 'coRate'],
  ['Entitas penanggung insentif', 'CV Sumber Harum Utama (SHU)', 'entity'],
  ['Kata kunci produk BMX Opak (nama / kode barang, pisahkan koma)', 'OPAK', 'keywords'],
  ['Kode akses form (kosongkan jika tanpa kode)', '', 'code'],
  ['Form menerima klaim (YA / TIDAK)', 'YA', 'open'],
  ['ID folder PDF (terisi otomatis)', '', 'folderId'],
  ['ID folder file transaksi (terisi otomatis)', '', 'srcFolderId']
];

var DATA_HEAD = ['ID Klaim', 'Waktu Submit', 'Distributor', 'Area', 'Periode', 'Diajukan Oleh', 'Kontak', 'Jml Salesman',
  'Outlet Diajukan', 'Outlet Valid', 'Salesman Lolos', 'Insentif', 'Pajak', 'Diterima', 'Status', 'PDF', 'Catatan Admin', '_data', 'File Transaksi'];
var SALES_HEAD = ['ID Klaim', 'Periode', 'Distributor', 'Salesman', 'Outlet Diajukan', 'Outlet Valid', 'NOO Murni', 'Outlet Existing',
  'Memenuhi Min.', 'Insentif', 'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N', 'Pajak', 'Diterima'];
var OUTLET_HEAD = ['ID Klaim', 'Periode', 'Distributor', 'Salesman', 'Kode Outlet', 'Nama Outlet', 'Alamat / Nota', 'Tgl Transaksi NOO',
  'Jenis NOO', 'Tgl Beli BMX Opak Terakhir', 'Cek Sistem', 'Alasan Sistem', 'Valid Admin (YA/TIDAK)', 'Catatan Admin', 'Dihitung', 'Sumber'];
var LOG_HEAD = ['Waktu', 'ID Klaim', 'Admin', 'Salesman / Outlet', 'Kolom', 'Nilai Lama', 'Nilai Baru'];
var DATA_EDITABLE = ['Distributor', 'Area', 'Diajukan Oleh', 'Kontak'];
var SALES_EDITABLE = ['Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N'];
var OUTLET_EDITABLE = ['Kode Outlet', 'Nama Outlet', 'Alamat / Nota', 'Tgl Transaksi NOO', 'Jenis NOO', 'Tgl Beli BMX Opak Terakhir', 'Valid Admin (YA/TIDAK)', 'Catatan Admin'];

/* ===== LOGIKA NOO OPAK (dipakai sama persis di server & form) ===== */
var METHODS = {own:'Rekening sendiri', titip:'Titip 1 rekening', co:'Rekening perusahaan'};
var JENIS = {M:'NOO Murni', R:'Outlet Existing'};
var BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function periodeLabel(p) { var m = /^(\d{4})-(\d{2})$/.exec(p || ''); return m ? BULAN[+m[2] - 1] + ' ' + m[1] : String(p || ''); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
/** tanggal batas: pembelian terakhir harus SEBELUM tanggal ini (awal periode dikurangi N bulan) */
/** periode tanpa syarat N bulan (mis. bulan pertama program): pembelian sebelumnya tidak membatalkan NOO */
function isWaived(periode, S) { return String((S && S.noLookback) || '').split(',').map(function (x) { return x.trim(); }).indexOf(periode) >= 0; }
/** batas lookback efektif: '' bila periode dibebaskan */
function lookbackCut(periode, S) { return isWaived(periode, S) ? '' : cutoffDate(periode, Number(S.lookback) || 3); }
/** tanggal awal data yang dibutuhkan untuk periode ini */
function dataStartNeeded(periode, S) { return lookbackCut(periode, S) || periode + '-07'; }
function cutoffDate(periode, months) {
  var m = /^(\d{4})-(\d{2})$/.exec(periode || ''); if (!m) return '';
  var y = +m[1], mo = +m[2] - Number(months || 3);
  while (mo < 1) { mo += 12; y--; }
  return y + '-' + pad2(mo) + '-01';
}
/** normalisasi tanggal ke YYYY-MM-DD; terima 13/11/2026, 13-11-2026, 2026-11-13, Date */
function toISO(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  var s = String(v).trim(), m;
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s))) { var y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]); }
  return '';
}
function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function normJenis(v) { var s = String(v || '').trim().toUpperCase(); if (!s) return ''; if (s[0] === 'R' || s.indexOf('EXIST') >= 0 || s.indexOf('REAK') >= 0) return 'R'; if (s[0] === 'M' || s.indexOf('NOO') >= 0 || s.indexOf('BARU') >= 0) return 'M'; return ''; }
function normKode(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }

/**
 * Evaluasi seluruh outlet & hitung insentif.
 * input: {periode:'YYYY-MM', rows:[{name, pay:{m,bank,cab,an}, outlets:[{kode,nama,alamat,tgl,jenis,last,admin,prior}]}]}
 *   outlet.admin : 'YA' | 'TIDAK' | ''  (keputusan admin, mengalahkan cek sistem)
 *   outlet.prior : teks bila outlet sudah diklaim di klaim sebelumnya (diisi server)
 * S: {perOutlet, minOutlet, lookback, ownThr, titipThr, titipRate, coRate}
 */
function computeNoo(input, S) {
  var per = Number(S.perOutlet) || 0, min = Number(S.minOutlet) || 0, lb = Number(S.lookback) || 3;
  var cut = lookbackCut(input.periode, S), waived = !cut, seen = {};
  var rows = input.rows.map(function (r) {
    var o = {name: r.name, pay: r.pay || {m: 'own'}, outlets: [], submitted: 0, valid: 0, murni: 0, reakt: 0};
    (r.outlets || []).forEach(function (x) {
      var kode = normKode(x.kode), tgl = toISO(x.tgl), last = toISO(x.last), jenis = normJenis(x.jenis), why = [];
      if (!kode) why.push('Kode outlet kosong');
      if (!String(x.nama || '').trim()) why.push('Nama outlet kosong');
      if (!tgl) why.push('Tgl transaksi NOO kosong/tidak valid');
      else if (tgl.slice(0, 7) !== input.periode) why.push('Tgl transaksi di luar periode klaim');
      if (!jenis) why.push('Jenis NOO tidak valid');
      if (jenis === 'R' && !last && x.src !== 'auto' && !waived) why.push('Outlet existing wajib isi tgl pembelian BMX Opak terakhir');
      if (last && cut && last >= cut) why.push('Pembelian BMX Opak terakhir ' + fmtDate(last) + ' masih dalam ' + lb + ' bulan terakhir');
      if (last && tgl && last >= tgl) why.push('Tgl pembelian terakhir tidak boleh setelah tgl NOO');
      if (kode && seen[kode]) why.push('Duplikat dengan ' + seen[kode]);
      if (x.prior) why.push(x.prior);
      if (kode && !seen[kode]) seen[kode] = 'salesman ' + r.name;
      var sys = why.length === 0, adm = String(x.admin || '').toUpperCase();
      var ok = adm === 'YA' ? true : adm === 'TIDAK' ? false : sys;
      var e = {kode: kode, nama: String(x.nama || '').trim(), alamat: String(x.alamat || '').trim(), tgl: tgl, jenis: jenis, last: last,
        admin: adm === 'YA' || adm === 'TIDAK' ? adm : '', note: x.note || '', prior: x.prior || '', src: x.src === 'auto' ? 'auto' : 'manual', sys: sys, reason: why.join('; '), ok: ok};
      o.outlets.push(e);
      o.submitted++;
      if (ok) { o.valid++; if (jenis === 'R') o.reakt++; else o.murni++; }
    });
    o.eligible = o.valid >= min;
    o.incentive = o.eligible ? o.valid * per : 0;
    return o;
  });
  var list = rows.map(function (r, i) {
    var p = r.pay || {};
    return {i: i, name: r.name, m: METHODS[p.m] ? p.m : 'own', bank: p.bank || '', cab: p.cab || '', an: p.an || '', nom: r.incentive};
  }).filter(function (x) { return x.nom > 0; });
  var titipSum = list.filter(function (x) { return x.m === 'titip'; }).reduce(function (a, x) { return a + x.nom; }, 0);
  var titipOn = titipSum > 0 && titipSum >= Number(S.titipThr);
  var agg = {nom: 0, tax: 0, net: 0};
  list.forEach(function (x) {
    x.rate = x.m === 'co' ? Number(S.coRate) : x.m === 'titip' ? (titipOn ? Number(S.titipRate) : 0) : 0;
    x.tax = Math.round(x.nom * x.rate / 100);
    x.net = x.nom - x.tax;
    x.flag = x.m === 'own' && x.nom >= Number(S.ownThr);
    agg.nom += x.nom; agg.tax += x.tax; agg.net += x.net;
  });
  var t = rows.reduce(function (a, r) { a.sub += r.submitted; a.val += r.valid; a.elig += r.eligible ? 1 : 0; return a; }, {sub: 0, val: 0, elig: 0});
  return {rows: rows, cutoff: cut, pay: {list: list, titipSum: titipSum, titipOn: titipOn, nom: agg.nom, tax: agg.tax, net: agg.net},
    submitted: t.sub, valid: t.val, eligible: t.elig, total: agg.nom, totalNet: agg.net};
}


/* ===== KONVERSI SATUAN → DUS/KARTON ===== */
/** jenis satuan: 'dus' | 'pcs' | 'rcg' | '' (tidak dikenal). Kosong dianggap dus. */
function unitKind(u) {
  var s = String(u == null ? '' : u).trim().toUpperCase().replace(/[^A-Z]/g, '');
  if (!s) return 'dus';
  if (/^(DUS|DOS|DS|KRT|KARTON|CARTON|CTN|CT|KTN|BOX|BX)$/.test(s)) return 'dus';
  if (/^(PCS|PC|PCE|PIECE|BKS|BUNGKUS|SACHET|SCH|BIJI|BJ|EA)$/.test(s)) return 'pcs';
  if (/^(RCG|RENCENG|RENTENG|RC|RTG|RNC|STRIP|STR|PAK|PACK|PK)$/.test(s)) return 'rcg';
  return '';
}
/** isi per dus dari pengaturan khusus ("KATA=pcs:renceng; ...") atau dari nama barang (mis. 4X10 = 4 renceng × 10 pcs) */
function packOf(namaBarang, kodeBarang, S) {
  var n = String(namaBarang || '').toUpperCase(), k = String(kodeBarang || '').toUpperCase().trim();
  var rules = String((S && S.packRules) || '').split(';');
  for (var i = 0; i < rules.length; i++) {
    var m = /^\s*([^=]+?)\s*=\s*(\d+)\s*(?::\s*(\d+))?\s*$/.exec(rules[i]);
    if (m && (n.indexOf(m[1].toUpperCase()) >= 0 || k === m[1].toUpperCase())) return {pcs: +m[2], rcg: m[3] ? +m[3] : 0};
  }
  var x = /(\d+)\s*[X×]\s*(\d+)/.exec(n);
  if (x) return {pcs: +x[1] * +x[2], rcg: +x[1]};
  var p = /(\d+)\s*PCS/.exec(n);
  if (p) return {pcs: +p[1], rcg: 0};
  return {pcs: 0, rcg: 0};
}
/** qty dalam dus; null bila satuan / isi per dus tidak diketahui */
function toDus(qty, unit, namaBarang, kodeBarang, S) {
  var q = Number(qty) || 0, kind = unitKind(unit);
  if (kind === 'dus') return q;
  if (!kind) return null;
  var pk = packOf(namaBarang, kodeBarang, S), f = kind === 'pcs' ? pk.pcs : pk.rcg;
  return f > 0 ? q / f : null;
}
function fmtDus(x) { x = Math.round(Number(x || 0) * 100) / 100; return String(x).replace('.', ','); }

/* ===== DETEKSI NOO OTOMATIS DARI DATA TRANSAKSI ===== */
function isOpak(namaBarang, kodeBarang, keywords) {
  var n = String(namaBarang || '').toUpperCase(), k = String(kodeBarang || '').toUpperCase().trim();
  return String(keywords || 'OPAK').split(',').map(function (w) { return w.trim().toUpperCase(); }).filter(String)
    .some(function (w) { return n.indexOf(w) >= 0 || k === w; });
}
/**
 * data: {tx:[{d:'YYYY-MM-DD', k:kodeOutlet, n:namaOutlet, s:salesman, q:qty, no:nota}] (hanya transaksi BMX Opak),
 *        first:{kodeOutlet: tgl transaksi pertama produk apa pun}}
 * NOO = outlet yang membeli BMX Opak (qty bersih > 0) di periode dan TIDAK membeli BMX Opak dalam N bulan sebelumnya.
 *   NOO Murni      : transaksi pertama outlet (produk apa pun) terjadi di periode klaim
 *   Outlet Existing: sudah pernah bertransaksi sebelumnya
 * Salesman = salesman pada transaksi BMX Opak pertama di periode.
 */
function detectNoo(data, periode, S) {
  var lb = Number(S.lookback) || 3, cut = lookbackCut(periode, S), start = periode + '-01', by = {}, excluded = [];
  (data.tx || []).forEach(function (t) {
    var k = normKode(t.k); if (!k || !t.d) return;
    (by[k] = by[k] || {k: k, list: []}).list.push(t);
  });
  var sales = {};
  Object.keys(by).forEach(function (k) {
    var L = by[k].list, inP = L.filter(function (t) { return t.d.slice(0, 7) === periode; });
    if (!inP.length) return;
    var net = inP.reduce(function (a, t) { return a + (Number(t.q) || 0); }, 0), minD = Number(S.minDus) || 1;
    var pos = inP.filter(function (t) { return Number(t.q) > 0; }).sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : 0; });
    var nama = (pos[0] || inP[0]).n || '', sm = String((pos[0] || inP[0]).s || '').trim() || '(tanpa salesman)';
    if (net <= 0 || !pos.length) { excluded.push({kode: k, nama: nama, salesman: sm, reason: 'Qty bersih di periode ≤ 0 (retur)'}); return; }
    if (net < minD - 1e-9) { excluded.push({kode: k, nama: nama, salesman: sm, reason: 'Pembelian ' + fmtDus(net) + ' dus (< ' + fmtDus(minD) + ' karton)'}); return; }
    var prior = L.filter(function (t) { return t.d < start && Number(t.q) > 0; }).map(function (t) { return t.d; }).sort();
    var last = prior.length ? prior[prior.length - 1] : '';
    if (last && cut && last >= cut) { excluded.push({kode: k, nama: nama, salesman: sm, reason: 'Beli BMX Opak ' + fmtDate(last) + ' (dalam ' + lb + ' bulan terakhir)'}); return; }
    var f = (data.first || {})[k] || pos[0].d;
    (sales[sm] = sales[sm] || []).push({kode: k, nama: nama, alamat: 'Nota ' + String(pos[0].no || '-').trim() + ' · ' + fmtDus(net) + ' dus',
      tgl: pos[0].d, jenis: f >= start ? 'M' : 'R', last: last, src: 'auto'});
  });
  var rows = Object.keys(sales).sort().map(function (name) {
    return {name: name, outlets: sales[name].sort(function (a, b) { return a.tgl < b.tgl ? -1 : a.tgl > b.tgl ? 1 : 0; })};
  });
  return {rows: rows, excluded: excluded, cutoff: cut};
}
/* ===== akhir logika NOO ===== */


/* ===================== WEB APP ===================== */
function doGet(e) {
  if (e && e.parameter && e.parameter.fn === 'getPublicSettings') {
    try { return apiOut_({ok: true, data: getPublicSettings()}); } catch (err) { return apiOut_({ok: false, error: String(err.message || err)}); }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Form Klaim Insentif NOO Opak')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ===================== API JSON (untuk frontend di Vercel) =====================
 * Frontend memanggil: POST <url web app>  body (text/plain): {"fn":"submitKlaim","args":[payload]}
 * Balasan: {"ok":true,"data":...} atau {"ok":false,"error":"pesan"}.
 * Cek cepat di browser: <url web app>?fn=getPublicSettings
 */
function apiFuncs_() { return {getPublicSettings: getPublicSettings, submitKlaim: submitKlaim}; }
function apiCall_(fn, args) {
  var f = apiFuncs_()[fn];
  if (!f) throw new Error('Fungsi tidak dikenal: ' + fn);
  return f.apply(null, Array.isArray(args) ? args : []);
}
function apiOut_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return apiOut_({ok: true, data: apiCall_(req.fn, req.args)});
  } catch (err) {
    return apiOut_({ok: false, error: String((err && err.message) || err)});
  }
}

function getPublicSettings() {
  var S = getSettings_();
  // JSON round-trip: memastikan tidak ada nilai Date/objek yang gagal dikirim ke form
  return JSON.parse(JSON.stringify({perOutlet: S.perOutlet, minOutlet: S.minOutlet, lookback: S.lookback, ownThr: S.ownThr, titipThr: S.titipThr,
    titipRate: S.titipRate, coRate: S.coRate, entity: String(S.entity || ''), keywords: String(S.keywords || 'OPAK'), noLookback: S.noLookback, minDus: S.minDus || 1, packRules: S.packRules,
    needCode: !!String(S.code || '').trim(), open: isOpen_(S)}));
}

function submitKlaim(payload) {
  var S = getSettings_();
  if (!isOpen_(S)) throw new Error('Form sedang tidak menerima klaim. Hubungi admin.');
  var code = String(S.code || '').trim();
  if (code && String((payload && payload.code) || '').trim() !== code) throw new Error('Kode akses salah.');
  var input = sanitize_(payload);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    markPriorClaims_(ss, input, S);
    var claim = computeNoo(input, S);
    var now = new Date(), sh = ss.getSheetByName(SHEET.data), id = nextId_(sh, now);
    var rec = {id: id, submittedAt: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), head: headOf_(input), settings: pubSettings_(S),
      pays: input.rows.map(function (r) { return {name: r.name, pay: r.pay}; }), totals: totalsOf_(claim)};
    var fileCell = '';
    if (input.auto) {
      rec.source = {mode: 'auto', fileName: input.auto.fileName, dataMin: input.auto.dataMin, dataMax: input.auto.dataMax, opakRows: input.auto.opakRows, excluded: input.auto.excluded};
      try {
        var f = saveSourceFile_(id, input, payload.auto);
        if (f) { rec.source.fileUrl = f.getUrl(); fileCell = '=HYPERLINK("' + f.getUrl() + '","' + String(input.auto.fileName).replace(/"/g, '') + '")'; }
      } catch (e) { fileCell = 'Gagal simpan file: ' + e.message; }
    } else { rec.source = {mode: 'manual'}; fileCell = '(input manual)'; }
    sh.appendRow([id, now, cell_(input.distributor), cell_(input.area), periodeLabel(input.periode), cell_(input.pengaju), cell_(input.kontak),
      claim.rows.length, claim.submitted, claim.valid, claim.eligible, claim.total, claim.pay.tax, claim.totalNet, 'Baru',
      claim.pay.list.length ? PDF_WAIT : '— (tidak ada)', '', JSON.stringify(rec), fileCell]);
    writeSales_(ss, id, input, claim);
    writeOutlets_(ss, id, input, claim);
    SpreadsheetApp.flush();
    return {id: id, submitted: claim.submitted, valid: claim.valid, eligible: claim.eligible, total: claim.total, totalNet: claim.totalNet};
  } finally {
    lock.releaseLock();
  }
}

function writeSales_(ss, id, input, claim, rowNos) {
  var sh = ss.getSheetByName(SHEET.sales);
  var vals = claim.rows.map(function (r, j) {
    var p = findPay_(claim.pay.list, j), pay = r.pay || {};
    return [id, periodeLabel(input.periode), cell_(input.distributor), cell_(r.name), r.submitted, r.valid, r.murni, r.reakt,
      r.eligible ? 'YA' : 'TIDAK', r.incentive, METHODS[pay.m] || METHODS.own, cell_(pay.bank), cell_(pay.cab), cell_(pay.an),
      p ? p.tax : 0, p ? p.net : 0];
  });
  if (!vals.length) return;
  if (rowNos) vals.forEach(function (v, j) { sh.getRange(rowNos[j], 1, 1, v.length).setValues([v]).setBackground(null); });
  else sh.getRange(sh.getLastRow() + 1, 1, vals.length, SALES_HEAD.length).setValues(vals);
}

function writeOutlets_(ss, id, input, claim) {
  var sh = ss.getSheetByName(SHEET.outlet), vals = [];
  claim.rows.forEach(function (r) {
    r.outlets.forEach(function (o) {
      vals.push([id, periodeLabel(input.periode), cell_(input.distributor), cell_(r.name), cell_(o.kode), cell_(o.nama), cell_(o.alamat),
        o.tgl ? asDate_(o.tgl) : '', JENIS[o.jenis] || '', o.last ? asDate_(o.last) : '', o.sys ? 'Valid' : 'Tidak valid', o.reason,
        o.admin, cell_(o.note), o.ok ? 'YA' : 'TIDAK', o.src === 'auto' ? 'Data transaksi' : 'Manual']);
    });
  });
  if (vals.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, vals.length, OUTLET_HEAD.length).setValues(vals);
    paintOutlets_(sh, start, vals);
  }
}

function paintOutlets_(sh, start, vals) {
  var c = OUTLET_HEAD.indexOf('Dihitung');
  var bg = vals.map(function (v) { var row = []; for (var i = 0; i < OUTLET_HEAD.length; i++) row.push(v[c] === 'YA' ? null : '#fbe9e7'); return row; });
  sh.getRange(start, 1, vals.length, OUTLET_HEAD.length).setBackgrounds(bg);
}

/** tandai outlet yang sudah pernah dihitung di klaim lain (distributor sama, dalam rentang lookback) */
function markPriorClaims_(ss, input, S, excludeId) {
  var sh = ss.getSheetByName(SHEET.outlet);
  if (sh.getLastRow() < 2) return;
  var H = function (h) { return OUTLET_HEAD.indexOf(h); };
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, OUTLET_HEAD.length).getValues();
  var dist = normDist_(input.distributor), cut = lookbackCut(input.periode, S) || input.periode + '-01', endP = input.periode + '-31', map = {};
  var rejected = {}, dsh = ss.getSheetByName(SHEET.data), cS = DATA_HEAD.indexOf('Status');
  if (dsh.getLastRow() > 1) dsh.getRange(2, 1, dsh.getLastRow() - 1, cS + 1).getValues().forEach(function (d) { if (String(d[cS]).trim() === 'Ditolak') rejected[d[0]] = true; });
  vals.forEach(function (v) {
    if (v[H('ID Klaim')] === excludeId || rejected[v[H('ID Klaim')]] || v[H('Dihitung')] !== 'YA' || normDist_(v[H('Distributor')]) !== dist) return;
    var t = isoS_(v[H('Tgl Transaksi NOO')]);
    if (!t || t < cut || t > endP) return;
    map[normKode(v[H('Kode Outlet')])] = 'Sudah diklaim di ' + v[H('ID Klaim')] + ' (' + v[H('Periode')] + ')';
  });
  input.rows.forEach(function (r) { r.outlets.forEach(function (o) { o.prior = map[normKode(o.kode)] || ''; }); });
}

/* ===================== MODE UPLOAD DATA TRANSAKSI ===================== */
function sanitizeAuto_(p, out, rows) {
  var a = p.auto || {}, S = getSettings_();
  var tx = (Array.isArray(a.tx) ? a.tx : []).slice(0, 200000).map(function (t) {
    // hitung ulang konversi satuan → dus di server (qty asli + satuan dari file)
    var q = t.qr !== undefined ? toDus(t.qr, t.u, t.b, t.kb, S) : Number(t.q) || 0;
    return {d: toISO(t.d), k: str_(t.k, 40), n: str_(t.n, 80), s: str_(t.s, 80), q: q, no: str_(t.no, 40)};
  }).filter(function (t) { return t.d && t.k && t.q !== null; });
  var first = {};
  Object.keys(a.first || {}).slice(0, 200000).forEach(function (k) { var d = toISO(a.first[k]); if (d) first[normKode(k)] = d; });
  var dataMin = toISO(a.dataMin), dataMax = toISO(a.dataMax), cut = dataStartNeeded(out.periode, S);
  if (!dataMin || !dataMax) throw new Error('Rentang tanggal data transaksi tidak terbaca.');
  if (dataMin > cut) throw new Error('Data transaksi harus mencakup mulai ' + fmtDate(cut) + (isWaived(out.periode, S) ? '' : ' (' + S.lookback + ' bulan sebelum periode klaim)') + '. File Anda mulai ' + fmtDate(dataMin) + '.');
  if (dataMax < out.periode + '-01') throw new Error('Data transaksi belum mencakup periode ' + periodeLabel(out.periode) + '.');
  var det = detectNoo({tx: tx, first: first}, out.periode, S);
  if (!det.rows.length) throw new Error('Tidak ada outlet NOO BMX Opak yang terdeteksi di periode ' + periodeLabel(out.periode) + '.');
  var payBy = {};
  rows.forEach(function (r) {
    if (!r || !r.name) return;
    var pay = r.pay || {};
    payBy[str_(r.name, 80)] = {m: METHODS[pay.m] ? pay.m : 'own', bank: str_(pay.bank, 80), cab: str_(pay.cab, 60), an: str_(pay.an, 80)};
  });
  out.rows = det.rows.map(function (r) { return {name: str_(r.name, 80), pay: payBy[str_(r.name, 80)] || {m: 'own', bank: '', cab: '', an: ''}, outlets: r.outlets}; });
  out.auto = {fileName: str_(a.fileName, 120) || 'data-transaksi.xlsx', dataMin: dataMin, dataMax: dataMax, opakRows: tx.length,
    excluded: det.excluded.slice(0, 300)};
  return out;
}

function saveSourceFile_(id, input, a) {
  if (!a || !a.fileB64) return null;
  if (String(a.fileB64).length > 20 * 1024 * 1024) throw new Error('file terlalu besar untuk disimpan');
  var S = getSettings_(), folder = null, fid = String(S.srcFolderId || '').trim();
  if (fid) { try { folder = DriveApp.getFolderById(fid); } catch (e) {} }
  if (!folder) { folder = DriveApp.createFolder('Klaim NOO Opak - File Transaksi'); setSetting_('srcFolderId', folder.getId()); }
  var name = (id + ' - ' + input.distributor + ' - ' + input.auto.fileName).replace(/[\\\/:*?"<>|]/g, ' ');
  var blob = Utilities.newBlob(Utilities.base64Decode(String(a.fileB64)), MimeType.MICROSOFT_EXCEL, name);
  return folder.createFile(blob);
}

/* ===================== MENU ADMIN ===================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Klaim NOO Opak')
    .addItem('Tampilkan klaim terpilih di sheet Cetak', 'printSelected')
    .addItem('Hitung ulang klaim terpilih (setelah edit data)', 'recalcSelected')
    .addItem('Buat ulang PDF klaim terpilih', 'regenPdfSelected')
    .addSeparator()
    .addItem('Setup / perbaiki struktur sheet', 'setup')
    .addToUi();
}

function printSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  var sh = ss.getSheetByName(SHEET.print) || ss.insertSheet(SHEET.print);
  renderPrint_(sh, loadClaim_(ss, id));
  ss.setActiveSheet(sh);
  note_('Klaim ' + id + ' siap di sheet Cetak. File > Print: Current sheet, Landscape, Fit to width.');
}

async function regenPdfSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  var row = findDataRow_(ss, id);
  if (!isVerifiedRow_(ss, row)) { note_('Klaim ' + id + ' belum diverifikasi. Ubah Status menjadi "Diverifikasi" — PDF dibuat otomatis.'); return; }
  await writePdfLink_(ss, row, id);
  note_('PDF klaim ' + id + ' sudah dibuat ulang.');
}

function recalcSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  note_('Menghitung ulang ' + id + '…');
  try {
    var r = recalcClaim_(ss, id);
    note_(id + ' dihitung ulang. Outlet valid ' + r.validBefore + ' → ' + r.valid + ', insentif ' + fmtNum_(r.before) + ' → ' + fmtNum_(r.after) +
      '.' + (isVerifiedRow_(ss, findDataRow_(ss, id)) ? ' PDF diperbarui.' : ' PDF dibuat setelah status Diverifikasi.'));
  } catch (e) {
    note_('Gagal menghitung ulang ' + id + ': ' + e.message);
  }
}

function selectedId_(ss) {
  var sh = ss.getActiveSheet();
  if ([SHEET.data, SHEET.sales, SHEET.outlet].indexOf(sh.getName()) < 0) { note_('Buka sheet Data Klaim / Data Salesman / Data Outlet, lalu klik baris klaimnya.'); return ''; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { note_('Klik baris klaim (bukan baris judul).'); return ''; }
  var id = String(sh.getRange(row, 1).getValue()).trim();
  if (!id) note_('Baris ini tidak memiliki ID Klaim.');
  return id;
}

/* ===================== MUAT & HITUNG ULANG DARI SHEET ===================== */
/** bangun ulang klaim dari sheet (sumber kebenaran setelah dikoreksi admin) */
function loadClaim_(ss, id) {
  var dsh = ss.getSheetByName(SHEET.data), row = findDataRow_(ss, id);
  if (!row) throw new Error('ID ' + id + ' tidak ditemukan.');
  var d = dsh.getRange(row, 1, 1, DATA_HEAD.length).getValues()[0], D = function (h) { return DATA_HEAD.indexOf(h); };
  var rec = JSON.parse(d[D('_data')]);
  var sales = rowsFor_(ss.getSheetByName(SHEET.sales), SALES_HEAD, id);
  var outs = rowsFor_(ss.getSheetByName(SHEET.outlet), OUTLET_HEAD, id);
  var S = function (h) { return SALES_HEAD.indexOf(h); }, O = function (h) { return OUTLET_HEAD.indexOf(h); };
  var inv = {}; Object.keys(METHODS).forEach(function (k) { inv[METHODS[k]] = k; });
  var jinv = {}; Object.keys(JENIS).forEach(function (k) { jinv[JENIS[k]] = k; });
  var rows = sales.map(function (s) {
    var v = s.v, name = String(v[S('Salesman')]).trim();
    return {name: name, pay: {m: inv[String(v[S('Metode Bayar')]).trim()] || 'own', bank: str_(v[S('Bank / No. Rek')], 80), cab: str_(v[S('Cabang')], 60), an: str_(v[S('A/N')], 80)},
      outlets: outs.filter(function (o) { return String(o.v[O('Salesman')]).trim() === name; }).map(function (o) {
        var x = o.v, j = String(x[O('Jenis NOO')]).trim();
        return {kode: str_(x[O('Kode Outlet')], 40), nama: str_(x[O('Nama Outlet')], 80), alamat: str_(x[O('Alamat / Nota')], 120),
          src: String(x[O('Sumber')]).indexOf('transaksi') >= 0 ? 'auto' : 'manual',
          tgl: isoS_(x[O('Tgl Transaksi NOO')]), jenis: jinv[j] || normJenis(j), last: isoS_(x[O('Tgl Beli BMX Opak Terakhir')]),
          admin: String(x[O('Valid Admin (YA/TIDAK)')]).trim().toUpperCase(), note: str_(x[O('Catatan Admin')], 200), _row: o.row};
      }), _row: s.row};
  });
  var input = {distributor: str_(d[D('Distributor')]), area: str_(d[D('Area')], 60), periode: rec.head.periode,
    pengaju: str_(d[D('Diajukan Oleh')], 80), kontak: str_(d[D('Kontak')], 60), rows: rows};
  markPriorClaims_(ss, input, rec.settings, id);
  return {id: id, row: row, rec: rec, input: input, claim: computeNoo(input, rec.settings)};
}

function recalcClaim_(ss, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var L;
  try {
    L = loadClaim_(ss, id);
    var rec = L.rec, claim = L.claim, input = L.input, now = new Date(), who = userEmail_();
    var before = rec.totals.total, validBefore = rec.totals.valid;
    var logs = [];
    ['distributor', 'area', 'pengaju', 'kontak'].forEach(function (k) { if (String(rec.head[k] || '') !== String(input[k] || '')) logs.push([now, id, who, '(klaim)', k, cell_(rec.head[k]), cell_(input[k])]); });
    rec.pays.forEach(function (p, j) {
      var n = input.rows[j]; if (!n) return;
      ['m', 'bank', 'cab', 'an'].forEach(function (k) { var a = (p.pay || {})[k] || '', b = n.pay[k] || ''; if (a !== b) logs.push([now, id, who, cell_(n.name), 'Bayar: ' + k, cell_(a), cell_(b)]); });
    });
    logs.push([now, id, who, '(klaim)', 'Outlet valid', validBefore, claim.valid]);
    logs.push([now, id, who, '(klaim)', 'Total insentif', before, claim.total]);

    if (!rec.original) rec.original = {head: rec.head, totals: rec.totals};
    rec.head = headOf_(input); rec.pays = input.rows.map(function (r) { return {name: r.name, pay: r.pay}; }); rec.totals = totalsOf_(claim);
    rec.revisions = (rec.revisions || []).concat([{at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), by: who}]);

    // Data Outlet: hasil cek sistem + dihitung
    var osh = ss.getSheetByName(SHEET.outlet), O = function (h) { return OUTLET_HEAD.indexOf(h) + 1; };
    claim.rows.forEach(function (r, j) {
      r.outlets.forEach(function (o, k) {
        var rowNo = input.rows[j].outlets[k]._row;
        osh.getRange(rowNo, O('Kode Outlet')).setValue(cell_(o.kode));
        osh.getRange(rowNo, O('Cek Sistem'), 1, 2).setValues([[o.sys ? 'Valid' : 'Tidak valid', o.reason]]);
        osh.getRange(rowNo, O('Dihitung')).setValue(o.ok ? 'YA' : 'TIDAK');
        osh.getRange(rowNo, 1, 1, OUTLET_HEAD.length).setBackground(o.ok ? null : '#fbe9e7');
      });
    });
    writeSales_(ss, id, input, claim, input.rows.map(function (r) { return r._row; }));

    var dsh = ss.getSheetByName(SHEET.data), D = function (h) { return DATA_HEAD.indexOf(h) + 1; };
    dsh.getRange(L.row, D('Jml Salesman'), 1, 7).setValues([[claim.rows.length, claim.submitted, claim.valid, claim.eligible, claim.total, claim.pay.tax, claim.totalNet]]);
    dsh.getRange(L.row, 1, 1, DATA_HEAD.length - 1).setBackground(null);
    var nc = dsh.getRange(L.row, D('Catatan Admin'));
    var old = String(nc.getValue() || '').replace(/\s*\[Revisi ke-\d+ \([^)]*\)\]$/, '');
    nc.setValue((old ? old + ' ' : '') + '[Revisi ke-' + rec.revisions.length + ' (' + rec.revisions[rec.revisions.length - 1].at + ')]');
    if (!isVerifiedRow_(ss, L.row)) dsh.getRange(L.row, D('PDF')).setValue(claim.pay.list.length ? PDF_WAIT : '— (tidak ada)');
    dsh.getRange(L.row, D('_data')).setValue(JSON.stringify(rec));
    var lsh = ss.getSheetByName(SHEET.log);
    lsh.getRange(lsh.getLastRow() + 1, 1, logs.length, LOG_HEAD.length).setValues(logs);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (isVerifiedRow_(ss, L.row)) writePdfLink_(ss, L.row, id);
  return {before: before, after: L.claim.total, validBefore: validBefore, valid: L.claim.valid};
}

function rowsFor_(sh, head, id) {
  if (sh.getLastRow() < 2) return [];
  var out = [];
  sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues().forEach(function (v, i) { if (String(v[0]) === id) out.push({row: i + 2, v: v}); });
  return out;
}

/* ===================== VERIFIKASI → PDF ===================== */
function onEdit(e) {
  try {
    var sh = e.range.getSheet(), name = sh.getName();
    if (e.range.getRow() < 2) return;
    var map = {}; map[SHEET.data] = [DATA_HEAD, DATA_EDITABLE]; map[SHEET.sales] = [SALES_HEAD, SALES_EDITABLE]; map[SHEET.outlet] = [OUTLET_HEAD, OUTLET_EDITABLE];
    var m = map[name]; if (!m) return;
    if (m[1].indexOf(m[0][e.range.getColumn() - 1]) < 0) return;
    e.range.setBackground(EDIT_MARK);
    e.source.toast('Klik baris ini lalu menu Klaim NOO Opak > Hitung ulang klaim terpilih agar jumlah outlet, insentif & PDF ikut berubah.', 'Data diubah', 8);
  } catch (err) {}
}

function onStatusEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET.data) return;
    var c = DATA_HEAD.indexOf('Status') + 1;
    if (e.range.getColumn() > c || e.range.getLastColumn() < c) return;
    var r0 = Math.max(e.range.getRow(), 2), r1 = e.range.getLastRow();
    for (var r = r0; r <= r1; r++) handleStatus_(e.source, r, r1 === r0 ? e.oldValue : '');
  } catch (err) {
    e.source.toast('Gagal memproses status: ' + err.message, 'Klaim NOO Opak', 10);
  }
}

function handleStatus_(ss, row, oldValue) {
  var sh = ss.getSheetByName(SHEET.data), D = function (h) { return DATA_HEAD.indexOf(h) + 1; };
  var status = String(sh.getRange(row, D('Status')).getValue()).trim(), id = String(sh.getRange(row, 1).getValue());
  var rec; try { rec = JSON.parse(sh.getRange(row, D('_data')).getValue()); } catch (e) { return; }
  var now = new Date(), who = userEmail_(), cell = sh.getRange(row, D('PDF'));
  ss.getSheetByName(SHEET.log).appendRow([now, id, who, '(klaim)', 'Status', oldValue || '', status]);
  if (VERIFIED.indexOf(status) >= 0) {
    if (!rec.verified) { rec.verified = {by: who, at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), status: status}; sh.getRange(row, D('_data')).setValue(JSON.stringify(rec)); }
    if (rec.totals.total > 0 && !/^=HYPERLINK/i.test(cell.getFormula())) {
      cell.setValue(PDF_PENDING);
      ss.toast('Klaim ' + id + ' diverifikasi. PDF sedang dibuat…', 'Klaim NOO Opak', 8);
      SpreadsheetApp.flush();
      processPdfQueue();
    }
  } else {
    var pulled = trashPdf_(cell);
    cell.setValue(rec.totals.total > 0 ? PDF_WAIT : '— (tidak ada)');
    if (rec.verified) { delete rec.verified; sh.getRange(row, D('_data')).setValue(JSON.stringify(rec)); }
    if (pulled) ss.toast('Status ' + id + ' menjadi "' + status + '". PDF ditarik ke Trash.', 'Klaim NOO Opak', 8);
  }
}

async function processPdfQueue() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === PDF_HANDLER) ScriptApp.deleteTrigger(t); });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(60 * 1000).create(); return; }
  var started = Date.now(), leftover = false, ss = SpreadsheetApp.getActiveSpreadsheet(), todo = [];
  try {
    var sh = ss.getSheetByName(SHEET.data);
    if (sh.getLastRow() < 2) return;
    var cP = DATA_HEAD.indexOf('PDF');
    sh.getRange(2, 1, sh.getLastRow() - 1, DATA_HEAD.length).getValues().forEach(function (v, i) { if (v[cP] === PDF_PENDING) todo.push({row: i + 2, id: String(v[0])}); });
  } finally {
    lock.releaseLock();
  }
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - started > 4 * 60 * 1000) { leftover = true; break; }
    await writePdfLink_(ss, todo[i].row, todo[i].id);
    SpreadsheetApp.flush();
  }
  if (leftover) ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(30 * 1000).create();
}

async function writePdfLink_(ss, row, id) {
  var cell = ss.getSheetByName(SHEET.data).getRange(row, DATA_HEAD.indexOf('PDF') + 1);
  trashPdf_(cell);
  try {
    var L = loadClaim_(ss, id);
    if (!L.claim.pay.list.length) { cell.setValue('— (tidak ada)'); return; }
    var file = await makePdf_(ss, L);
    cell.setFormula('=HYPERLINK("' + file.getUrl() + '","PDF Klaim")');
  } catch (e) {
    cell.setValue('Gagal: ' + e.message + ' (pakai menu Buat ulang PDF)');
  }
}

async function makePdf_(ss, L) {
  // Lembar klaim diekspor landscape, lampiran outlet diekspor portrait, lalu digabung jadi satu PDF (PdfLib.gs).
  var stamp = Date.now(), main = ss.insertSheet('tmp_' + L.id + '_' + stamp), lamp = null;
  try {
    lamp = ss.insertSheet('tmpL_' + L.id + '_' + stamp);
    var size = renderPrint_(main, L, {lampSheet: lamp});
    SpreadsheetApp.flush();
    var parts = [exportPdf_(ss, main, size.rows, size.cols, false)];
    if (size.lampRows) parts.push(exportPdf_(ss, lamp, size.lampRows, size.cols, true));
    var blob = parts.length > 1 ? await mergePdf_(parts) : parts[0];
    var name = L.id + ' - NOO Opak - ' + L.input.distributor + ' - ' + periodeLabel(L.input.periode);
    return pdfFolder_().createFile(blob.setName(name.replace(/[\\\/:*?"<>|]/g, ' ') + '.pdf'));
  } finally {
    ss.deleteSheet(main);
    if (lamp) ss.deleteSheet(lamp);
  }
}

function exportPdf_(ss, sheet, rows, cols, portrait) {
  var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + sheet.getSheetId() +
    '&size=A4&portrait=' + (portrait ? 'true' : 'false') + '&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER' +
    '&fzr=false&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4' +
    '&r1=0&c1=0&r2=' + rows + '&c2=' + cols;
  var resp, tries = 0;
  do {
    resp = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
    if (resp.getResponseCode() === 429) Utilities.sleep(3000 * (tries + 1));
  } while (resp.getResponseCode() === 429 && ++tries < 3);
  if (resp.getResponseCode() !== 200) throw new Error('export PDF ' + resp.getResponseCode());
  return resp.getBlob();
}

async function mergePdf_(blobs) {
  if (typeof loadPdfLib_ !== 'function') throw new Error('file script PdfLib belum ditambahkan ke project Apps Script');
  var P = loadPdfLib_(), doc = await P.PDFDocument.create();
  for (var i = 0; i < blobs.length; i++) {
    var src = await P.PDFDocument.load(new Uint8Array(blobs[i].getBytes()));
    var pages = await doc.copyPages(src, src.getPageIndices());
    pages.forEach(function (pg) { doc.addPage(pg); });
  }
  var out = await doc.save();
  return Utilities.newBlob(Array.from(new Int8Array(out)), 'application/pdf', 'klaim.pdf');
}

function pdfFolder_() {
  var id = String(getSettings_().folderId || '').trim();
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('Klaim NOO Opak - PDF');
  setSetting_('folderId', folder.getId());
  return folder;
}

function trashPdf_(cell) {
  var m = String(cell.getFormula() || '').match(/\/d\/([\w-]{20,})/);
  if (!m) return false;
  try { DriveApp.getFileById(m[1]).setTrashed(true); return true; } catch (e) { return false; }
}

/* ===================== TEMPLATE CETAK (A4 portrait) ===================== */
function renderPrint_(sh, L, opt) {
  var C = L.claim, I = L.input, rec = L.rec, S = rec.settings, N = 8;
  var green = '#0f5c4a', soft = '#e8f2ee', grey = '#f3f4f2', border = '#9aa09c';
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  if (sh.getMaxColumns() < N) sh.insertColumnsAfter(sh.getMaxColumns(), N - sh.getMaxColumns());
  if (sh.getMaxColumns() > N) sh.deleteColumns(N + 1, sh.getMaxColumns() - N);
  var outletCount = C.rows.reduce(function (a, r) { return a + r.outlets.length; }, 0);
  var need = 60 + C.rows.length * 2 + outletCount;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.setHiddenGridlines(true);
  var LAMPW = [32, 140, 95, 170, 78, 80, 80, 150];               // lampiran (portrait)
  var BASEW = [32, 140, 95, 150, 78, 80, 80, 150].map(function (x) { return Math.round(x * 1.35); }); // lembar klaim (landscape)
  BASEW.forEach(function (x, i) { sh.setColumnWidth(i + 1, x); });

  var r = 1;
  var put = function (row, c1, c2, val) { if (typeof val === 'string') val = cell_(val); var rg = sh.getRange(row, c1, 1, c2 - c1 + 1); if (c2 > c1) rg.merge(); rg.setValue(val); return rg; };
  var box = function (r1, r2) { sh.getRange(r1, 1, r2 - r1 + 1, N).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID); };

  put(r++, 1, N, 'KLAIM INSENTIF NOO BMX OPAK').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center').setFontColor(green);
  put(r++, 1, N, S.entity).setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
  if (!rec.verified) put(r, 1, N, 'DRAFT — BELUM DIVERIFIKASI ADMIN · TIDAK UNTUK PEMBAYARAN').setFontWeight('bold').setFontColor('#b3261e').setHorizontalAlignment('center');
  sh.getRange(r, 1, 1, N).setBorder(null, null, true, null, null, null, green, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  r += 2;

  var info = [['No. Klaim', L.id, 'Periode', periodeLabel(I.periode)],
              ['Distributor', I.distributor, 'Diajukan oleh', I.pengaju + (I.kontak ? ' (' + I.kontak + ')' : '')],
              ['Area', I.area || '-', 'Tanggal submit', rec.submittedAt]];
  if (rec.revisions && rec.revisions.length) info.push(['Status data', 'Dikoreksi admin (revisi ke-' + rec.revisions.length + ', ' + rec.revisions[rec.revisions.length - 1].at + ')', 'Total awal', 'Rp ' + fmtNum_(rec.original ? rec.original.totals.total : 0)]);
  if (rec.verified) info.push(['Diverifikasi', (rec.verified.by || 'admin') + ' · ' + rec.verified.at, 'Status', rec.verified.status]);
  info.forEach(function (x) {
    put(r, 1, 2, x[0]).setFontWeight('bold'); put(r, 3, 4, ': ' + x[1]);
    put(r, 5, 6, x[2]).setFontWeight('bold'); put(r, 7, 8, ': ' + x[3]); r++;
  });
  r++;

  // A. Rekap per salesman
  put(r++, 1, N, 'A. REKAP NOO PER SALESMAN').setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var h = r;
  sh.getRange(r, 1, 1, N).setValues([['No', 'Salesman', 'Outlet Diajukan', 'Outlet Valid', 'NOO Murni', 'Existing', 'Min. ' + S.minOutlet, 'Insentif (Rp)']])
    .setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setWrap(true);
  r++;
  var rows = C.rows.map(function (x, i) { return [i + 1, cell_(x.name), x.submitted, x.valid, x.murni, x.reakt, x.eligible ? 'Memenuhi' : 'Tidak', x.incentive]; });
  if (rows.length) { sh.getRange(r, 1, rows.length, N).setValues(rows); sh.getRange(r, 3, rows.length, 6).setHorizontalAlignment('center'); sh.getRange(r, 8, rows.length, 1).setNumberFormat('#,##0'); r += rows.length; }
  sh.getRange(r, 1, 1, N).setValues([['', 'TOTAL', C.submitted, C.valid, '', '', C.eligible + ' lolos', C.total]]).setFontWeight('bold').setBackground(grey);
  sh.getRange(r, 3, 1, 5).setHorizontalAlignment('center'); sh.getRange(r, 8).setNumberFormat('#,##0');
  box(h, r); r += 2;

  // B. Pembayaran
  put(r++, 1, N, 'B. RINCIAN PEMBAYARAN INSENTIF').setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var ph = r;
  sh.getRange(r, 1, 1, N).setValues([['No', 'Penerima', 'Metode', 'Bank / No. Rek', 'Cabang / A/N', 'Nominal', 'Pajak', 'Diterima']])
    .setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setWrap(true);
  r++;
  var P = C.pay, pf = r;
  P.list.forEach(function (x, j) {
    sh.getRange(r++, 1, 1, N).setValues([[j + 1, cell_(x.name), METHODS[x.m] + (x.rate ? ' (' + String(x.rate).replace('.', ',') + '%)' : ''), cell_(x.bank),
      cell_([x.cab, x.an].filter(String).join(' / ')), x.nom, x.tax, x.net]]);
  });
  if (!P.list.length) { put(r++, 1, N, 'Tidak ada salesman yang memenuhi minimal ' + S.minOutlet + ' outlet NOO valid.').setFontStyle('italic'); }
  sh.getRange(r, 1, 1, N).setValues([['', 'TOTAL', '', '', '', P.nom, P.tax, P.net]]).setFontWeight('bold').setBackground(grey);
  sh.getRange(pf, 6, r - pf + 1, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(pf, 1, r - pf + 1, 1).setHorizontalAlignment('center');
  box(ph, r); var payEnd = r; r++;
  put(r, 1, N, 'Terbilang: ' + terbilang_(P.net) + ' rupiah').setFontStyle('italic').setFontWeight('bold');
  r += 2;

  var notes = ['Catatan perhitungan:',
    '• Insentif Rp ' + fmtNum_(S.perOutlet) + ' per outlet NOO valid, hanya untuk salesman dengan minimal ' + S.minOutlet + ' outlet NOO valid dalam periode.',
    (C.cutoff ? '• NOO valid: NOO murni, atau outlet existing yang tidak membeli BMX Opak sejak ' + fmtDate(C.cutoff) + ' (di luar ' + S.lookback + ' bulan terakhir periode klaim).'
      : '• Periode awal program: semua outlet yang membeli BMX Opak di ' + periodeLabel(I.periode) + ' dihitung NOO, tanpa syarat ' + S.lookback + ' bulan tidak membeli sebelumnya.'),
    '• Outlet dihitung bila pembelian BMX Opak bersih di periode minimal ' + fmtDus(S.minDus || 1) + ' karton (qty PCS / renceng dikonversi ke dus).',
    '• Sumber data: ' + (rec.source && rec.source.mode === 'auto' ? 'deteksi otomatis dari data transaksi distributor (' + rec.source.fileName + ', ' + fmtDate(rec.source.dataMin) + ' – ' + fmtDate(rec.source.dataMax) + ').' : 'input manual distributor.'),
    '• Pajak: rekening sendiri < Rp ' + fmtNum_(S.ownThr) + ' = 0%; titip 1 rekening kumulatif ≥ Rp ' + fmtNum_(S.titipThr) + ' = ' + String(S.titipRate).replace('.', ',') + '% per orang; rekening perusahaan = ' + String(S.coRate).replace('.', ',') + '%.',
    '• Rincian outlet terlampir (Lampiran).'];
  notes.forEach(function (t, j) { put(r++, 1, N, t).setFontSize(8).setFontColor('#555555').setWrap(true).setFontWeight(j ? 'normal' : 'bold'); });
  r++;

  var sig = [[1, 3, 'Diperiksa oleh,', 'Data Analyst'], [4, 5, 'Disetujui oleh,', 'Head of Sales'], [6, 8, 'Diterima oleh,', 'Finance']];
  sig.forEach(function (s) {
    put(r, s[0], s[1], s[2]).setHorizontalAlignment('center');
    put(r + 5, s[0], s[1], '(______________________________)').setHorizontalAlignment('center');
    put(r + 6, s[0], s[1], s[3]).setHorizontalAlignment('center').setFontWeight('bold');
  });
  for (var sr = r + 1; sr <= r + 4; sr++) sh.setRowHeight(sr, 24); // ruang tanda tangan lebih lega
  r += 8;

  // Lampiran outlet — di sheet terpisah (halaman baru di PDF) bila opt.lampSheet diberikan
  var LS = (opt && opt.lampSheet) || sh, sep = LS !== sh, mainRows = r - 2;
  var lput = function (row, c1, c2, val) { if (typeof val === 'string') val = cell_(val); var rg = LS.getRange(row, c1, 1, c2 - c1 + 1); if (c2 > c1) rg.merge(); rg.setValue(val); return rg; };
  var lbox = function (r1, r2) { LS.getRange(r1, 1, r2 - r1 + 1, N).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID); };
  if (sep) {
    if (LS.getMaxColumns() > N) LS.deleteColumns(N + 1, LS.getMaxColumns() - N);
    if (LS.getMaxRows() < outletCount + 10) LS.insertRowsAfter(LS.getMaxRows(), outletCount + 10 - LS.getMaxRows());
    LS.setHiddenGridlines(true);
    r = 1;
    lput(r++, 1, N, 'LAMPIRAN — DAFTAR OUTLET NOO').setFontSize(13).setFontWeight('bold').setHorizontalAlignment('center').setFontColor(green);
    lput(r++, 1, N, 'No. Klaim ' + L.id + ' · ' + I.distributor + ' · ' + periodeLabel(I.periode)).setHorizontalAlignment('center').setFontWeight('bold');
    r++;
  }
  var lstart = r;
  lput(r++, 1, N, sep ? 'RINCIAN OUTLET NOO PER SALESMAN' : 'LAMPIRAN — DAFTAR OUTLET NOO (' + L.id + ')').setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var lh = r;
  LS.getRange(r, 1, 1, N).setValues([['No', 'Salesman', 'Kode Outlet', 'Nama Outlet', 'Tgl NOO', 'Jenis', 'Beli Terakhir', 'Keterangan']])
    .setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center');
  r++;
  var lr = [], n = 0, bad = [];
  C.rows.forEach(function (x) {
    x.outlets.forEach(function (o) {
      n++;
      lr.push([n, cell_(x.name), cell_(o.kode), cell_(o.nama), fmtDate(o.tgl), JENIS[o.jenis] || '-', fmtDate(o.last) || '-',
        o.ok ? (o.admin === 'YA' && !o.sys ? 'Valid (disetujui admin)' : 'Valid') : 'TIDAK DIHITUNG: ' + (o.admin === 'TIDAK' ? (o.note || 'ditolak admin') : o.reason)]);
      if (!o.ok) bad.push(r + lr.length - 1);
    });
  });
  if (lr.length) {
    LS.getRange(r, 1, lr.length, N).setValues(lr).setFontSize(8).setVerticalAlignment('top');
    LS.getRange(r, 8, lr.length, 1).setWrap(true);
    LS.getRange(r, 1, lr.length, 1).setHorizontalAlignment('center');
    LS.getRange(r, 5, lr.length, 3).setHorizontalAlignment('center');
    bad.forEach(function (b) { LS.getRange(b, 1, 1, N).setFontColor('#b3261e'); });
    r += lr.length;
  }
  lbox(lh, r - 1);
  var W = autoWidths_(sh, ph + 1, payEnd, N, BASEW);
  if (sep) {
    LAMPW.forEach(function (x, j) { LS.setColumnWidth(j + 1, x); });
    LS.getRange(1, 1, r, N).setFontFamily('Arial');
    sh.getRange(1, 1, mainRows, N).setFontFamily('Arial');
    return {rows: mainRows, cols: N, lampRows: lr.length ? r - 1 : 0};
  }
  sh.getRange(1, 1, r, N).setFontFamily('Arial');
  return {rows: r, cols: N, lampRows: lr.length};
}

/* ===================== SETUP ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === STATUS_HANDLER; });
  if (!has) ScriptApp.newTrigger(STATUS_HANDLER).forSpreadsheet(ss).onEdit().create();
  try { onOpen(); } catch (e) {}
  ss.toast('Struktur sheet siap. Lanjutkan Deploy > New deployment > Web app.', 'Klaim NOO Opak', 8);
}

function ensureSheets_(ss) {
  var set = ss.getSheetByName(SHEET.set);
  if (!set) {
    set = ss.insertSheet(SHEET.set);
    set.getRange(1, 1, 1, 3).setValues([['Pengaturan', 'Nilai', 'key']]).setFontWeight('bold').setBackground('#0f5c4a').setFontColor('#ffffff');
    set.getRange(2, 1, SETTINGS.length, 3).setValues(SETTINGS);
    set.setColumnWidth(1, 430); set.setColumnWidth(2, 240); set.hideColumns(3);
  } else {
    var keys = set.getRange(2, 3, Math.max(set.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; });
    SETTINGS.forEach(function (s) { if (keys.indexOf(s[2]) < 0) set.appendRow(s); });
  }
  header_(ss, SHEET.data, DATA_HEAD, function (sh) {
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm'); sh.getRange('L:N').setNumberFormat('#,##0');
    sh.getRange('O2:O').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).build());
    sh.hideColumns(DATA_HEAD.indexOf('_data') + 1); sh.setColumnWidth(1, 120); sh.setColumnWidth(3, 200);
  });
  header_(ss, SHEET.sales, SALES_HEAD, function (sh) {
    sh.getRange('J:J').setNumberFormat('#,##0'); sh.getRange('O:P').setNumberFormat('#,##0');
    sh.getRange('K2:K').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(METHODS).map(function (k) { return METHODS[k]; }), true).build());
  });
  header_(ss, SHEET.outlet, OUTLET_HEAD, function (sh) {
    sh.getRange('H:H').setNumberFormat('dd/MM/yyyy'); sh.getRange('J:J').setNumberFormat('dd/MM/yyyy');
    sh.getRange('M2:M').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['YA', 'TIDAK'], true).setAllowInvalid(false).build());
    sh.setColumnWidth(6, 180); sh.setColumnWidth(12, 260);
  });
  header_(ss, SHEET.log, LOG_HEAD, function (sh) { sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm'); });
  ss.getSheetByName(SHEET.outlet).getRange('I2:I').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList([JENIS.M, JENIS.R, 'Reaktivasi'], true).build());
  markEditable_(ss.getSheetByName(SHEET.data), DATA_HEAD, DATA_EDITABLE);
  markEditable_(ss.getSheetByName(SHEET.sales), SALES_HEAD, SALES_EDITABLE);
  markEditable_(ss.getSheetByName(SHEET.outlet), OUTLET_HEAD, OUTLET_EDITABLE);
  if (!ss.getSheetByName(SHEET.print)) ss.insertSheet(SHEET.print);
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
}

function header_(ss, name, head, fmt) {
  var sh = ss.getSheetByName(name);
  if (sh) {
    // sinkronkan judul kolom bila versi script menambah/ganti nama kolom
    var cur = sh.getRange(1, 1, 1, head.length).getValues()[0];
    if (cur.join('|') !== head.join('|')) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setFontColor('#ffffff').setWrap(true);
    return sh;
  }
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f5c4a').setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1); sh.setRowHeight(1, 36);
  if (fmt) fmt(sh);
  return sh;
}

function markEditable_(sh, head, editable) {
  head.forEach(function (h, i) {
    var cell = sh.getRange(1, i + 1);
    if (editable.indexOf(h) >= 0) cell.setBackground('#b86a00').setNote('Boleh dikoreksi admin. Setelah edit, jalankan menu Klaim NOO Opak > Hitung ulang klaim terpilih.');
    else if (h !== '_data') cell.setBackground('#0f5c4a');
  });
}

/* ===================== HELPERS ===================== */
function getSettings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set), S = {};
  SETTINGS.forEach(function (s) { S[s[2]] = s[1]; });
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (r[2]) S[r[2]] = r[1]; });
  // Sheets mengubah "2026-10" menjadi tanggal — kembalikan ke teks YYYY-MM
  var nl = S.noLookback;
  S.noLookback = Object.prototype.toString.call(nl) === '[object Date]' ? Utilities.formatDate(nl, ssTz_(), 'yyyy-MM') : String(nl == null ? '' : nl).replace(/^'/, '');
  S.packRules = String(S.packRules == null ? '' : S.packRules);
  ['perOutlet', 'minOutlet', 'minDus', 'lookback', 'ownThr', 'titipThr', 'titipRate', 'coRate'].forEach(function (k) {
    S[k] = typeof S[k] === 'number' ? S[k] : parseFloat(String(S[k]).replace(/\./g, '').replace(',', '.')) || 0;
  });
  return S;
}
function pubSettings_(S) {
  return {perOutlet: S.perOutlet, minOutlet: S.minOutlet, lookback: S.lookback, ownThr: S.ownThr, titipThr: S.titipThr, titipRate: S.titipRate, coRate: S.coRate, entity: S.entity, keywords: S.keywords, noLookback: S.noLookback, minDus: S.minDus || 1, packRules: S.packRules};
}
function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set);
  var keys = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (keys[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
}
function isOpen_(S) { return String(S.open || 'YA').trim().toUpperCase() !== 'TIDAK'; }
function headOf_(i) { return {distributor: i.distributor, area: i.area, periode: i.periode, pengaju: i.pengaju, kontak: i.kontak}; }
function totalsOf_(c) { return {submitted: c.submitted, valid: c.valid, eligible: c.eligible, total: c.total, tax: c.pay.tax, totalNet: c.totalNet}; }
function str_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 120); }
function cell_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function normDist_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function ssTz_() { return SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || TZ; }
/** tulis tanggal sesuai zona waktu spreadsheet (hindari geser 1 hari) */
function asDate_(iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Utilities.parseDate(iso, ssTz_(), 'yyyy-MM-dd') : ''; }
/** baca tanggal dari sel (Date atau teks) → YYYY-MM-DD */
function isoS_(v) { return Object.prototype.toString.call(v) === '[object Date]' ? (isNaN(v) ? '' : Utilities.formatDate(v, ssTz_(), 'yyyy-MM-dd')) : toISO(v); }
function note_(msg) { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Klaim NOO Opak', 10); }
function userEmail_() { try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } }
/** Lebar kolom PDF dinamis untuk tabel rincian pembayaran (baris r1–r2): kolom melebar mengikuti isian
 *  terpanjang (nama, metode, bank / no. rek, cabang, a/n); isian yang lebih panjang dari batas dibungkus (wrap). */
function autoWidths_(sh, r1, r2, N, base, cap) {
  cap = cap || 260;
  var w = base.slice();
  if (r2 < r1) { w.forEach(function (x, j) { sh.setColumnWidth(j + 1, x); }); return w; }
  var rg = sh.getRange(r1, 1, r2 - r1 + 1, N), vals = rg.getDisplayValues(), bgs = rg.getBackgrounds(), skip = {};
  rg.getMergedRanges().forEach(function (m) {
    for (var i = m.getRow(); i <= m.getLastRow(); i++) for (var j = m.getColumn(); j <= m.getLastColumn(); j++) skip[i + ',' + j] = 1;
  });
  vals.forEach(function (row, i) {
    row.forEach(function (v, j) {
      if (v === '' || skip[(r1 + i) + ',' + (j + 1)] || String(bgs[i][j]).toLowerCase() === '#e8f2ee') return;
      var len = String(v).split('\n').reduce(function (m, l) { return Math.max(m, l.length); }, 0);
      w[j] = Math.max(w[j], Math.min(cap, Math.ceil(len * 6.6 + 16)));
    });
  });
  w.forEach(function (x, j) { sh.setColumnWidth(j + 1, x); });
  rg.setWrap(true).setVerticalAlignment('middle');
  return w;
}

function fmtNum_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function findPay_(list, idx) { for (var i = 0; i < list.length; i++) if (list[i].i === idx) return list[i]; return null; }

function sanitize_(p) {
  if (!p || typeof p !== 'object') throw new Error('Data tidak valid.');
  var out = {distributor: str_(p.distributor), area: str_(p.area, 60), periode: str_(p.periode, 7), pengaju: str_(p.pengaju, 80), kontak: str_(p.kontak, 60), rows: []};
  if (!out.distributor) throw new Error('Nama distributor wajib diisi.');
  if (!/^\d{4}-\d{2}$/.test(out.periode)) throw new Error('Periode klaim wajib dipilih.');
  if (!out.pengaju) throw new Error('Nama pengaju wajib diisi.');
  var rows = Array.isArray(p.rows) ? p.rows : [];
  if (p.mode === 'auto') return sanitizeAuto_(p, out, rows);
  if (!rows.length) throw new Error('Minimal 1 salesman.');
  if (rows.length > 60) throw new Error('Maksimal 60 salesman per klaim.');
  var total = 0;
  rows.forEach(function (r, i) {
    r = r || {};
    var name = str_(r.name, 80);
    if (!name) throw new Error('Nama salesman ke-' + (i + 1) + ' belum diisi.');
    var outs = (Array.isArray(r.outlets) ? r.outlets : []).filter(function (o) { return o && (str_(o.kode) || str_(o.nama)); });
    total += outs.length;
    var pay = r.pay || {};
    out.rows.push({name: name, pay: {m: METHODS[pay.m] ? pay.m : 'own', bank: str_(pay.bank, 80), cab: str_(pay.cab, 60), an: str_(pay.an, 80)},
      outlets: outs.map(function (o) { return {kode: str_(o.kode, 40), nama: str_(o.nama, 80), alamat: str_(o.alamat, 120), tgl: toISO(o.tgl), jenis: normJenis(o.jenis), last: toISO(o.last)}; })});
  });
  if (total > 3000) throw new Error('Maksimal 3.000 outlet per klaim. Pecah menjadi beberapa klaim.');
  if (!total) throw new Error('Belum ada outlet NOO yang diisi.');
  return out;
}

function nextId_(sh, now) {
  var prefix = 'NOO-' + Utilities.formatDate(now, TZ, 'yyMM') + '-', n = 0;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var v = String(r[0]); if (v.indexOf(prefix) === 0) n = Math.max(n, parseInt(v.slice(prefix.length), 10) || 0);
  });
  return prefix + ('000' + (n + 1)).slice(-4);
}
function findDataRow_(ss, id) {
  var sh = ss.getSheetByName(SHEET.data);
  if (sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}
function isVerifiedRow_(ss, row) {
  if (!row || row < 2) return false;
  return VERIFIED.indexOf(String(ss.getSheetByName(SHEET.data).getRange(row, DATA_HEAD.indexOf('Status') + 1).getValue()).trim()) >= 0;
}

function terbilang_(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  var s = ['', 'satu', 'dua', 'tiga', 'empat', 'lima', 'enam', 'tujuh', 'delapan', 'sembilan', 'sepuluh', 'sebelas'];
  var t = function (x) {
    if (x < 12) return s[x];
    if (x < 20) return t(x - 10) + ' belas';
    if (x < 100) return t(Math.floor(x / 10)) + ' puluh ' + t(x % 10);
    if (x < 200) return 'seratus ' + t(x - 100);
    if (x < 1000) return t(Math.floor(x / 100)) + ' ratus ' + t(x % 100);
    if (x < 2000) return 'seribu ' + t(x - 1000);
    if (x < 1e6) return t(Math.floor(x / 1000)) + ' ribu ' + t(x % 1000);
    if (x < 1e9) return t(Math.floor(x / 1e6)) + ' juta ' + t(x % 1e6);
    return t(Math.floor(x / 1e9)) + ' miliar ' + t(x % 1e9);
  };
  var out = n === 0 ? 'nol' : t(n).replace(/\s+/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
