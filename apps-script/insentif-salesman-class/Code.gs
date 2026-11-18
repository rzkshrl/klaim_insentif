/**
 * FORM KLAIM INSENTIF SALESMAN DISTRIBUTOR (CLASS A/B) — Google Apps Script
 * ------------------------------------------------------------------
 * Pasang di Google Sheet milik admin (Extensions > Apps Script).
 * - doGet        : menampilkan form (Index.html) ke distributor via link web app
 * - submitKlaim  : menerima submit, menghitung ulang di server, menulis ke sheet,
 *                  dan membuat PDF klaim SHU & NANA (siap cetak) di Google Drive admin
 * - Menu "Klaim Insentif" di Sheet untuk admin
 */

var SHEET = {data: 'Data Klaim', sales: 'Data Salesman', set: 'Pengaturan', print: 'Cetak', log: 'Log Revisi'};
var TZ = 'Asia/Jakarta';
var STATUS = ['Baru', 'Diverifikasi', 'Disetujui', 'Dibayar', 'Ditolak'];
var PDF_PENDING = 'Menunggu PDF…';
var PDF_WAIT = 'Menunggu verifikasi';
var VERIFIED = ['Diverifikasi', 'Disetujui', 'Dibayar'];   // status yang boleh dicetak untuk finance
var STATUS_HANDLER = 'onStatusEdit';
var PDF_HANDLER = 'processPdfQueue';

var SETTINGS = [
  ['Target Sell Out minimal Class A (Rp)', 35000000, 'classAMin'],
  ['Target Sell Out minimal Class B (Rp)', 50000000, 'classBMin'],
  ['Nominal insentif Class A (100%)', 250000, 'nomA'],
  ['Nominal insentif Class B (100%)', 500000, 'nomB'],
  ['Batas rekening sendiri tanpa pajak (Rp)', 500000, 'ownThr'],
  ['Batas kumulatif titip rekening per factory (Rp)', 5000000, 'titipThr'],
  ['Pajak titip rekening (%)', 2.5, 'titipRate'],
  ['Pajak rekening perusahaan (%)', 15, 'coRate'],
  ['Kode akses form (kosongkan jika tanpa kode)', '', 'code'],
  ['Form menerima klaim (YA / TIDAK)', 'YA', 'open'],
  ['Nama entitas SHU', 'CV Sumber Harum Utama', 'entShu'],
  ['Nama entitas NANA', 'CV Nana Abadi', 'entNana'],
  ['ID folder PDF (terisi otomatis)', '', 'folderId']
];

var DATA_HEAD = ['ID Klaim', 'Waktu Submit', 'Distributor', 'Area', 'Periode', 'Diajukan Oleh', 'Kontak',
  'Jml Salesman', 'Insentif SHU', 'Pajak SHU', 'Diterima SHU', 'Insentif NANA', 'Pajak NANA', 'Diterima NANA',
  'Total Insentif', 'Total Diterima', 'Status', 'PDF SHU', 'PDF NANA', 'Catatan Admin', '_data'];

var SALES_HEAD = ['ID Klaim', 'Periode', 'Distributor', 'Salesman', 'Kelas', 'Nominal Kelas',
  'Target SO', 'Real SO SHU', 'Real SO NANA', 'Ach SO',
  'Target RO', 'Real RO (NANA)', 'Ach RO',
  'Target SKU 2000', 'Real SKU 2000 SHU', 'Real SKU 2000 NANA', 'Ach SKU 2000',
  'Skor', 'Insentif SHU', 'Insentif NANA', 'Total Insentif',
  'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N',
  'Pajak SHU', 'Diterima SHU', 'Pajak NANA', 'Diterima NANA'];

var SALES_EDITABLE = ['Salesman', 'Target SO', 'Real SO SHU', 'Real SO NANA', 'Target RO', 'Real RO (NANA)',
  'Target SKU 2000', 'Real SKU 2000 SHU', 'Real SKU 2000 NANA', 'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N'];
var DATA_EDITABLE = ['Distributor', 'Area', 'Periode', 'Diajukan Oleh', 'Kontak'];
var LOG_HEAD = ['Waktu', 'ID Klaim', 'Admin', 'Salesman', 'Kolom', 'Nilai Lama', 'Nilai Baru'];
var EDIT_MARK = '#fff3c4';

/* ===== LOGIKA PERHITUNGAN (dipakai sama persis di server & form) ===== */
var KPIS = [
  {key:'so',  label:'Sell Out', short:'SELL OUT', unit:'Value (Rp)', w:40, owner:'split'},
  {key:'ro',  label:'RO',       short:'RO',       unit:'Outlet',     w:25, owner:'NANA'},
  {key:'sku', label:'SKU 2000', short:'SKU 2000', unit:'Qty',        w:35, owner:'split'}
];
var MIN_ACH = 0.9;
var METHODS = {own:'Rekening sendiri', titip:'Titip 1 rekening', co:'Rekening perusahaan'};
var FACTORIES = ['SHU', 'NANA'];

/** kelas salesman dari target Sell Out (total SHU + NANA) */
function classOf(t, S) {
  t = Number(t) || 0;
  if (t >= Number(S.classBMin)) return {cls: 'B', nom: Number(S.nomB) || 0};
  if (t >= Number(S.classAMin)) return {cls: 'A', nom: Number(S.nomA) || 0};
  return {cls: '', nom: 0};
}

