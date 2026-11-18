/**
 * FORM KLAIM INSENTIF DISTRIBUTOR (PER KUARTAL) — Google Apps Script
 * ------------------------------------------------------------------
 * Pasang di Google Sheet admin tersendiri (Extensions > Apps Script).
 * Alur: distributor isi target & actual per kuartal → sistem hitung insentif (group dihitung gabungan)
 *       → admin verifikasi → PDF klaim terpisah SHU & NANA untuk finance.
 */

var SHEET = {data: 'Data Klaim', mem: 'Data Anggota', rcp: 'Data Penerima', dist: 'Daftar Distributor', set: 'Pengaturan', print: 'Cetak', log: 'Log Revisi'};
var TZ = 'Asia/Jakarta';
var STATUS = ['Baru', 'Diverifikasi', 'Disetujui', 'Dibayar', 'Ditolak'];
var VERIFIED = ['Diverifikasi', 'Disetujui', 'Dibayar'];
var PDF_PENDING = 'Menunggu PDF…', PDF_WAIT = 'Menunggu verifikasi';
var PDF_HANDLER = 'processPdfQueue', STATUS_HANDLER = 'onStatusEdit';
var EDIT_MARK = '#fff3c4';
var LAIN = '__lain__';

var SETTINGS = [
  ['Insentif maksimal (% dari actual sell out)', 1, 'basePct'],
  ['Bonus tambahan (% dari actual sell out)', 0.5, 'bonusPct'],
  ['Syarat bonus: pencapaian sell out di atas (%)', 110, 'bonusThr'],
  ['Syarat insentif: pencapaian sell in minimal (%)', 100, 'minSI'],
  ['KPI sell out dihitung bila pencapaian minimal (%)', 100, 'minSO'],
  ['Bobot KPI Sell Out (%)', 80, 'wSO'],
  ['Bobot KPI AO SKU 2000 (%)', 10, 'wAO2000'],
  ['Bobot KPI AO GC (%)', 10, 'wAOGC'],
  ['Porsi Owner (%) — sisanya untuk PIC', 70, 'ownerShare'],
  ['Kuartal yang dibuka untuk klaim (YYYY-Qn, pisahkan koma)', '2026-Q4', 'quarters'],
  ['Batas rekening sendiri tanpa pajak (Rp)', 500000, 'ownThr'],
  ['Batas kumulatif titip rekening per factory (Rp)', 5000000, 'titipThr'],
  ['Pajak titip rekening (%)', 2.5, 'titipRate'],
  ['Pajak rekening perusahaan (%)', 15, 'coRate'],
  ['Nama entitas SHU', 'CV Sumber Harum Utama', 'entShu'],
  ['Nama entitas NANA', 'CV Nana Abadi', 'entNana'],
  ['Izinkan distributor yang tidak ada di Daftar Distributor (YA / TIDAK)', 'YA', 'allowOther'],
  ['Kode akses form (kosongkan jika tanpa kode)', '', 'code'],
  ['Form menerima klaim (YA / TIDAK)', 'YA', 'open'],
  ['ID folder PDF (terisi otomatis)', '', 'folderId']
];
var NUM_KEYS = ['basePct', 'bonusPct', 'bonusThr', 'minSI', 'minSO', 'wSO', 'wAO2000', 'wAOGC', 'ownerShare', 'ownThr', 'titipThr', 'titipRate', 'coRate'];
var DIST_SEED = [
  ['Ananta Tegal', 'Ananta Tegal & Pekalongan', 'YA'],
  ['Ananta Pekalongan', 'Ananta Tegal & Pekalongan', 'YA'],
  ['Aldi Jaya Tuban', 'Aldi Jaya Tuban & Lamongan', 'YA'],
  ['Aldi Jaya Lamongan', 'Aldi Jaya Tuban & Lamongan', 'YA'],
  ['SAJ Gresik', 'SAJ Group', 'YA'],
  ['SAJ Bangkalan', 'SAJ Group', 'YA'],
  ['SAJ Mojokerto', 'SAJ Group', 'YA'],
  ['SAJ Pamekasan', 'SAJ Group', 'YA']
];

var DATA_HEAD = ['ID Klaim', 'Waktu Submit', 'Distributor / Group', 'Anggota', 'Periode', 'Diajukan Oleh', 'Kontak',
  'Target SO', 'Actual SO', 'Ach SO', 'Target SI', 'Actual SI', 'Ach SI', 'Ach AO 2000', 'Ach AO GC', 'Skor KPI',
  'Insentif KPI', 'Bonus', 'Total Insentif', 'Insentif SHU', 'Insentif NANA', 'Pajak', 'Diterima',
  'Status', 'PDF SHU', 'PDF NANA', 'Catatan Admin', '_data'];
var MEM_HEAD = ['ID Klaim', 'Periode', 'Distributor / Group', 'Distributor', 'Target SO', 'Actual SO SHU', 'Actual SO NANA',
  'Target Sell In', 'Actual Sell In SHU', 'Actual Sell In NANA', 'Target AO 2000', 'Actual AO 2000 (NANA)', 'Target AO GC', 'Actual AO GC (SHU)'];
var RCP_HEAD = ['ID Klaim', 'Periode', 'Distributor / Group', 'Peran', 'Nama', 'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N',
  'Insentif SHU', 'Pajak SHU', 'Diterima SHU', 'Insentif NANA', 'Pajak NANA', 'Diterima NANA'];
var DIST_HEAD = ['Distributor', 'Group (kosongkan bila dihitung sendiri)', 'Aktif (YA/TIDAK)'];
var LOG_HEAD = ['Waktu', 'ID Klaim', 'Admin', 'Distributor / Penerima', 'Kolom', 'Nilai Lama', 'Nilai Baru'];
var DATA_EDITABLE = ['Diajukan Oleh', 'Kontak'];
var MEM_EDITABLE = ['Target SO', 'Actual SO SHU', 'Actual SO NANA', 'Target Sell In', 'Actual Sell In SHU', 'Actual Sell In NANA', 'Target AO 2000', 'Actual AO 2000 (NANA)', 'Target AO GC', 'Actual AO GC (SHU)'];
var RCP_EDITABLE = ['Nama', 'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N'];
var MEM_FIELDS = [['so', 't', 'Target SO'], ['so', 's', 'Actual SO SHU'], ['so', 'n', 'Actual SO NANA'], ['si', 't', 'Target Sell In'], ['si', 's', 'Actual Sell In SHU'], ['si', 'n', 'Actual Sell In NANA'],
  ['ao2k', 't', 'Target AO 2000'], ['ao2k', 'a', 'Actual AO 2000 (NANA)'], ['aogc', 't', 'Target AO GC'], ['aogc', 'a', 'Actual AO GC (SHU)']];

/* ===== LOGIKA INSENTIF DISTRIBUTOR PER KUARTAL (dipakai sama persis di server & form) ===== */
var METHODS = {own:'Rekening sendiri', titip:'Titip 1 rekening', co:'Rekening perusahaan'};
var FACTORIES = ['SHU', 'NANA'];
var QMONTHS = {1:'Jan–Mar', 2:'Apr–Jun', 3:'Jul–Sep', 4:'Okt–Des'};
var MKPI = [
  {key:'so',   label:'Sell Out',   unit:'Rp'},
  {key:'si',   label:'Sell In',    unit:'Rp'},
  {key:'ao2k', label:'AO SKU 2000', unit:'Outlet'},
  {key:'aogc', label:'AO GC',      unit:'Outlet'}
];
function quarterLabel(q) { var m = /^(\d{4})-Q([1-4])$/.exec(q || ''); return m ? 'Q' + m[2] + ' ' + m[1] + ' (' + QMONTHS[+m[2]] + ')' : String(q || ''); }

/**
 * input: {members:[{dist, so:{t,s,n}, si:{t,s,n}, ao2k:{t,a}, aogc:{t,a}}], recipients:[{role, name, pay}]}
 *   so.s / so.n = actual sell out SHU / NANA; si.s / si.n = actual sell in SHU / NANA
 * Pembebanan: KPI Sell Out & bonus dibagi sesuai kontribusi actual sell out SHU/NANA; KPI AO 2000 → NANA; KPI AO GC → SHU.
 * Pencapaian dihitung dari TOTAL seluruh anggota (group dihitung gabungan, dibayar satu nominal).
 */
function computeDist(input, S) {
  var P = function (k, d) { var v = Number(S[k]); return isFinite(v) && v !== 0 ? v : d; };
  var wSO = P('wSO', 80) / 100, wA2 = P('wAO2000', 10) / 100, wGC = P('wAOGC', 10) / 100;
  var minSI = P('minSI', 100) / 100, minSO = P('minSO', 100) / 100, bonusThr = P('bonusThr', 110) / 100;
  var basePct = P('basePct', 1), bonusPct = P('bonusPct', 0.5), ownerShare = P('ownerShare', 70);
  var t = {so: {t: 0, s: 0, n: 0}, si: {t: 0, s: 0, n: 0}, ao2k: {t: 0, a: 0}, aogc: {t: 0, a: 0}};
  var members = (input.members || []).map(function (m) {
    var g = function (o, k) { return Number((o || {})[k]) || 0; };
    var x = {dist: m.dist, so: {t: g(m.so, 't'), s: g(m.so, 's'), n: g(m.so, 'n')}, si: {t: g(m.si, 't'), s: g(m.si, 's'), n: g(m.si, 'n')},
      ao2k: {t: g(m.ao2k, 't'), a: g(m.ao2k, 'a')}, aogc: {t: g(m.aogc, 't'), a: g(m.aogc, 'a')}};
    x.so.a = x.so.s + x.so.n; x.si.a = x.si.s + x.si.n;
    ['so', 'si'].forEach(function (k) { t[k].t += x[k].t; t[k].s += x[k].s; t[k].n += x[k].n; });
    ['ao2k', 'aogc'].forEach(function (k) { t[k].t += x[k].t; t[k].a += x[k].a; });
    MKPI.forEach(function (k) { x[k.key].ach = x[k.key].t > 0 ? x[k.key].a / x[k.key].t : 0; });
    return x;
  });
  t.so.a = t.so.s + t.so.n; t.si.a = t.si.s + t.si.n;
  MKPI.forEach(function (k) { t[k.key].ach = t[k.key].t > 0 ? t[k.key].a / t[k.key].t : 0; });

  var gate = t.si.t > 0 && t.si.ach >= minSI - 1e-9;
  var soOk = t.so.t > 0 && t.so.ach >= minSO - 1e-9;
  var kpi = [
    {key: 'so',   label: 'Sell Out',    w: wSO, ach: t.so.ach,   counted: soOk ? 1 : 0, rule: 'dihitung bila ≥ ' + Math.round(minSO * 100) + '%'},
    {key: 'ao2k', label: 'AO SKU 2000', w: wA2, ach: t.ao2k.ach, counted: t.ao2k.t > 0 ? Math.min(t.ao2k.ach, 1) : 0, rule: 'prorate, maks 100%'},
    {key: 'aogc', label: 'AO GC',       w: wGC, ach: t.aogc.ach, counted: t.aogc.t > 0 ? Math.min(t.aogc.ach, 1) : 0, rule: 'prorate, maks 100%'}
  ];
  kpi.forEach(function (k) { k.pts = gate ? k.w * k.counted : 0; });
  var score = kpi.reduce(function (a, k) { return a + k.pts; }, 0);
  var base = Math.round(t.so.a * basePct / 100);
  var comp = {so: Math.round(base * kpi[0].pts), ao2k: Math.round(base * kpi[1].pts), aogc: Math.round(base * kpi[2].pts)};
  var kpiInc = comp.so + comp.ao2k + comp.aogc;
  var bonusOn = gate && t.so.t > 0 && t.so.ach > bonusThr + 1e-9;
  var bonus = bonusOn ? Math.round(t.so.a * bonusPct / 100) : 0;
  var total = kpiInc + bonus;
  var cShu = t.so.a > 0 ? t.so.s / t.so.a : 0.5;
  // pembebanan per factory
  var alloc = {SHU: {so: Math.round(comp.so * cShu), ao2k: 0, aogc: comp.aogc, bonus: Math.round(bonus * cShu)}};
  alloc.NANA = {so: comp.so - alloc.SHU.so, ao2k: comp.ao2k, aogc: 0, bonus: bonus - alloc.SHU.bonus};
  var fac = {};
  FACTORIES.forEach(function (f) { var a = alloc[f]; fac[f] = a.so + a.ao2k + a.aogc + a.bonus; });

  var recips = (input.recipients || []).map(function (r) { return {role: r.role, name: r.name || '', pay: r.pay || {m: 'own'}}; });
  var pay = {};
  FACTORIES.forEach(function (f) {
    var F = fac[f], list = [];
    recips.forEach(function (r, i) {
      var share = r.role === 'Owner' ? ownerShare : 100 - ownerShare;
      var nom = r.role === 'Owner' ? Math.round(F * share / 100) : F - Math.round(F * ownerShare / 100);
      var p = r.pay || {};
      if (nom > 0) list.push({i: i, role: r.role, name: r.name, share: share, m: METHODS[p.m] ? p.m : 'own', bank: p.bank || '', cab: p.cab || '', an: p.an || '', nom: nom});
    });
    var titipSum = list.filter(function (x) { return x.m === 'titip'; }).reduce(function (a, x) { return a + x.nom; }, 0);
    var titipOn = titipSum > 0 && titipSum >= Number(S.titipThr);
    var agg = {nom: 0, tax: 0, net: 0};
    list.forEach(function (x) {
      x.rate = x.m === 'co' ? Number(S.coRate) : x.m === 'titip' ? (titipOn ? Number(S.titipRate) : 0) : 0;
      x.tax = Math.round(x.nom * x.rate / 100); x.net = x.nom - x.tax; x.flag = x.m === 'own' && x.nom >= Number(S.ownThr);
      agg.nom += x.nom; agg.tax += x.tax; agg.net += x.net;
    });
    pay[f] = {list: list, titipSum: titipSum, titipOn: titipOn, nom: agg.nom, tax: agg.tax, net: agg.net, contrib: f === 'SHU' ? cShu : 1 - cShu, share: total > 0 ? fac[f] / total : 0};
  });
  return {members: members, tot: t, gate: gate, soOk: soOk, kpi: kpi, score: score, base: base, comp: comp, alloc: alloc, cShu: cShu, kpiInc: kpiInc, bonusOn: bonusOn, bonus: bonus,
    total: total, fac: fac, pay: pay, totalNet: pay.SHU.net + pay.NANA.net, ownerShare: ownerShare,
    pct: {base: basePct, bonus: bonusPct, bonusThr: bonusThr, minSI: minSI, minSO: minSO}};
}
/* ===== akhir logika insentif distributor ===== */