function computeClaim(input, S) {
  var rows = input.rows.map(function (r) {
    var o = {name: r.name, kpi: {}, pay: r.pay || {m: 'own'}};
    KPIS.forEach(function (k) {
      var d = r[k.key] || {}, w = k.w / 100;
      var s = k.owner === 'NANA' ? 0 : (Number(d.s) || 0);
      var n = k.owner === 'SHU' ? 0 : (Number(d.n) || 0);
      var t = Number(d.t) || 0, tot = s + n, ach = t > 0 ? tot / t : 0;
      var counted = ach >= MIN_ACH ? Math.min(ach, 1) : 0;
      o.kpi[k.key] = {w: w, t: t, s: s, n: n, tot: tot, ach: ach, active: true, counted: counted, pts: w * counted, owner: k.owner};
    });
    var c = classOf(o.kpi.so.t, S);
    o.cls = c.cls; o.nom = c.nom;
    o.gate = o.kpi.so.ach >= MIN_ACH;
    o.ok = o.gate && o.nom > 0;
    var soC = o.kpi.so.tot > 0 ? o.kpi.so.s / o.kpi.so.tot : 0.5;
    o.shu = 0; o.nana = 0; o.score = 0;
    KPIS.forEach(function (k) {
      var x = o.kpi[k.key];
      x.inc = o.ok ? Math.round(o.nom * x.pts) : 0;
      x.cShu = x.owner === 'SHU' ? 1 : x.owner === 'NANA' ? 0 : (x.tot > 0 ? x.s / x.tot : soC);
      x.cNana = 1 - x.cShu;
      x.incShu = Math.round(x.inc * x.cShu);
      x.incNana = x.inc - x.incShu;
      o.shu += x.incShu; o.nana += x.incNana;
      if (o.ok) o.score += x.pts;
    });
    o.incentive = o.shu + o.nana;
    return o;
  });

  var pay = {};
  FACTORIES.forEach(function (f) {
    var key = f === 'SHU' ? 'shu' : 'nana';
    var list = rows.map(function (r, i) {
      var p = r.pay || {};
      return {i: i, name: r.name, m: METHODS[p.m] ? p.m : 'own', bank: p.bank || '', cab: p.cab || '', an: p.an || '', nom: r[key]};
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
    pay[f] = {list: list, titipSum: titipSum, titipOn: titipOn, nom: agg.nom, tax: agg.tax, net: agg.net};
  });
  return {rows: rows, pay: pay, total: pay.SHU.nom + pay.NANA.nom, totalNet: pay.SHU.net + pay.NANA.net};
}
/* ===== akhir logika perhitungan ===== */


/* ===================== WEB APP ===================== */
function doGet(e) {
  if (e && e.parameter && e.parameter.fn === 'getPublicSettings') {
    try { return apiOut_({ok: true, data: getPublicSettings()}); } catch (err) { return apiOut_({ok: false, error: String(err.message || err)}); }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Form Klaim Insentif Salesman Class A/B')
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
  return {
    classAMin: S.classAMin, classBMin: S.classBMin, nomA: S.nomA, nomB: S.nomB, ownThr: S.ownThr, titipThr: S.titipThr, titipRate: S.titipRate, coRate: S.coRate,
    needCode: !!String(S.code || '').trim(), open: isOpen_(S), entShu: S.entShu, entNana: S.entNana
  };
}

function submitKlaim(payload) {
  var S = getSettings_();
  if (!isOpen_(S)) throw new Error('Form sedang tidak menerima klaim. Hubungi admin.');
  var code = String(S.code || '').trim();
  if (code && String((payload && payload.code) || '').trim() !== code) throw new Error('Kode akses salah.');

  var input = sanitize_(payload);
  var claim = computeClaim(input, S);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var rec, rowIdx;
  try {
    var now = new Date();
    var sh = ss.getSheetByName(SHEET.data);
    var id = nextId_(sh, now);
    rec = {id: id, submittedAt: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), input: input, claim: claim,
      settings: {classAMin: S.classAMin, classBMin: S.classBMin, nomA: S.nomA, nomB: S.nomB, ownThr: S.ownThr, titipThr: S.titipThr, titipRate: S.titipRate, coRate: S.coRate,
        entShu: S.entShu, entNana: S.entNana}};
    var P = claim.pay;
    sh.appendRow([id, now, cell_(input.distributor), cell_(input.area), cell_(input.periode), cell_(input.pengaju), cell_(input.kontak),
      claim.rows.length, P.SHU.nom, P.SHU.tax, P.SHU.net, P.NANA.nom, P.NANA.tax, P.NANA.net,
      claim.total, claim.totalNet, 'Baru',
      claim.pay.SHU.list.length ? PDF_WAIT : '— (tidak ada)',
      claim.pay.NANA.list.length ? PDF_WAIT : '— (tidak ada)', '', JSON.stringify(rec)]);
    rowIdx = sh.getLastRow();

    var ssh = ss.getSheetByName(SHEET.sales);
    var srows = claim.rows.map(function (r, idx) {
      var k = r.kpi, ps = findPay_(P.SHU.list, idx), pn = findPay_(P.NANA.list, idx), pay = r.pay || {};
      return [id, cell_(input.periode), cell_(input.distributor), cell_(r.name), r.cls || '-', r.nom,
        k.so.t, k.so.s, k.so.n, k.so.ach,
        k.ro.t, k.ro.n, k.ro.ach,
        k.sku.t, k.sku.s, k.sku.n, k.sku.ach,
        r.score, r.shu, r.nana, r.incentive,
        METHODS[pay.m] || METHODS.own, cell_(pay.bank), cell_(pay.cab), cell_(pay.an),
        ps ? ps.tax : 0, ps ? ps.net : 0, pn ? pn.tax : 0, pn ? pn.net : 0];
    });
    if (srows.length) ssh.getRange(ssh.getLastRow() + 1, 1, srows.length, SALES_HEAD.length).setValues(srows);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  return {id: rec.id, shu: claim.pay.SHU, nana: claim.pay.NANA, total: claim.total, totalNet: claim.totalNet};
}

/* ===================== MENU ADMIN ===================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Klaim Insentif')
    .addItem('Tampilkan klaim terpilih di sheet Cetak — SHU', 'printSelectedShu')
    .addItem('Tampilkan klaim terpilih di sheet Cetak — NANA', 'printSelectedNana')
    .addItem('Hitung ulang klaim terpilih (setelah edit data)', 'recalcSelected')
    .addItem('Buat ulang PDF klaim terpilih', 'regenPdfSelected')
    .addSeparator()
    .addItem('Setup / perbaiki struktur sheet', 'setup')
    .addToUi();
}
function printSelectedShu() { printSelected_('SHU'); }
function printSelectedNana() { printSelected_('NANA'); }

function printSelected_(f) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sel = selectedRecord_(ss);
  if (!sel) return;
  var sh = ss.getSheetByName(SHEET.print) || ss.insertSheet(SHEET.print);
  renderPrint_(sh, sel.rec, f);
  ss.setActiveSheet(sh);
  note_('Klaim ' + sel.rec.id + ' (' + f + ') siap di sheet Cetak. File > Print: Current sheet, Landscape, Fit to width.');
}

function regenPdfSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sel = selectedRecord_(ss);
  if (!sel) return;
  if (!isVerifiedRow_(ss, sel.row)) { note_('Klaim ' + sel.rec.id + ' belum diverifikasi. Ubah Status menjadi "Diverifikasi" — PDF akan dibuat otomatis.'); return; }
  writePdfLinks_(ss, sel.row, sel.rec);
  note_('PDF klaim ' + sel.rec.id + ' sudah dibuat ulang.');
}

/** pesan non-blocking (alert menahan eksekusi sampai diklik) */
function note_(msg) { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Klaim Insentif', 10); }

function selectedRecord_(ss) {
  var sh = ss.getActiveSheet();
  if (sh.getName() !== SHEET.data) { note_('Buka sheet "' + SHEET.data + '" lalu klik salah satu baris klaim terlebih dahulu.'); return null; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { note_('Klik baris klaim (bukan baris judul).'); return null; }
  var raw = sh.getRange(row, DATA_HEAD.indexOf('_data') + 1).getValue();
  try { return {row: row, rec: JSON.parse(raw)}; } catch (e) { note_('Data klaim di baris ini tidak terbaca.'); return null; }
}

/* ===================== SETUP ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === STATUS_HANDLER; });
  if (!has) ScriptApp.newTrigger(STATUS_HANDLER).forSpreadsheet(ss).onEdit().create();
  // toast tidak menahan eksekusi (alert akan menunggu klik OK dan bikin timeout)
  ss.toast('Struktur sheet siap. Lanjutkan Deploy > New deployment > Web app.', 'Klaim Insentif', 8);
  Logger.log('Setup selesai.');
}

function ensureSheets_(ss) {
  var set = ss.getSheetByName(SHEET.set);
  if (!set) {
    set = ss.insertSheet(SHEET.set);
    set.getRange(1, 1, 1, 3).setValues([['Pengaturan', 'Nilai', 'key']]).setFontWeight('bold').setBackground('#0f5c4a').setFontColor('#ffffff');
    set.getRange(2, 1, SETTINGS.length, 3).setValues(SETTINGS);
    set.setColumnWidth(1, 330); set.setColumnWidth(2, 220);
    set.hideColumns(3);
    set.getRange(2, 2, 6, 1).setNumberFormat('#,##0');
  } else {
    var keys = set.getRange(2, 3, Math.max(set.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; });
    SETTINGS.forEach(function (s) { if (keys.indexOf(s[2]) < 0) set.appendRow(s); });
  }
  header_(ss, SHEET.data, DATA_HEAD, function (sh) {
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('I:P').setNumberFormat('#,##0');
    sh.getRange('Q2:Q').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).build());
    sh.hideColumns(DATA_HEAD.length);
    sh.setColumnWidth(1, 120); sh.setColumnWidth(3, 200);
  });
  header_(ss, SHEET.sales, SALES_HEAD, function (sh) {
    sh.getRange('F:I').setNumberFormat('#,##0'); sh.getRange('J:J').setNumberFormat('0.0%');
    sh.getRange('K:L').setNumberFormat('#,##0'); sh.getRange('M:M').setNumberFormat('0.0%');
    sh.getRange('N:P').setNumberFormat('#,##0'); sh.getRange('Q:R').setNumberFormat('0.0%');
    sh.getRange('S:U').setNumberFormat('#,##0'); sh.getRange('Z:AC').setNumberFormat('#,##0');
  });
  header_(ss, SHEET.log, LOG_HEAD, function (sh) { sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm'); sh.setColumnWidth(5, 170); });
  markEditable_(ss.getSheetByName(SHEET.sales), SALES_HEAD, SALES_EDITABLE);
  markEditable_(ss.getSheetByName(SHEET.data), DATA_HEAD, DATA_EDITABLE);
  var ssh = ss.getSheetByName(SHEET.sales);
  ssh.getRange(2, SALES_HEAD.indexOf('Metode Bayar') + 1, ssh.getMaxRows() - 1, 1)
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(METHODS).map(function (k) { return METHODS[k]; }), true).build());
  if (!ss.getSheetByName(SHEET.print)) ss.insertSheet(SHEET.print);
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
}

function header_(ss, name, head, fmt) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#0f5c4a')
    .setFontColor('#ffffff').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1); sh.setRowHeight(1, 36);
  if (fmt) fmt(sh);
  return sh;
}

/* ===================== HELPERS ===================== */
function getSettings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set);
  var S = {};
  SETTINGS.forEach(function (s) { S[s[2]] = s[1]; });
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (r[2]) S[r[2]] = r[1]; });
  }
  ['classAMin', 'classBMin', 'nomA', 'nomB', 'ownThr', 'titipThr', 'titipRate', 'coRate'].forEach(function (k) {
    S[k] = typeof S[k] === 'number' ? S[k] : parseFloat(String(S[k]).replace(/\./g, '').replace(',', '.')) || 0;
  });
  return S;
}
function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set);
  var keys = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (keys[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
}
function isOpen_(S) { return String(S.open || 'YA').trim().toUpperCase() !== 'TIDAK'; }

function str_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 120); }
function num_(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.min(v, 1e13) : 0; }
/** cegah teks diawali = + - @ dibaca sebagai rumus */
function cell_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }

function sanitize_(p) {
  if (!p || typeof p !== 'object') throw new Error('Data tidak valid.');
  var out = {distributor: str_(p.distributor), area: str_(p.area, 60), periode: str_(p.periode, 60),
    pengaju: str_(p.pengaju, 80), kontak: str_(p.kontak, 60), rows: []};
  if (!out.distributor) throw new Error('Nama distributor wajib diisi.');
  if (!out.periode) throw new Error('Periode wajib diisi.');
  if (!out.pengaju) throw new Error('Nama pengaju wajib diisi.');
  var rows = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) throw new Error('Minimal 1 salesman.');
  if (rows.length > 60) throw new Error('Maksimal 60 salesman per klaim.');
  var k = function (o) { o = o || {}; return {t: num_(o.t), s: num_(o.s), n: num_(o.n)}; };
  rows.forEach(function (r, i) {
    r = r || {};
    var name = str_(r.name, 80);
    if (!name) throw new Error('Nama salesman ke-' + (i + 1) + ' belum diisi.');
    var pay = r.pay || {};
    var row = {name: name, so: k(r.so), ro: k(r.ro), sku: k(r.sku),
      pay: {m: METHODS[pay.m] ? pay.m : 'own', bank: str_(pay.bank, 80), cab: str_(pay.cab, 60), an: str_(pay.an, 80)}};
    if (row.so.t <= 0) throw new Error('Target Sell Out untuk ' + name + ' belum diisi.');
    out.rows.push(row);
  });
  return out;
}

function nextId_(sh, now) {
  var prefix = 'KLS-' + Utilities.formatDate(now, TZ, 'yyMM') + '-';
  var n = 0;
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var v = String(r[0]);
      if (v.indexOf(prefix) === 0) n = Math.max(n, parseInt(v.slice(prefix.length), 10) || 0);
    });
  }
  return prefix + ('000' + (n + 1)).slice(-4);
}

function findPay_(list, idx) {
  for (var i = 0; i < list.length; i++) if (list[i].i === idx) return list[i];
  return null;
}