/* ===================== WEB APP ===================== */
function doGet(e) {
  if (e && e.parameter && e.parameter.fn === 'getPublicSettings') {
    try { return apiOut_({ok: true, data: getPublicSettings()}); } catch (err) { return apiOut_({ok: false, error: String(err.message || err)}); }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Form Klaim Insentif Distributor')
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
  var S = getSettings_(), o = {};
  NUM_KEYS.forEach(function (k) { o[k] = S[k]; });
  o.quarters = quarters_(S); o.entShu = String(S.entShu || ''); o.entNana = String(S.entNana || '');
  o.allowOther = yes_(S.allowOther); o.needCode = !!String(S.code || '').trim(); o.open = yes_(S.open); o.entries = distEntries_();
  return JSON.parse(JSON.stringify(o));
}
function quarters_(S) { return String(S.quarters || '').split(',').map(function (q) { return q.trim().toUpperCase(); }).filter(function (q) { return /^\d{4}-Q[1-4]$/.test(q); }); }

function distEntries_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.dist), groups = {}, out = [];
  var vals = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues() : DIST_SEED;
  vals.forEach(function (v) {
    var d = String(v[0]).trim(), g = String(v[1]).trim();
    if (!d || String(v[2]).trim().toUpperCase() === 'TIDAK') return;
    if (g) { if (!groups[g]) { groups[g] = {key: 'G:' + g, label: g, members: [], group: true}; out.push(groups[g]); } groups[g].members.push(d); }
    else out.push({key: 'D:' + d, label: d, members: [d], group: false});
  });
  return out.sort(function (a, b) { return a.label < b.label ? -1 : 1; });
}

function submitKlaim(payload) {
  var S = getSettings_();
  if (!yes_(S.open)) throw new Error('Form sedang tidak menerima klaim. Hubungi admin.');
  var code = String(S.code || '').trim();
  if (code && String((payload && payload.code) || '').trim() !== code) throw new Error('Kode akses salah.');
  var input = sanitize_(payload, S);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var dup = findDuplicate_(ss, input.groupLabel, input.periodeLabel);
    if (dup) throw new Error('Klaim ' + input.groupLabel + ' ' + input.periodeLabel + ' sudah diajukan (' + dup + '). Hubungi admin bila perlu revisi.');
    var C = computeDist(input, S), now = new Date(), sh = ss.getSheetByName(SHEET.data), id = nextId_(sh, now, input.periode);
    var rec = {id: id, submittedAt: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), head: headOf_(input), settings: pubSettings_(S),
      snapshot: snap_(input), totals: totalsOf_(C)};
    sh.appendRow(dataRow_(id, now, input, C, rec));
    writeMembers_(ss, id, input);
    writeRecipients_(ss, id, input, C);
    SpreadsheetApp.flush();
    return {id: id, total: C.total, totalNet: C.totalNet, score: C.score, gate: C.gate, bonus: C.bonus};
  } finally { lock.releaseLock(); }
}

function dataRow_(id, now, input, C, rec) {
  var t = C.tot;
  return [id, now, cell_(input.groupLabel), cell_(input.members.map(function (m) { return m.dist; }).join(', ')), input.periodeLabel,
    cell_(input.pengaju), cell_(input.kontak), t.so.t, t.so.a, t.so.ach, t.si.t, t.si.a, t.si.ach, t.ao2k.ach, t.aogc.ach, C.score,
    C.kpiInc, C.bonus, C.total, C.fac.SHU, C.fac.NANA, C.pay.SHU.tax + C.pay.NANA.tax, C.totalNet, 'Baru',
    C.pay.SHU.list.length ? PDF_WAIT : '— (tidak ada)', C.pay.NANA.list.length ? PDF_WAIT : '— (tidak ada)', '', JSON.stringify(rec)];
}
function writeMembers_(ss, id, input) {
  var sh = ss.getSheetByName(SHEET.mem);
  var vals = input.members.map(function (m) {
    return [id, input.periodeLabel, cell_(input.groupLabel), cell_(m.dist), m.so.t, m.so.s, m.so.n, m.si.t, m.si.s, m.si.n, m.ao2k.t, m.ao2k.a, m.aogc.t, m.aogc.a];
  });
  sh.getRange(sh.getLastRow() + 1, 1, vals.length, MEM_HEAD.length).setValues(vals);
}
function recipientVals_(id, input, C) {
  return input.recipients.map(function (r, i) {
    var a = findPay_(C.pay.SHU.list, i), b = findPay_(C.pay.NANA.list, i), p = r.pay || {};
    return [id, input.periodeLabel, cell_(input.groupLabel), r.role, cell_(r.name), METHODS[p.m] || METHODS.own, cell_(p.bank), cell_(p.cab), cell_(p.an),
      a ? a.nom : 0, a ? a.tax : 0, a ? a.net : 0, b ? b.nom : 0, b ? b.tax : 0, b ? b.net : 0];
  });
}
function writeRecipients_(ss, id, input, C, rowNos) {
  var sh = ss.getSheetByName(SHEET.rcp), vals = recipientVals_(id, input, C);
  if (rowNos) vals.forEach(function (v, j) { sh.getRange(rowNos[j], 1, 1, v.length).setValues([v]).setBackground(null); });
  else sh.getRange(sh.getLastRow() + 1, 1, vals.length, RCP_HEAD.length).setValues(vals);
}

function findDuplicate_(ss, groupLabel, periodeLabel, excludeId) {
  var sh = ss.getSheetByName(SHEET.data);
  if (sh.getLastRow() < 2) return '';
  var D = function (h) { return DATA_HEAD.indexOf(h); }, key = normDist_(groupLabel), hit = '';
  sh.getRange(2, 1, sh.getLastRow() - 1, DATA_HEAD.length).getValues().forEach(function (v) {
    if (!hit && v[0] !== excludeId && normDist_(v[D('Distributor / Group')]) === key && String(v[D('Periode')]) === periodeLabel && String(v[D('Status')]).trim() !== 'Ditolak') hit = v[0];
  });
  return hit;
}