/* ===================== EDIT & HITUNG ULANG OLEH ADMIN =====================
 * Admin mengoreksi angka di sheet "Data Salesman" (kolom judul oranye) atau data
 * klaim di "Data Klaim", lalu menjalankan menu "Hitung ulang klaim terpilih".
 * Sistem menghitung ulang insentif & pajak, memperbarui kedua sheet, mencatat
 * perubahan di "Log Revisi", dan membuat ulang PDF. Data asli distributor tetap
 * tersimpan di dalam record klaim. */
function markEditable_(sh, head, editable) {
  head.forEach(function (h, i) {
    var cell = sh.getRange(1, i + 1);
    if (editable.indexOf(h) >= 0) cell.setBackground('#b86a00').setNote('Boleh dikoreksi admin. Setelah edit, jalankan menu Klaim Insentif > Hitung ulang klaim terpilih.');
    else if (h !== '_data') cell.setBackground('#0f5c4a');
  });
}

/** simple trigger: tandai sel yang diedit agar admin ingat menghitung ulang */
function onEdit(e) {
  try {
    var sh = e.range.getSheet(), name = sh.getName();
    if (e.range.getRow() < 2) return;
    var head = name === SHEET.sales ? SALES_HEAD : name === SHEET.data ? DATA_HEAD : null;
    if (!head) return;
    var editable = name === SHEET.sales ? SALES_EDITABLE : DATA_EDITABLE;
    var h = head[e.range.getColumn() - 1];
    if (editable.indexOf(h) < 0) return;
    e.range.setBackground(EDIT_MARK);
    e.source.toast('Klik baris ini lalu menu Klaim Insentif > Hitung ulang klaim terpilih agar total, pajak & PDF ikut berubah.', 'Data diubah', 8);
  } catch (err) {}
}

function recalcSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getActiveSheet();
  if ([SHEET.data, SHEET.sales].indexOf(sh.getName()) < 0) { note_('Buka sheet "' + SHEET.data + '" atau "' + SHEET.sales + '", lalu klik baris klaim yang akan dihitung ulang.'); return; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { note_('Klik baris klaim (bukan baris judul).'); return; }
  var id = String(sh.getRange(row, 1).getValue()).trim();
  if (!id) { note_('Baris ini tidak memiliki ID Klaim.'); return; }
  note_('Menghitung ulang ' + id + '…');
  try {
    var r = recalcClaim_(ss, id);
    note_(id + ' dihitung ulang. Total insentif ' + fmtNum_(r.before) + ' → ' + fmtNum_(r.after) + ' (' + r.changes + ' perubahan dicatat di Log Revisi).' + (isVerifiedRow_(ss, findDataRow_(ss, id)) ? ' PDF diperbarui.' : ' PDF dibuat setelah status Diverifikasi.'));
  } catch (e) {
    note_('Gagal menghitung ulang ' + id + ': ' + e.message);
  }
}

function recalcClaim_(ss, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var dsh = ss.getSheetByName(SHEET.data), ssh = ss.getSheetByName(SHEET.sales);
    var D = function (h) { return DATA_HEAD.indexOf(h); }, C = function (h) { return SALES_HEAD.indexOf(h); };
    var dvals = dsh.getRange(2, 1, Math.max(dsh.getLastRow() - 1, 1), DATA_HEAD.length).getValues();
    var di = -1;
    for (var i = 0; i < dvals.length; i++) if (String(dvals[i][0]) === id) { di = i; break; }
    if (di < 0) throw new Error('ID tidak ditemukan di ' + SHEET.data);
    var rec = JSON.parse(dvals[di][D('_data')]);
    var dRow = dvals[di];

    var svals = ssh.getRange(2, 1, Math.max(ssh.getLastRow() - 1, 1), SALES_HEAD.length).getValues();
    var idx = [];
    svals.forEach(function (v, j) { if (String(v[0]) === id) idx.push(j); });
    if (!idx.length) throw new Error('Tidak ada baris salesman untuk klaim ini di ' + SHEET.sales);

    var inv = {};
    Object.keys(METHODS).forEach(function (k) { inv[METHODS[k]] = k; });
    var rows = idx.map(function (j) {
      var v = svals[j], name = str_(v[C('Salesman')], 80);
      if (!name) throw new Error('Nama salesman kosong di baris ' + (j + 2));
      return {name: name,
        so: {t: num_(v[C('Target SO')]), s: num_(v[C('Real SO SHU')]), n: num_(v[C('Real SO NANA')])},
        ro: {t: num_(v[C('Target RO')]), s: 0, n: num_(v[C('Real RO (NANA)')])},
        sku: {t: num_(v[C('Target SKU 2000')]), s: num_(v[C('Real SKU 2000 SHU')]), n: num_(v[C('Real SKU 2000 NANA')])},
        pay: {m: inv[String(v[C('Metode Bayar')]).trim()] || 'own', bank: str_(v[C('Bank / No. Rek')], 80), cab: str_(v[C('Cabang')], 60), an: str_(v[C('A/N')], 80)}};
    });
    var input = {distributor: str_(dRow[D('Distributor')]), area: str_(dRow[D('Area')], 60), periode: str_(dRow[D('Periode')], 60),
      pengaju: str_(dRow[D('Diajukan Oleh')], 80), kontak: str_(dRow[D('Kontak')], 60), rows: rows};
    var claim = computeClaim(input, rec.settings);

    var admin = userEmail_();
    var now = new Date();
    var logs = diffInput_(rec.input, input).map(function (c) { return [now, id, admin, cell_(c[0]), c[1], cell_(c[2]), cell_(c[3])]; });
    logs.push([now, id, admin, '(klaim)', 'Total insentif', rec.claim.total, claim.total]);

    var before = rec.claim.total;
    if (!rec.original) rec.original = {input: rec.input, total: rec.claim.total, totalNet: rec.claim.totalNet};
    rec.input = input; rec.claim = claim;
    rec.revisions = (rec.revisions || []).concat([{at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), by: admin}]);

    // Data Salesman: tulis ulang kolom hasil hitung, hapus tanda kuning
    claim.rows.forEach(function (r, j) {
      var rowNo = idx[j] + 2, k = r.kpi, ps = findPay_(claim.pay.SHU.list, j), pn = findPay_(claim.pay.NANA.list, j);
      ssh.getRange(rowNo, C('Kelas') + 1, 1, 2).setValues([[r.cls || '-', r.nom]]);
      ssh.getRange(rowNo, C('Ach SO') + 1).setValue(k.so.ach);
      ssh.getRange(rowNo, C('Ach RO') + 1).setValue(k.ro.ach);
      ssh.getRange(rowNo, C('Ach SKU 2000') + 1).setValue(k.sku.ach);
      ssh.getRange(rowNo, C('Skor') + 1, 1, 4).setValues([[r.score, r.shu, r.nana, r.incentive]]);
      ssh.getRange(rowNo, C('Pajak SHU') + 1, 1, 4).setValues([[ps ? ps.tax : 0, ps ? ps.net : 0, pn ? pn.tax : 0, pn ? pn.net : 0]]);
      ssh.getRange(rowNo, 1, 1, SALES_HEAD.length).setBackground(null);
    });

    // Data Klaim: total, catatan, record
    var P = claim.pay, dRowNo = di + 2;
    dsh.getRange(dRowNo, D('Jml Salesman') + 1, 1, 9).setValues([[claim.rows.length, P.SHU.nom, P.SHU.tax, P.SHU.net, P.NANA.nom, P.NANA.tax, P.NANA.net, claim.total, claim.totalNet]]);
    dsh.getRange(dRowNo, 1, 1, DATA_HEAD.length - 1).setBackground(null);
    var noteCell = dsh.getRange(dRowNo, D('Catatan Admin') + 1);
    var tag = 'Revisi ke-' + rec.revisions.length + ' (' + rec.revisions[rec.revisions.length - 1].at + ')';
    var old = String(noteCell.getValue() || '').replace(/\s*\[Revisi ke-\d+ \([^)]*\)\]$/, '');
    noteCell.setValue((old ? old + ' ' : '') + '[' + tag + ']');
    dsh.getRange(dRowNo, D('_data') + 1).setValue(JSON.stringify(rec));

    var lsh = ss.getSheetByName(SHEET.log) || header_(ss, SHEET.log, LOG_HEAD);
    lsh.getRange(lsh.getLastRow() + 1, 1, logs.length, LOG_HEAD.length).setValues(logs);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (isVerifiedRow_(ss, dRowNo)) writePdfLinks_(ss, dRowNo, rec);
  return {before: before, after: claim.total, changes: logs.length - 1};
}