/* ===================== MENU ADMIN ===================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Insentif Distributor')
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
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  var sh = ss.getSheetByName(SHEET.print) || ss.insertSheet(SHEET.print);
  renderPrint_(sh, loadClaim_(ss, id), f);
  ss.setActiveSheet(sh);
  note_('Klaim ' + id + ' (' + f + ') siap di sheet Cetak. File > Print: Current sheet, Landscape, Fit to width.');
}
function regenPdfSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  var row = findDataRow_(ss, id);
  if (!isVerifiedRow_(ss, row)) { note_('Klaim ' + id + ' belum diverifikasi. Ubah Status menjadi "Diverifikasi" — PDF dibuat otomatis.'); return; }
  writePdfLinks_(ss, row, id);
  note_('PDF klaim ' + id + ' sudah dibuat ulang.');
}
function recalcSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  note_('Menghitung ulang ' + id + '…');
  try {
    var r = recalcClaim_(ss, id);
    note_(id + ' dihitung ulang. Total insentif ' + fmtNum_(r.before) + ' → ' + fmtNum_(r.after) + '.' +
      (isVerifiedRow_(ss, findDataRow_(ss, id)) ? ' PDF diperbarui.' : ' PDF dibuat setelah status Diverifikasi.'));
  } catch (e) { note_('Gagal menghitung ulang ' + id + ': ' + e.message); }
}
function selectedId_(ss) {
  var sh = ss.getActiveSheet();
  if ([SHEET.data, SHEET.mem, SHEET.rcp].indexOf(sh.getName()) < 0) { note_('Buka sheet Data Klaim / Data Anggota / Data Penerima, lalu klik baris klaimnya.'); return ''; }
  var row = sh.getActiveRange().getRow();
  if (row < 2) { note_('Klik baris klaim (bukan baris judul).'); return ''; }
  var id = String(sh.getRange(row, 1).getValue()).trim();
  if (!id) note_('Baris ini tidak memiliki ID Klaim.');
  return id;
}

/* ===================== MUAT & HITUNG ULANG DARI SHEET ===================== */
function loadClaim_(ss, id) {
  var dsh = ss.getSheetByName(SHEET.data), row = findDataRow_(ss, id);
  if (!row) throw new Error('ID ' + id + ' tidak ditemukan.');
  var d = dsh.getRange(row, 1, 1, DATA_HEAD.length).getValues()[0], D = function (h) { return DATA_HEAD.indexOf(h); };
  var rec = JSON.parse(d[D('_data')]);
  var M = function (h) { return MEM_HEAD.indexOf(h); }, R = function (h) { return RCP_HEAD.indexOf(h); };
  var inv = {}; Object.keys(METHODS).forEach(function (k) { inv[METHODS[k]] = k; });
  var mem = rowsFor_(ss.getSheetByName(SHEET.mem), MEM_HEAD, id), rcp = rowsFor_(ss.getSheetByName(SHEET.rcp), RCP_HEAD, id);
  var input = {groupLabel: rec.head.groupLabel, periode: rec.head.periode, periodeLabel: rec.head.periodeLabel,
    pengaju: str_(d[D('Diajukan Oleh')], 80), kontak: str_(d[D('Kontak')], 60),
    members: mem.map(function (s) {
      var v = s.v, m = {dist: String(v[M('Distributor')]).trim(), so: {}, si: {}, ao2k: {}, aogc: {}, _row: s.row};
      MEM_FIELDS.forEach(function (f) { m[f[0]][f[1]] = num_(v[M(f[2])]); });
      return m;
    }),
    recipients: rcp.map(function (s) {
      var v = s.v;
      return {role: String(v[R('Peran')]).trim(), name: str_(v[R('Nama')], 80), _row: s.row,
        pay: {m: inv[String(v[R('Metode Bayar')]).trim()] || 'own', bank: str_(v[R('Bank / No. Rek')], 80), cab: str_(v[R('Cabang')], 60), an: str_(v[R('A/N')], 80)}};
    })};
  return {id: id, row: row, rec: rec, input: input, claim: computeDist(input, rec.settings)};
}

function recalcClaim_(ss, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var L, before;
  try {
    L = loadClaim_(ss, id);
    var rec = L.rec, C = L.claim, input = L.input, now = new Date(), who = userEmail_(), logs = [];
    before = rec.totals.total;
    (rec.snapshot.members || []).forEach(function (o) {
      var n = input.members.filter(function (m) { return m.dist === o.dist; })[0];
      if (!n) return;
      MEM_FIELDS.forEach(function (f) { var a = (o[f[0]] || {})[f[1]] || 0, b = n[f[0]][f[1]] || 0; if (a !== b) logs.push([now, id, who, cell_(n.dist), f[2], a, b]); });
    });
    (rec.snapshot.recipients || []).forEach(function (o, i) {
      var n = input.recipients[i]; if (!n) return;
      if ((o.name || '') !== n.name) logs.push([now, id, who, o.role, 'Nama', cell_(o.name), cell_(n.name)]);
      ['m', 'bank', 'cab', 'an'].forEach(function (k) { var a = (o.pay || {})[k] || '', b = n.pay[k] || ''; if (a !== b) logs.push([now, id, who, o.role, 'Bayar: ' + k, cell_(a), cell_(b)]); });
    });
    logs.push([now, id, who, '(klaim)', 'Total insentif', before, C.total]);
    if (!rec.original) rec.original = {totals: rec.totals};
    rec.totals = totalsOf_(C); rec.snapshot = snap_(input);
    rec.revisions = (rec.revisions || []).concat([{at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), by: who}]);
    var msh = ss.getSheetByName(SHEET.mem);
    input.members.forEach(function (m) { msh.getRange(m._row, 1, 1, MEM_HEAD.length).setBackground(null); });
    writeRecipients_(ss, id, input, C, input.recipients.map(function (r) { return r._row; }));
    var dsh = ss.getSheetByName(SHEET.data), D = function (h) { return DATA_HEAD.indexOf(h) + 1; };
    var row = dataRow_(id, dsh.getRange(L.row, 2).getValue(), input, C, rec);
    var keep = [D('Status'), D('PDF SHU'), D('PDF NANA'), D('Catatan Admin')];
    var first = D('Target SO'), last = D('Diterima');
    dsh.getRange(L.row, first, 1, last - first + 1).setValues([row.slice(first - 1, last)]);
    dsh.getRange(L.row, 1, 1, DATA_HEAD.length).setBackground(null);
    var nc = dsh.getRange(L.row, D('Catatan Admin'));
    var old = String(nc.getValue() || '').replace(/\s*\[Revisi ke-\d+ \([^)]*\)\]$/, '');
    nc.setValue((old ? old + ' ' : '') + '[Revisi ke-' + rec.revisions.length + ' (' + rec.revisions[rec.revisions.length - 1].at + ')]');
    if (!isVerifiedRow_(ss, L.row)) FACTORIES.forEach(function (f) { dsh.getRange(L.row, D('PDF ' + f)).setValue(C.pay[f].list.length ? PDF_WAIT : '— (tidak ada)'); });
    dsh.getRange(L.row, D('_data')).setValue(JSON.stringify(rec));
    var lsh = ss.getSheetByName(SHEET.log);
    lsh.getRange(lsh.getLastRow() + 1, 1, logs.length, LOG_HEAD.length).setValues(logs);
    SpreadsheetApp.flush();
  } finally { lock.releaseLock(); }
  if (isVerifiedRow_(ss, L.row)) writePdfLinks_(ss, L.row, id);
  return {before: before, after: L.claim.total};
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
    var map = {}; map[SHEET.data] = [DATA_HEAD, DATA_EDITABLE]; map[SHEET.mem] = [MEM_HEAD, MEM_EDITABLE]; map[SHEET.rcp] = [RCP_HEAD, RCP_EDITABLE];
    var m = map[name]; if (!m) return;
    if (m[1].indexOf(m[0][e.range.getColumn() - 1]) < 0) return;
    e.range.setBackground(EDIT_MARK);
    e.source.toast('Klik baris ini lalu menu Insentif Distributor > Hitung ulang klaim terpilih agar insentif & PDF ikut berubah.', 'Data diubah', 8);
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
  } catch (err) { e.source.toast('Gagal memproses status: ' + err.message, 'Insentif Distributor', 10); }
}
function handleStatus_(ss, row, oldValue) {
  var sh = ss.getSheetByName(SHEET.data), D = function (h) { return DATA_HEAD.indexOf(h) + 1; };
  var status = String(sh.getRange(row, D('Status')).getValue()).trim(), id = String(sh.getRange(row, 1).getValue());
  var rec; try { rec = JSON.parse(sh.getRange(row, D('_data')).getValue()); } catch (e) { return; }
  var now = new Date(), who = userEmail_();
  ss.getSheetByName(SHEET.log).appendRow([now, id, who, '(klaim)', 'Status', oldValue || '', status]);
  if (VERIFIED.indexOf(status) >= 0) {
    if (!rec.verified) { rec.verified = {by: who, at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), status: status}; sh.getRange(row, D('_data')).setValue(JSON.stringify(rec)); }
    var need = false;
    FACTORIES.forEach(function (f) {
      var cell = sh.getRange(row, D('PDF ' + f));
      if ((rec.totals.fac || {})[f] > 0 && !/^=HYPERLINK/i.test(cell.getFormula())) { cell.setValue(PDF_PENDING); need = true; }
    });
    if (need) { ss.toast('Klaim ' + id + ' diverifikasi. PDF sedang dibuat…', 'Insentif Distributor', 8); SpreadsheetApp.flush(); processPdfQueue(); }
  } else {
    var pulled = false;
    FACTORIES.forEach(function (f) {
      var cell = sh.getRange(row, D('PDF ' + f));
      if (trashPdf_(cell)) pulled = true;
      cell.setValue((rec.totals.fac || {})[f] > 0 ? PDF_WAIT : '— (tidak ada)');
    });
    if (rec.verified) { delete rec.verified; sh.getRange(row, D('_data')).setValue(JSON.stringify(rec)); }
    if (pulled) ss.toast('Status ' + id + ' menjadi "' + status + '". PDF ditarik ke Trash.', 'Insentif Distributor', 8);
  }
}
function processPdfQueue() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === PDF_HANDLER) ScriptApp.deleteTrigger(t); });
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) { ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(60 * 1000).create(); return; }
  var started = Date.now(), leftover = false, ss = SpreadsheetApp.getActiveSpreadsheet(), todo = [];
  try {
    var sh = ss.getSheetByName(SHEET.data);
    if (sh.getLastRow() < 2) return;
    var cS = DATA_HEAD.indexOf('PDF SHU'), cN = DATA_HEAD.indexOf('PDF NANA');
    sh.getRange(2, 1, sh.getLastRow() - 1, DATA_HEAD.length).getValues().forEach(function (v, i) {
      if (v[cS] === PDF_PENDING || v[cN] === PDF_PENDING) todo.push({row: i + 2, id: String(v[0]), only: {SHU: v[cS] === PDF_PENDING, NANA: v[cN] === PDF_PENDING}});
    });
  } finally { lock.releaseLock(); }
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - started > 4 * 60 * 1000) { leftover = true; break; }
    writePdfLinks_(ss, todo[i].row, todo[i].id, todo[i].only);
    SpreadsheetApp.flush();
  }
  if (leftover) ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(30 * 1000).create();
}
function writePdfLinks_(ss, row, id, only) {
  var sh = ss.getSheetByName(SHEET.data), L;
  try { L = loadClaim_(ss, id); } catch (e) { return; }
  FACTORIES.forEach(function (f) {
    if (only && !only[f]) return;
    var cell = sh.getRange(row, DATA_HEAD.indexOf('PDF ' + f) + 1);
    trashPdf_(cell);
    if (!L.claim.pay[f].list.length) { cell.setValue('— (tidak ada)'); return; }
    try { cell.setFormula('=HYPERLINK("' + makePdf_(ss, L, f).getUrl() + '","PDF ' + f + '")'); }
    catch (e) { cell.setValue('Gagal: ' + e.message + ' (pakai menu Buat ulang PDF)'); }
  });
}
function makePdf_(ss, L, f) {
  var tmp = ss.insertSheet('tmp_' + L.id + '_' + f + '_' + Date.now());
  try {
    var size = renderPrint_(tmp, L, f);
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + tmp.getSheetId() +
      '&size=A4&portrait=false&scale=4&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER' +
      '&fzr=false&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4' +
      '&r1=0&c1=0&r2=' + size.rows + '&c2=' + size.cols;
    var resp, tries = 0;
    do {
      resp = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
      if (resp.getResponseCode() === 429) Utilities.sleep(3000 * (tries + 1));
    } while (resp.getResponseCode() === 429 && ++tries < 3);
    if (resp.getResponseCode() !== 200) throw new Error('export PDF ' + resp.getResponseCode());
    var name = L.id + ' - ' + f + ' - Insentif Distributor - ' + L.input.groupLabel + ' - ' + L.input.periodeLabel;
    return pdfFolder_().createFile(resp.getBlob().setName(name.replace(/[\\\/:*?"<>|]/g, ' ') + '.pdf'));
  } finally { ss.deleteSheet(tmp); }
}
function pdfFolder_() {
  var id = String(getSettings_().folderId || '').trim();
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder('Klaim Insentif Distributor - PDF');
  setSetting_('folderId', folder.getId());
  return folder;
}
function trashPdf_(cell) {
  var m = String(cell.getFormula() || '').match(/\/d\/([\w-]{20,})/);
  if (!m) return false;
  try { DriveApp.getFileById(m[1]).setTrashed(true); return true; } catch (e) { return false; }
}

/* ===================== TEMPLATE CETAK (A4 portrait, per factory) ===================== */
function renderPrint_(sh, L, f) {
  var C = L.claim, I = L.input, rec = L.rec, S = rec.settings, N = 8, t = C.tot, P = C.pay[f];
  var green = '#0f5c4a', soft = '#e8f2ee', grey = '#f3f4f2', border = '#9aa09c';
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  if (sh.getMaxColumns() < N) sh.insertColumnsAfter(sh.getMaxColumns(), N - sh.getMaxColumns());
  if (sh.getMaxColumns() > N) sh.deleteColumns(N + 1, sh.getMaxColumns() - N);
  sh.setHiddenGridlines(true);
  var BASEW = [140, 110, 110, 85, 70, 70, 95, 110].map(function (x) { return Math.round(x * 1.35); }); // landscape
  BASEW.forEach(function (x, i) { sh.setColumnWidth(i + 1, x); });
  var r = 1;
  var put = function (row, c1, c2, val) { if (typeof val === 'string') val = cell_(val); var rg = sh.getRange(row, c1, 1, c2 - c1 + 1); if (c2 > c1) rg.merge(); rg.setValue(val); return rg; };
  var box = function (r1, r2) { sh.getRange(r1, 1, r2 - r1 + 1, N).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID); };
  var pc = function (x) { return String(x).replace('.', ','); };

  put(r++, 1, N, 'KLAIM INSENTIF DISTRIBUTOR').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center').setFontColor(green);
  put(r++, 1, N, (f === 'SHU' ? S.entShu : S.entNana) + ' (' + f + ')').setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
  if (!rec.verified) put(r, 1, N, 'DRAFT — BELUM DIVERIFIKASI ADMIN · TIDAK UNTUK PEMBAYARAN').setFontWeight('bold').setFontColor('#b3261e').setHorizontalAlignment('center');
  sh.getRange(r, 1, 1, N).setBorder(null, null, true, null, null, null, green, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  r += 2;
  var info = [['No. Klaim', L.id, 'Periode', I.periodeLabel], ['Distributor / Group', I.groupLabel, 'Diajukan oleh', I.pengaju + (I.kontak ? ' (' + I.kontak + ')' : '')],
              ['Anggota', I.members.map(function (m) { return m.dist; }).join(', '), 'Tanggal submit', rec.submittedAt]];
  if (rec.revisions && rec.revisions.length) info.push(['Status data', 'Dikoreksi admin (revisi ke-' + rec.revisions.length + ', ' + rec.revisions[rec.revisions.length - 1].at + ')', 'Total awal', 'Rp ' + fmtNum_(rec.original ? rec.original.totals.total : 0)]);
  if (rec.verified) info.push(['Diverifikasi', (rec.verified.by || 'admin') + ' · ' + rec.verified.at, 'Status', rec.verified.status]);
  info.forEach(function (x) { put(r, 1, 1, x[0]).setFontWeight('bold'); put(r, 2, 4, ': ' + x[1]).setWrap(true); put(r, 5, 6, x[2]).setFontWeight('bold'); put(r, 7, 8, ': ' + x[3]); r++; });
  r++;

  // A. pencapaian
  put(r++, 1, N, 'A. PENCAPAIAN ' + I.periodeLabel.toUpperCase() + (I.members.length > 1 ? ' — TOTAL GROUP' : '')).setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var h = r;
  sh.getRange(r++, 1, 1, N).setValues([['KPI', 'Target', 'Actual', 'Pencapaian', 'Bobot', 'Skor', 'Ketentuan', 'Keterangan']]).setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center');
  var kp = {}; C.kpi.forEach(function (k) { kp[k.key] = k; });
  var rows = [
    ['Sell In', t.si.t, t.si.a, t.si.ach, '—', '—', 'syarat ≥ ' + Math.round(C.pct.minSI * 100) + '%', (C.gate ? 'Tercapai' : 'TIDAK tercapai — insentif gugur') + ' (SHU ' + fmtNum_(t.si.s) + ' · NANA ' + fmtNum_(t.si.n) + ')'],
    ['Sell Out', t.so.t, t.so.a, t.so.ach, kp.so.w, kp.so.pts, kp.so.rule, C.soOk ? 'Dihitung' : 'Tidak dihitung'],
    ['AO SKU 2000', t.ao2k.t, t.ao2k.a, t.ao2k.ach, kp.ao2k.w, kp.ao2k.pts, kp.ao2k.rule, ''],
    ['AO GC', t.aogc.t, t.aogc.a, t.aogc.ach, kp.aogc.w, kp.aogc.pts, kp.aogc.rule, '']];
  sh.getRange(r, 1, rows.length, N).setValues(rows);
  sh.getRange(r, 2, 2, 2).setNumberFormat('#,##0'); sh.getRange(r + 2, 2, 2, 2).setNumberFormat('#,##0');
  sh.getRange(r, 4, rows.length, 1).setNumberFormat('0.0%'); sh.getRange(r + 1, 5, 3, 2).setNumberFormat('0.0%');
  sh.getRange(r, 4, rows.length, 3).setHorizontalAlignment('center'); sh.getRange(r, 7, rows.length, 2).setFontSize(8).setWrap(true);
  r += rows.length;
  sh.getRange(r, 1, 1, N).setValues([['SKOR KPI', '', '', '', '', C.score, '', '']]).setFontWeight('bold').setBackground(grey);
  sh.getRange(r, 6).setNumberFormat('0.0%').setHorizontalAlignment('center');
  box(h, r); r += 2;
  if (I.members.length > 1) {
    var mh = r;
    sh.getRange(r++, 1, 1, N).setValues([['Distributor', 'Target SO', 'Actual SO', 'Target SI', 'Actual SI', 'AO 2000', 'AO GC', 'Ach SO']]).setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setFontSize(8);
    var mr = C.members.map(function (m) { return [cell_(m.dist), m.so.t, m.so.a, m.si.t, m.si.a, m.ao2k.a + ' / ' + m.ao2k.t, m.aogc.a + ' / ' + m.aogc.t, m.so.ach]; });
    sh.getRange(r, 1, mr.length, N).setValues(mr).setFontSize(8);
    sh.getRange(r, 2, mr.length, 4).setNumberFormat('#,##0'); sh.getRange(r, 6, mr.length, 2).setHorizontalAlignment('center'); sh.getRange(r, 8, mr.length, 1).setNumberFormat('0.0%');
    r += mr.length; box(mh, r - 1); r++;
  }

  // B. perhitungan
  put(r++, 1, N, 'B. PERHITUNGAN INSENTIF').setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var bh = r;
  var A = C.alloc, cs = pc(Math.round(C.cShu * 1000) / 10) + '% / ' + pc(Math.round((1 - C.cShu) * 1000) / 10) + '%';
  put(r, 1, 1, 'Dasar insentif'); put(r, 2, 5, 'Actual sell out Rp ' + fmtNum_(t.so.a) + ' × ' + pc(C.pct.base) + '%' + (C.gate ? '' : ' — sell in < ' + Math.round(C.pct.minSI * 100) + '%, insentif 0')).setFontSize(8);
  put(r, 8, 8, C.base).setNumberFormat('#,##0').setHorizontalAlignment('right'); r++;
  sh.getRange(r, 1, 1, N).setValues([['Komponen', 'Pembebanan', '', '', '', 'SHU', 'NANA', 'Total']]).setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center');
  sh.getRange(r, 2, 1, 4).merge(); r++;
  var cf = r;
  [['KPI Sell Out (skor ' + pc(Math.round(C.kpi[0].pts * 1000) / 10) + '%)', 'kontribusi actual SO SHU/NANA ' + cs, A.SHU.so, A.NANA.so],
   ['KPI AO SKU 2000 (skor ' + pc(Math.round(C.kpi[1].pts * 1000) / 10) + '%)', 'NANA', A.SHU.ao2k, A.NANA.ao2k],
   ['KPI AO GC (skor ' + pc(Math.round(C.kpi[2].pts * 1000) / 10) + '%)', 'SHU', A.SHU.aogc, A.NANA.aogc],
   ['Bonus SO > ' + Math.round(C.pct.bonusThr * 100) + '% (' + pc(C.pct.bonus) + '% × actual SO) — ' + (C.bonusOn ? 'tercapai' : 'tidak tercapai'), 'kontribusi actual SO SHU/NANA', A.SHU.bonus, A.NANA.bonus],
   ['TOTAL INSENTIF', '', C.fac.SHU, C.fac.NANA]].forEach(function (x, j) {
    sh.getRange(r, 1, 1, N).setValues([[x[0], x[1], '', '', '', x[2], x[3], x[2] + x[3]]]);
    sh.getRange(r, 2, 1, 4).merge().setFontSize(8);
    if (j === 4) sh.getRange(r, 1, 1, N).setFontWeight('bold').setBackground(grey);
    r++;
  });
  sh.getRange(cf, 6, r - cf, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(cf, f === 'SHU' ? 6 : 7, r - cf, 1).setBackground('#e6f4ec').setFontWeight('bold');
  sh.getRange(cf, 1, r - cf, 1).setWrap(true);
  box(bh, r - 1); r++;

  // C. pembayaran
  put(r++, 1, N, 'C. RINCIAN PEMBAYARAN — ' + f).setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var ph = r;
  sh.getRange(r++, 1, 1, N).setValues([['Penerima', 'Nama', 'Metode', 'Bank / No. Rek', 'Porsi', 'Nominal', 'Pajak', 'Diterima']]).setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center');
  var pf = r;
  P.list.forEach(function (x) {
    sh.getRange(r++, 1, 1, N).setValues([[x.role, cell_(x.name) + (x.an ? ' (a.n. ' + cell_(x.an) + ')' : ''), METHODS[x.m] + (x.rate ? ' (' + pc(x.rate) + '%)' : ''), cell_([x.bank, x.cab].filter(String).join(' · ')), x.share / 100, x.nom, x.tax, x.net]]);
  });
  if (!P.list.length) put(r++, 1, N, 'Tidak ada insentif ' + f + ' yang dibayarkan.').setFontStyle('italic');
  sh.getRange(r, 1, 1, N).setValues([['TOTAL', '', '', '', '', P.nom, P.tax, P.net]]).setFontWeight('bold').setBackground(grey);
  sh.getRange(pf, 5, r - pf + 1, 1).setNumberFormat('0%').setHorizontalAlignment('center');
  sh.getRange(pf, 6, r - pf + 1, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(pf, 2, r - pf + 1, 3).setWrap(true).setFontSize(8);
  box(ph, r); var payEnd = r; r++;
  put(r, 1, N, 'Terbilang: ' + terbilang_(P.net) + ' rupiah').setFontStyle('italic').setFontWeight('bold');
  r += 2;
  var notes = ['Catatan perhitungan:',
    '• Insentif dihitung bila pencapaian sell in ≥ ' + Math.round(C.pct.minSI * 100) + '%. KPI: Sell Out ' + Math.round(kp.so.w * 100) + '% (dihitung bila ≥ ' + Math.round(C.pct.minSO * 100) + '%), AO SKU 2000 ' + Math.round(kp.ao2k.w * 100) + '% & AO GC ' + Math.round(kp.aogc.w * 100) + '% (prorate, maks 100%).',
    '• Pembebanan: KPI Sell Out & bonus dibagi sesuai kontribusi actual sell out SHU/NANA; KPI AO SKU 2000 dibebankan ke NANA; KPI AO GC dibebankan ke SHU.',
    '• Insentif maksimal ' + pc(C.pct.base) + '% dari actual sell out; bonus ' + pc(C.pct.bonus) + '% dari actual sell out bila pencapaian sell out > ' + Math.round(C.pct.bonusThr * 100) + '%. Pembagian: Owner ' + C.ownerShare + '%, PIC ' + (100 - C.ownerShare) + '%.',
    (I.members.length > 1 ? '• Group dihitung dari total seluruh anggota dan dibayarkan sebagai satu nominal.' : '• Dihitung per distributor.'),
    '• Pajak: rekening sendiri < Rp ' + fmtNum_(S.ownThr) + ' = 0%; titip rekening kumulatif ≥ Rp ' + fmtNum_(S.titipThr) + ' = ' + pc(S.titipRate) + '%; rekening perusahaan = ' + pc(S.coRate) + '%.'];
  notes.forEach(function (x, j) { put(r++, 1, N, x).setFontSize(8).setFontColor('#555555').setWrap(true).setFontWeight(j ? 'normal' : 'bold'); });
  r++;
  [[1, 3, 'Diperiksa oleh,', 'Data Analyst'], [4, 5, 'Disetujui oleh,', 'Head of Sales'], [6, 8, 'Diterima oleh,', 'Finance']].forEach(function (s) {
    put(r, s[0], s[1], s[2]).setHorizontalAlignment('center');
    put(r + 5, s[0], s[1], '(______________________________)').setHorizontalAlignment('center');
    put(r + 6, s[0], s[1], s[3]).setHorizontalAlignment('center').setFontWeight('bold');
  });
  for (var sr = r + 1; sr <= r + 4; sr++) sh.setRowHeight(sr, 24); // ruang tanda tangan lebih lega
  r += 6;
  sh.getRange(1, 1, r, N).setFontFamily('Arial');
  autoWidths_(sh, ph + 1, payEnd, N, BASEW);
  return {rows: r, cols: N};
}

/* ===================== SETUP ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === STATUS_HANDLER; });
  if (!has) ScriptApp.newTrigger(STATUS_HANDLER).forSpreadsheet(ss).onEdit().create();
  try { onOpen(); } catch (e) {}
  ss.toast('Struktur sheet siap. Lengkapi Daftar Distributor, lalu Deploy > New deployment > Web app.', 'Insentif Distributor', 10);
}
function ensureSheets_(ss) {
  var set = ss.getSheetByName(SHEET.set);
  if (!set) {
    set = ss.insertSheet(SHEET.set);
    set.getRange(1, 1, 1, 3).setValues([['Pengaturan', 'Nilai', 'key']]).setFontWeight('bold').setBackground('#0f5c4a').setFontColor('#ffffff');
    set.getRange(2, 1, SETTINGS.length, 3).setValues(SETTINGS);
    set.getRange(2 + SETTINGS.map(function (s) { return s[2]; }).indexOf('quarters'), 2).setNumberFormat('@').setValue('2026-Q4');
    set.setColumnWidth(1, 430); set.setColumnWidth(2, 240); set.hideColumns(3);
  } else {
    var keys = set.getRange(2, 3, Math.max(set.getLastRow() - 1, 1), 1).getValues().map(function (r) { return r[0]; });
    SETTINGS.forEach(function (s) { if (keys.indexOf(s[2]) < 0) set.appendRow(s); });
  }
  if (!ss.getSheetByName(SHEET.dist)) header_(ss, SHEET.dist, DIST_HEAD, function (sh) {
    sh.getRange(2, 1, DIST_SEED.length, 3).setValues(DIST_SEED);
    sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 260);
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['YA', 'TIDAK'], true).build());
  });
  header_(ss, SHEET.data, DATA_HEAD, function (sh) {
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm');
    sh.getRange('H:I').setNumberFormat('#,##0'); sh.getRange('K:L').setNumberFormat('#,##0'); sh.getRange('Q:W').setNumberFormat('#,##0');
    ['J', 'M', 'N', 'O', 'P'].forEach(function (c) { sh.getRange(c + ':' + c).setNumberFormat('0.0%'); });
    sh.getRange('X2:X').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).build());
    sh.hideColumns(DATA_HEAD.indexOf('_data') + 1); sh.setColumnWidth(1, 120); sh.setColumnWidth(3, 200);
  });
  header_(ss, SHEET.mem, MEM_HEAD, function (sh) { sh.getRange('E:N').setNumberFormat('#,##0'); });
  header_(ss, SHEET.rcp, RCP_HEAD, function (sh) {
    sh.getRange('J:O').setNumberFormat('#,##0');
    sh.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(METHODS).map(function (k) { return METHODS[k]; }), true).build());
  });
  header_(ss, SHEET.log, LOG_HEAD, function (sh) { sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm'); });
  markEditable_(ss.getSheetByName(SHEET.data), DATA_HEAD, DATA_EDITABLE);
  markEditable_(ss.getSheetByName(SHEET.mem), MEM_HEAD, MEM_EDITABLE);
  markEditable_(ss.getSheetByName(SHEET.rcp), RCP_HEAD, RCP_EDITABLE);
  if (!ss.getSheetByName(SHEET.print)) ss.insertSheet(SHEET.print);
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s1);
}
function header_(ss, name, head, fmt) {
  var sh = ss.getSheetByName(name);
  if (sh) {
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
    if (editable.indexOf(h) >= 0) cell.setBackground('#b86a00').setNote('Boleh dikoreksi admin. Setelah edit, jalankan menu Insentif Distributor > Hitung ulang klaim terpilih.');
    else if (h !== '_data') cell.setBackground('#0f5c4a');
  });
}

/* ===================== HELPERS ===================== */
function getSettings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set), S = {};
  SETTINGS.forEach(function (s) { S[s[2]] = s[1]; });
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (r[2]) S[r[2]] = r[1]; });
  NUM_KEYS.forEach(function (k) { S[k] = typeof S[k] === 'number' ? S[k] : parseFloat(String(S[k]).replace(/\./g, '').replace(',', '.')) || 0; });
  S.quarters = Object.prototype.toString.call(S.quarters) === '[object Date]' ? '' : String(S.quarters == null ? '' : S.quarters);
  return S;
}
function pubSettings_(S) { var o = {}; NUM_KEYS.forEach(function (k) { o[k] = S[k]; }); o.entShu = S.entShu; o.entNana = S.entNana; return o; }
function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set);
  var keys = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (keys[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
}
function yes_(v) { return String(v == null ? 'YA' : v).trim().toUpperCase() !== 'TIDAK'; }
function headOf_(i) { return {groupLabel: i.groupLabel, members: i.members.map(function (m) { return m.dist; }), periode: i.periode, periodeLabel: i.periodeLabel, pengaju: i.pengaju, kontak: i.kontak}; }
function snap_(i) {
  return {members: i.members.map(function (m) { return {dist: m.dist, so: m.so, si: m.si, ao2k: m.ao2k, aogc: m.aogc}; }),
    recipients: i.recipients.map(function (r) { return {role: r.role, name: r.name, pay: r.pay}; })};
}
function totalsOf_(C) { return {total: C.total, kpiInc: C.kpiInc, bonus: C.bonus, score: C.score, fac: C.fac, totalNet: C.totalNet}; }
function findPay_(list, idx) { for (var i = 0; i < list.length; i++) if (list[i].i === idx) return list[i]; return null; }
function str_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 120); }
function num_(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.min(v, 1e15) : 0; }
function cell_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function normDist_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function note_(msg) { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Insentif Distributor', 10); }
function userEmail_() { try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } }
/** Lebar kolom PDF dinamis untuk tabel rincian pembayaran (baris r1–r2): kolom melebar mengikuti isian
 *  terpanjang (nama, metode, bank / no. rek, cabang, a/n); isian yang lebih panjang dari batas dibungkus (wrap). */