function diffInput_(a, b) {
  var out = [];
  ['distributor', 'area', 'periode', 'pengaju', 'kontak'].forEach(function (k) {
    if (String(a[k] || '') !== String(b[k] || '')) out.push(['(klaim)', k, a[k] || '', b[k] || '']);
  });
  var F = [['so', 't', 'Target SO'], ['so', 's', 'Real SO SHU'], ['so', 'n', 'Real SO NANA'], ['ro', 't', 'Target RO'],
    ['ro', 'n', 'Real RO (NANA)'], ['sku', 't', 'Target SKU 2000'], ['sku', 's', 'Real SKU 2000 SHU'], ['sku', 'n', 'Real SKU 2000 NANA']];
  var P = [['m', 'Metode Bayar'], ['bank', 'Bank / No. Rek'], ['cab', 'Cabang'], ['an', 'A/N']];
  var used = {};
  b.rows.forEach(function (r, j) {
    var oi = -1;
    for (var i = 0; i < a.rows.length; i++) if (!used[i] && a.rows[i].name === r.name) { oi = i; break; }
    if (oi < 0 && j < a.rows.length && !used[j]) oi = j;
    if (oi < 0) { out.push([r.name, 'Salesman ditambahkan', '', r.name]); return; }
    used[oi] = true;
    var o = a.rows[oi];
    if (o.name !== r.name) out.push([r.name, 'Nama salesman', o.name, r.name]);
    F.forEach(function (f) { var x = (o[f[0]] || {})[f[1]] || 0, y = (r[f[0]] || {})[f[1]] || 0; if (x !== y) out.push([r.name, f[2], x, y]); });
    P.forEach(function (f) {
      var x = (o.pay || {})[f[0]] || '', y = (r.pay || {})[f[0]] || '';
      if (f[0] === 'm') { x = METHODS[x] || x; y = METHODS[y] || y; }
      if (x !== y) out.push([r.name, f[1], x, y]);
    });
  });
  a.rows.forEach(function (o, i) { if (!used[i]) out.push([o.name, 'Salesman dihapus', o.name, '']); });
  return out;
}

/* ===================== VERIFIKASI → PDF =====================
 * PDF untuk finance hanya dibuat setelah admin mengubah Status menjadi
 * Diverifikasi / Disetujui / Dibayar (trigger onEdit terpasang saat setup).
 * Status dikembalikan ke Baru/Ditolak → PDF ditarik (dipindah ke Trash). */
function onStatusEdit(e) {
  try {
    var sh = e.range.getSheet();
    if (sh.getName() !== SHEET.data) return;
    var c = DATA_HEAD.indexOf('Status') + 1;
    if (e.range.getColumn() > c || e.range.getLastColumn() < c) return;
    var r0 = Math.max(e.range.getRow(), 2), r1 = e.range.getLastRow();
    for (var r = r0; r <= r1; r++) handleStatus_(e.source, r, r1 === r0 ? e.oldValue : '');
  } catch (err) {
    e.source.toast('Gagal memproses status: ' + err.message, 'Klaim Insentif', 10);
  }
}

function handleStatus_(ss, row, oldValue) {
  var sh = ss.getSheetByName(SHEET.data);
  var D = function (h) { return DATA_HEAD.indexOf(h) + 1; };
  var status = String(sh.getRange(row, D('Status')).getValue()).trim();
  var rec;
  try { rec = JSON.parse(sh.getRange(row, D('_data')).getValue()); } catch (e) { return; }
  var ok = VERIFIED.indexOf(status) >= 0, now = new Date(), who = userEmail_();
  var lsh = ss.getSheetByName(SHEET.log);
  if (lsh) lsh.appendRow([now, rec.id, who, '(klaim)', 'Status', oldValue || '', status]);

  if (ok) {
    if (!rec.verified) {
      rec.verified = {by: who, at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), status: status};
      sh.getRange(row, D('_data')).setValue(JSON.stringify(rec));
    }
    var need = false;
    FACTORIES.forEach(function (f) {
      var cell = sh.getRange(row, D('PDF ' + f));
      if (rec.claim.pay[f].list.length && !/^=HYPERLINK/i.test(cell.getFormula())) { cell.setValue(PDF_PENDING); need = true; }
    });
    if (need) {
      ss.toast('Klaim ' + rec.id + ' diverifikasi. PDF sedang dibuat…', 'Klaim Insentif', 8);
      SpreadsheetApp.flush();
      processPdfQueue();
    }
  } else {
    var pulled = false;
    FACTORIES.forEach(function (f) {
      var cell = sh.getRange(row, D('PDF ' + f));
      if (trashPdf_(cell)) pulled = true;
      cell.setValue(rec.claim.pay[f].list.length ? PDF_WAIT : '— (tidak ada)');
    });
    if (rec.verified) { delete rec.verified; sh.getRange(row, D('_data')).setValue(JSON.stringify(rec)); }
    if (pulled) ss.toast('Status ' + rec.id + ' menjadi "' + status + '". PDF ditarik ke Trash.', 'Klaim Insentif', 8);
  }
}

function isVerifiedRow_(ss, row) {
  if (!row || row < 2) return false;
  var v = ss.getSheetByName(SHEET.data).getRange(row, DATA_HEAD.indexOf('Status') + 1).getValue();
  return VERIFIED.indexOf(String(v).trim()) >= 0;
}

function findDataRow_(ss, id) {
  var sh = ss.getSheetByName(SHEET.data);
  if (sh.getLastRow() < 2) return 0;
  var ids = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

/** pindahkan PDF lama (dari rumus HYPERLINK di sel) ke Trash; true bila ada */
function trashPdf_(cell) {
  var m = String(cell.getFormula() || '').match(/\/d\/([\w-]{20,})/);
  if (!m) return false;
  try { DriveApp.getFileById(m[1]).setTrashed(true); return true; } catch (e) { return false; }
}

function userEmail_() {
  try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (e) { return ''; }
}

/* ===================== ANTRIAN PDF (di latar belakang) =====================
 * Submit langsung selesai (±2-3 detik). PDF dibuat oleh trigger sekali-jalan
 * ±1 menit kemudian, sehingga distributor tidak menunggu proses ekspor PDF. */
function schedulePdf_(ss, row, rec) {
  try {
    var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === PDF_HANDLER; });
    if (!exists) ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(30 * 1000).create();
  } catch (e) {
    writePdfLinks_(ss, row, rec); // cadangan: buat langsung bila trigger tidak bisa dibuat
  }
}

function processPdfQueue() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === PDF_HANDLER) ScriptApp.deleteTrigger(t); });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(60 * 1000).create(); return; }
  var started = Date.now(), leftover = false;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(SHEET.data);
    var last = sh.getLastRow();
    if (last < 2) return;
    var cS = DATA_HEAD.indexOf('PDF SHU'), cN = DATA_HEAD.indexOf('PDF NANA'), cD = DATA_HEAD.indexOf('_data');
    var vals = sh.getRange(2, 1, last - 1, DATA_HEAD.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      var needS = vals[i][cS] === PDF_PENDING, needN = vals[i][cN] === PDF_PENDING;
      if (!needS && !needN) continue;
      if (Date.now() - started > 4 * 60 * 1000) { leftover = true; break; }
      var rec;
      try { rec = JSON.parse(vals[i][cD]); } catch (e) { continue; }
      writePdfLinks_(ss, i + 2, rec, {SHU: needS, NANA: needN});
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }
  if (leftover) ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(30 * 1000).create();
}

/* ===================== PDF ===================== */
function writePdfLinks_(ss, row, rec, only) {
  var sh = ss.getSheetByName(SHEET.data);
  var cS = DATA_HEAD.indexOf('PDF SHU') + 1, cN = DATA_HEAD.indexOf('PDF NANA') + 1;
  FACTORIES.forEach(function (f) {
    if (only && !only[f]) return;
    var col = f === 'SHU' ? cS : cN;
    trashPdf_(sh.getRange(row, col));
    var P = rec.claim.pay[f];
    if (!P.list.length) { sh.getRange(row, col).setValue('— (tidak ada)'); return; }
    try {
      var file = makePdf_(ss, rec, f);
      sh.getRange(row, col).setFormula('=HYPERLINK("' + file.getUrl() + '","PDF ' + f + '")');
    } catch (e) {
      sh.getRange(row, col).setValue('Gagal: ' + e.message + ' (pakai menu Buat ulang PDF)');
    }
  });
}