function autoWidths_(sh, r1, r2, N, base, cap) {
  cap = cap || 260;
  var w = base.slice();
  if (r2 < r1) { w.forEach(function (x, j) { sh.setColumnWidth(j + 1, x); }); return; }
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
}

function fmtNum_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function sanitize_(p, S) {
  if (!p || typeof p !== 'object') throw new Error('Data tidak valid.');
  var periode = str_(p.periode, 7).toUpperCase();
  if (quarters_(S).indexOf(periode) < 0) throw new Error('Periode ' + periode + ' tidak dibuka untuk klaim.');
  var pengaju = str_(p.pengaju, 80);
  if (!pengaju) throw new Error('Nama pengaju wajib diisi.');
  var entry;
  if (p.entry === LAIN) {
    if (!yes_(S.allowOther)) throw new Error('Pilih distributor dari daftar.');
    var nm = str_(p.distLain, 80);
    if (!nm) throw new Error('Nama distributor wajib diisi.');
    var clash = distEntries_().filter(function (e) { return e.members.some(function (m) { return normDist_(m) === normDist_(nm); }); })[0];
    if (clash) throw new Error(nm + ' terdaftar' + (clash.group ? ' dalam group "' + clash.label + '"' : '') + '. Pilih dari daftar.');
    entry = {label: nm, members: [nm]};
  } else {
    entry = distEntries_().filter(function (e) { return e.key === p.entry; })[0];
    if (!entry) throw new Error('Distributor / group tidak dikenal. Muat ulang halaman.');
  }
  var got = Array.isArray(p.members) ? p.members : [];
  var members = entry.members.map(function (dist) {
    var m = got.filter(function (x) { return x && normDist_(x.dist) === normDist_(dist); })[0];
    if (!m) throw new Error('Data ' + dist + ' belum diisi.');
    var g = function (o) { o = o || {}; return {t: num_(o.t), s: num_(o.s), n: num_(o.n), a: num_(o.a)}; };
    var x = {dist: dist, so: g(m.so), si: g(m.si), ao2k: g(m.ao2k), aogc: g(m.aogc)};
    x.so = {t: x.so.t, s: x.so.s, n: x.so.n}; x.si = {t: x.si.t, s: x.si.s, n: x.si.n}; x.ao2k = {t: x.ao2k.t, a: x.ao2k.a}; x.aogc = {t: x.aogc.t, a: x.aogc.a};
    ['so', 'si', 'ao2k', 'aogc'].forEach(function (k) { if (!x[k].t) throw new Error('Target ' + {so: 'sell out', si: 'sell in', ao2k: 'AO SKU 2000', aogc: 'AO GC'}[k] + ' ' + dist + ' belum diisi.'); });
    return x;
  });
  var rc = Array.isArray(p.recipients) ? p.recipients : [];
  var recipients = ['Owner', 'PIC'].map(function (role) {
    var r = rc.filter(function (x) { return x && x.role === role; })[0] || {}, pay = r.pay || {};
    var name = str_(r.name, 80);
    if (!name) throw new Error('Nama ' + role + ' wajib diisi.');
    return {role: role, name: name, pay: {m: METHODS[pay.m] ? pay.m : 'own', bank: str_(pay.bank, 80), cab: str_(pay.cab, 60), an: str_(pay.an, 80)}};
  });
  return {groupLabel: entry.label, members: members, recipients: recipients, periode: periode, periodeLabel: quarterLabel(periode), pengaju: pengaju, kontak: str_(p.kontak, 60)};
}
function nextId_(sh, now, periode) {
  var prefix = 'DST-' + periode.replace('-', '') + '-', n = 0;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
    var v = String(r[0]); if (v.indexOf(prefix) === 0) n = Math.max(n, parseInt(v.slice(prefix.length), 10) || 0);
  });
  return prefix + ('000' + (n + 1)).slice(-3);
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
    if (x < 1e12) return t(Math.floor(x / 1e9)) + ' miliar ' + t(x % 1e9);
    return t(Math.floor(x / 1e12)) + ' triliun ' + t(x % 1e12);
  };
  var out = n === 0 ? 'nol' : t(n).replace(/\s+/g, ' ').trim();
  return out.charAt(0).toUpperCase() + out.slice(1);
}