function makePdf_(ss, rec, f) {
  var tmp = ss.insertSheet('tmp_' + rec.id + '_' + f + '_' + Date.now());
  try {
    var size = renderPrint_(tmp, rec, f);
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + tmp.getSheetId() +
      '&size=A4&portrait=false&scale=4&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED' +
      '&fzr=false&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4' +
      '&r1=0&c1=0&r2=' + size.rows + '&c2=' + size.cols;
    var resp, tries = 0;
    do {
      resp = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
      if (resp.getResponseCode() === 429) Utilities.sleep(3000 * (tries + 1));
    } while (resp.getResponseCode() === 429 && ++tries < 3);
    if (resp.getResponseCode() !== 200) throw new Error('export PDF ' + resp.getResponseCode());
    var name = rec.id + ' - ' + f + ' - ' + rec.input.distributor + ' - ' + rec.input.periode;
    return pdfFolder_().createFile(resp.getBlob().setName(name.replace(/[\\\/:*?"<>|]/g, ' ') + '.pdf'));
  } finally {
    ss.deleteSheet(tmp);
  }
}

function pdfFolder_() {
  var id = String(getSettings_().folderId || '').trim();
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('Klaim Insentif Salesman Class - PDF');
  setSetting_('folderId', folder.getId());
  return folder;
}

/* ===================== TEMPLATE CETAK ===================== */
function renderPrint_(sh, rec, f) {
  var C = rec.claim, I = rec.input, S = rec.settings, isShu = f === 'SHU';
  var N = 12;
  var P = C.pay[f];
  var green = '#0f5c4a', soft = '#e8f2ee', grey = '#f3f4f2';

  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  if (sh.getMaxColumns() < N) sh.insertColumnsAfter(sh.getMaxColumns(), N - sh.getMaxColumns());
  if (sh.getMaxColumns() > N) sh.deleteColumns(N + 1, sh.getMaxColumns() - N);
  sh.setHiddenGridlines(true);
  // Lebar kolom dinamis: menyesuaikan isian terpanjang (nama, bank/no. rek, cabang, a/n)
  var CH = 7, PADX = 16, LINE_H = 15, ROW_H = 21;
  var tw = function (s) { return String(s == null ? '' : s).split('\n').reduce(function (m, l) { return Math.max(m, l.length); }, 0) * CH + PADX; };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, Math.ceil(v))); };
  var maxOf = function (arr, fn) { return arr.reduce(function (m, x) { return Math.max(m, tw(fn(x))); }, 0); };
  var methodText = function (x) { return METHODS[x.m] + (x.rate ? ' (' + String(x.rate).replace('.', ',') + '%)' : ''); };
  var widths = [140, 150, 48, 92, 88, 88, 92, 56, 52, 82, 56, 88];
  var payName = function (x, j) { return (j + 1) + '. ' + x.name; };
  // kolom 1 = Salesman / Penerima, 2 = KPI / Metode, 3–5 = Bank / No. Rek, 6 = Cabang, 7–9 = A/N
  widths[0] = clamp(Math.max(maxOf(C.rows, function (x) { return x.name; }), maxOf(P.list.map(payName), function (s) { return s; })), 120, 230);
  widths[1] = Math.max(widths[1], clamp(maxOf(P.list, methodText), 0, 220));
  widths[3] += Math.max(0, clamp(maxOf(P.list, function (x) { return x.bank; }), 0, 340) - (widths[2] + widths[3] + widths[4]));
  widths[5] = Math.max(widths[5], clamp(maxOf(P.list, function (x) { return x.cab; }), 0, 180));
  widths[6] += Math.max(0, clamp(maxOf(P.list, function (x) { return x.an; }), 0, 320) - (widths[6] + widths[7] + widths[8]));
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  var spanW = function (c1, n) { var w = 0; for (var i = 0; i < n; i++) w += widths[c1 - 1 + i]; return w; };
  var linesFor = function (text, w) {
    return String(text == null ? '' : text).split('\n').reduce(function (a, l) { return a + Math.max(1, Math.ceil((l.length * CH) / Math.max(w - PADX, 20))); }, 0);
  };
  var fitRow = function (row, cells) { // cells: [[teks, kolom awal, jumlah kolom], ...] → tinggi baris ikut teks yang dibungkus
    var n = cells.reduce(function (m, c) { return Math.max(m, linesFor(c[0], spanW(c[1], c[2]))); }, 1);
    sh.getRange(row, 1, 1, N).setWrap(true).setVerticalAlignment('middle');
    sh.setRowHeight(row, Math.max(ROW_H, n * LINE_H + 6));
  };

  var r = 1;
  var put = function (row, c1, c2, val) { if (typeof val === 'string') val = cell_(val); var rg = sh.getRange(row, c1, 1, c2 - c1 + 1); if (c2 > c1) rg.merge(); rg.setValue(val); return rg; };

  put(r, 1, N, 'KLAIM INSENTIF SALESMAN DISTRIBUTOR (CLASS A/B)').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center').setFontColor(green);
  r++;
  put(r, 1, N, (isShu ? S.entShu : S.entNana) + ' (' + f + ')').setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
  r++;
  if (!rec.verified) put(r, 1, N, 'DRAFT — BELUM DIVERIFIKASI ADMIN · TIDAK UNTUK PEMBAYARAN').setFontWeight('bold').setFontColor('#b3261e').setHorizontalAlignment('center');
  sh.getRange(r, 1, 1, N).setBorder(null, null, true, null, null, null, green, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  r += 2;

  // Info klaim (2 kolom)
  var mid = Math.floor(N / 2);
  var info = [['No. Klaim', rec.id, 'Periode', I.periode],
              ['Distributor', I.distributor, 'Diajukan oleh', I.pengaju + (I.kontak ? ' (' + I.kontak + ')' : '')],
              ['Area', I.area || '-', 'Tanggal submit', rec.submittedAt]];
  if (rec.revisions && rec.revisions.length) {
    var lr = rec.revisions[rec.revisions.length - 1];
    info.push(['Status data', 'Dikoreksi admin (revisi ke-' + rec.revisions.length + ', ' + lr.at + ')',
      'Total awal', 'Rp ' + fmtNum_(rec.original ? rec.original.total : 0)]);
  }
  if (rec.verified) info.push(['Diverifikasi', (rec.verified.by || 'admin') + ' · ' + rec.verified.at, 'Status', rec.verified.status || 'Diverifikasi']);
  info.forEach(function (x) {
    put(r, 1, 1, x[0]).setFontWeight('bold');
    put(r, 2, mid, ': ' + x[1]);
    put(r, mid + 1, mid + 2, x[2]).setFontWeight('bold');
    put(r, mid + 3, N, ': ' + x[3]);
    fitRow(r, [[': ' + x[1], 2, mid - 1], [': ' + x[3], mid + 3, N - mid - 2]]);
    r++;
  });
  r++;

  // A. Rincian target, realisasi & pencapaian KPI
  put(r, 1, N, 'A. RINCIAN TARGET, REALISASI & PENCAPAIAN KPI — ' + f).setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  r++;
  var h1 = r;
  sh.getRange(r, 1, 1, N).setValues([['Salesman', 'KPI', 'Bobot', 'Target', 'Real SHU', 'Real NANA', 'Real Total', 'Ach', 'Skor', 'Insentif KPI', 'Beban ' + f, 'Insentif ' + f]])
    .setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(true);
  r++;
  var gInc = 0, gF = 0, firstData = r, lowAch = [];
  C.rows.forEach(function (row) {
    var top = r, lines = [], okRow = row.ok !== undefined ? row.ok : row.gate;
    KPIS.forEach(function (k) {
      var x = row.kpi[k.key];
      if (!x || !x.active) return;
      if (x.ach < MIN_ACH) lowAch.push(r + lines.length);
      lines.push(['', k.label + ' (' + String(k.unit).replace('Value (Rp)', 'Rp') + ')' + (x.owner !== 'split' ? ' · ' + x.owner : ''), x.w, x.t,
        x.owner === 'NANA' ? '—' : x.s, x.owner === 'SHU' ? '—' : x.n, x.tot, x.ach, okRow ? x.pts : 0, x.inc,
        isShu ? x.cShu : x.cNana, isShu ? x.incShu : x.incNana]);
    });
    var incAll = row.shu + row.nana, incF = isShu ? row.shu : row.nana;
    lines.push(['', 'Subtotal', '', '', '', '', '', '', okRow ? row.score : 0, incAll, '', incF]);
    gInc += incAll; gF += incF;
    sh.getRange(r, 1, lines.length, N).setValues(lines);
    var desc = cell_(row.name) + '\n' + (row.cls ? 'Class ' + row.cls + ' · Rp ' + fmtNum_(row.nom) : 'Di bawah Class A (tanpa insentif)') + (row.gate ? '' : '\n[Sell Out < 90% — insentif gugur]');
    sh.getRange(top, 1, lines.length, 1).merge().setValue(desc).setWrap(true).setVerticalAlignment('top').setFontWeight('bold');
    sh.getRange(top + lines.length - 1, 2, 1, N - 1).setFontWeight('bold').setBackground('#f7f8f6');
    r += lines.length;
  });
  if (r > firstData) {
    var n = r - firstData;
    [[3, '0%'], [4, '#,##0'], [5, '#,##0'], [6, '#,##0'], [7, '#,##0'], [8, '0.0%'], [9, '0.0%'], [10, '#,##0'], [11, '0%'], [12, '#,##0']].forEach(function (x) {
      sh.getRange(firstData, x[0], n, 1).setNumberFormat(x[1]).setHorizontalAlignment('right');
    });
    lowAch.forEach(function (rr) { sh.getRange(rr, 8).setFontColor('#b3261e'); });
  }
  var totRow = ['TOTAL', '', '', '', '', '', '', '', '', gInc, '', gF];
  sh.getRange(r, 1, 1, N).setValues([totRow]).setFontWeight('bold').setBackground(grey);
  sh.getRange(r, 10, 1, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(h1, 1, r - h1 + 1, N).setBorder(true, true, true, true, true, true, '#9aa09c', SpreadsheetApp.BorderStyle.SOLID);
  sh.getRange(h1 + 1, 1, r - h1 + 1, N).setFontSize(9);
  r += 1;
  put(r, 1, N, 'Ach = Real Total ÷ Target. Skor = Bobot × pencapaian (dihitung bila ≥ 90%, maks. 100%). Ach merah = di bawah 90%. Beban = porsi insentif KPI yang ditanggung ' + f + '.').setFontSize(8).setFontColor('#555555').setFontStyle('italic').setWrap(true);
  r += 2;

  // B. Pembayaran
  put(r, 1, N, 'B. RINCIAN PEMBAYARAN INSENTIF — ' + f).setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  r++;
  var spans = [1, 1, 3, 1, 3, 1, 1, 1];
  var payHead = ['Penerima', 'Metode', 'Bank / No. Rek', 'Cabang', 'A/N', 'Nominal', 'Pajak', 'Nominal Diterima'];
  var putSpans = function (row, vals) {
    var cc = 1;
    vals.forEach(function (v, j) { put(row, cc, cc + spans[j] - 1, v); cc += spans[j]; });
  };
  var ph = r;
  putSpans(r, payHead);
  sh.getRange(r, 1, 1, N).setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setWrap(true);
  r++;
  var payFirst = r;
  P.list.forEach(function (x, j) {
    putSpans(r, [payName(x, j), methodText(x), x.bank || '', x.cab || '', x.an || '', x.nom, x.tax || 0, x.net]);
    fitRow(r, [[payName(x, j), 1, 1], [methodText(x), 2, 1], [x.bank, 3, 3], [x.cab, 6, 1], [x.an, 7, 3]]);
    r++;
  });
  if (!P.list.length) { put(r, 1, N, 'Tidak ada insentif ' + f + ' yang dibayarkan.').setFontStyle('italic'); r++; }
  putSpans(r, ['TOTAL', '', '', '', '', P.nom, P.tax, P.net]);
  sh.getRange(r, 1, 1, N).setFontWeight('bold').setBackground(grey);
  sh.getRange(payFirst, N - 2, r - payFirst + 1, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(payFirst, 1, r - payFirst + 1, 5).setHorizontalAlignment('left');
  sh.getRange(ph, 1, r - ph + 1, N).setBorder(true, true, true, true, true, true, '#9aa09c', SpreadsheetApp.BorderStyle.SOLID);
  r++;
  put(r, 1, N, 'Terbilang: ' + terbilang_(P.net) + ' rupiah').setFontStyle('italic').setFontWeight('bold');
  r += 2;

  // Catatan
  var notes = [
    'Catatan perhitungan:',
    '• Bobot KPI: Sell Out 40%, RO 25%, SKU 2000 35%.',
    '• Class A: target Sell Out Rp ' + fmtNum_(S.classAMin) + ' – < Rp ' + fmtNum_(S.classBMin) + ', insentif 100% = Rp ' + fmtNum_(S.nomA) + '. Class B: target ≥ Rp ' + fmtNum_(S.classBMin) + ', insentif 100% = Rp ' + fmtNum_(S.nomB) + '. Target di bawah Class A tidak mendapat insentif.',
    '• Sell Out < 90% = insentif gugur; KPI lain < 90% = skor 0; pencapaian > 100% dihitung 100%; prorate sesuai pencapaian.',
    '• Pembebanan: Sell Out & SKU 2000 dibagi SHU/NANA sesuai kontribusi realisasi masing-masing; RO ditanggung NANA.',
    '• Pajak: rekening sendiri < Rp ' + fmtNum_(S.ownThr) + ' = 0%; titip 1 rekening dengan kumulatif ≥ Rp ' + fmtNum_(S.titipThr) + ' = ' + String(S.titipRate).replace('.', ',') + '% per orang; rekening a.n. perusahaan = ' + String(S.coRate).replace('.', ',') + '%.'
  ];
  if (P.titipSum > 0) notes.push('• Kumulatif titip rekening ' + f + ' pada klaim ini: Rp ' + fmtNum_(P.titipSum) + (P.titipOn ? ' → dipotong pajak.' : ' → tidak dipotong pajak.'));
  notes.forEach(function (t, j) { put(r, 1, N, t).setFontSize(8).setFontColor('#555555').setWrap(true).setFontWeight(j ? 'normal' : 'bold'); r++; });
  r++;

  // Tanda tangan
  var sig = [4, 4, 4];
  var roles = [['Diperiksa oleh,', 'Data Analyst'], ['Disetujui oleh,', 'Head of Sales'], ['Diterima oleh,', 'Finance']];
  var cc = 1;
  roles.forEach(function (ro, j) {
    put(r, cc, cc + sig[j] - 1, ro[0]).setHorizontalAlignment('center');
    put(r + 5, cc, cc + sig[j] - 1, '(____________________________________)').setHorizontalAlignment('center');
    put(r + 6, cc, cc + sig[j] - 1, ro[1]).setHorizontalAlignment('center').setFontWeight('bold');
    cc += sig[j];
  });
  for (var sr = r + 1; sr <= r + 4; sr++) sh.setRowHeight(sr, 24); // ruang tanda tangan lebih lega
  r += 6;

  sh.getRange(1, 1, r, N).setFontFamily('Arial');
  sh.getRange(6, 1, r - 5, N).setFontSize(9);
  sh.setFrozenRows(0);
  return {rows: r, cols: N};
}

function fmtNum_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

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
    if (x < 1e12) return t(Math.floor(x / 1e9)) + ' miliar ' + t(x % 1e9);
    return t(Math.floor(x / 1e12)) + ' triliun ' + t(x % 1e12);
  };
  var out = n === 0 ? 'nol' : t(n).replace(/\s+/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
