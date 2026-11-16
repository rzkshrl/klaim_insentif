/**
 * FORM KLAIM KOMPETISI AO SKU 2000 — Google Apps Script
 * ------------------------------------------------------------------
 * Pasang di Google Sheet admin tersendiri (Extensions > Apps Script).
 * Alur: distributor upload data transaksi → sistem hitung AO SKU 2000 (non Money Mouse) per salesman
 *       → distributor isi target → pemenang per distributor / group → admin verifikasi → PDF finance.
 */

var SHEET = {data: 'Data Klaim', sales: 'Data Salesman', dist: 'Daftar Distributor', set: 'Pengaturan', print: 'Cetak', log: 'Log Revisi'};
var TZ = 'Asia/Jakarta';
var STATUS = ['Baru', 'Diverifikasi', 'Disetujui', 'Dibayar', 'Ditolak'];
var VERIFIED = ['Diverifikasi', 'Disetujui', 'Dibayar'];
var PDF_PENDING = 'Menunggu PDF…', PDF_WAIT = 'Menunggu verifikasi';
var PDF_HANDLER = 'processPdfQueue', STATUS_HANDLER = 'onStatusEdit';
var EDIT_MARK = '#fff3c4';
var LAIN = '__lain__';

var SETTINGS = [
  ['Insentif pemenang per distributor / group (Rp)', 200000, 'prize'],
  ['Kata kunci SKU 2000 (nama / kode barang, pisahkan koma)', '4X10,40PCS', 'skuInclude'],
  ['Kata kunci dikecualikan (pisahkan koma)', 'MONEY MOUSE', 'skuExclude'],
  ['Minimal pembelian SKU 2000 per outlet di periode (karton / dus)', 1, 'minDus'],
  ['Konversi isi per dus khusus (KATA KUNCI=pcs per dus:renceng per dus; pisahkan ;)', '40PCS=40:4', 'packRules'],
  ['Batas rekening sendiri tanpa pajak (Rp)', 500000, 'ownThr'],
  ['Batas kumulatif titip rekening (Rp)', 5000000, 'titipThr'],
  ['Pajak titip rekening (%)', 2.5, 'titipRate'],
  ['Pajak rekening perusahaan (%)', 15, 'coRate'],
  ['Entitas penanggung insentif', 'CV Nana Abadi (NANA)', 'entity'],
  ['Izinkan distributor yang tidak ada di Daftar Distributor (YA / TIDAK)', 'YA', 'allowOther'],
  ['Kode akses form (kosongkan jika tanpa kode)', '', 'code'],
  ['Form menerima klaim (YA / TIDAK)', 'YA', 'open'],
  ['ID folder PDF (terisi otomatis)', '', 'folderId'],
  ['ID folder file transaksi (terisi otomatis)', '', 'srcFolderId']
];
var DIST_SEED = [
  ['SAJ Bangkalan', 'SAJ Bangkalan & Pamekasan', 'YA'],
  ['SAJ Pamekasan', 'SAJ Bangkalan & Pamekasan', 'YA'],
  ['Aldi Jaya Tuban', 'Aldi Jaya Tuban & Lamongan', 'YA'],
  ['Aldi Jaya Lamongan', 'Aldi Jaya Tuban & Lamongan', 'YA'],
  ['Pilar', 'Pilar, Sejahtera & AJP', 'YA'],
  ['Sejahtera', 'Pilar, Sejahtera & AJP', 'YA'],
  ['AJP', 'Pilar, Sejahtera & AJP', 'YA']
];

var DATA_HEAD = ['ID Klaim', 'Waktu Submit', 'Distributor / Group', 'Anggota', 'Periode', 'Diajukan Oleh', 'Kontak', 'Jml Salesman',
  'Memenuhi Target', 'Pemenang', 'Distributor Pemenang', 'AO Pemenang', 'Target Pemenang', 'Insentif', 'Pajak', 'Diterima',
  'Status', 'PDF', 'Catatan Admin', '_data', 'File Transaksi'];
var SALES_HEAD = ['ID Klaim', 'Periode', 'Distributor / Group', 'Distributor', 'Salesman', 'AO SKU 2000', 'Nilai SKU 2000 (Rp)', 'Target AO',
  'Pencapaian', 'Memenuhi', 'Peringkat', 'Pemenang', 'Keterangan', 'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N', 'Pajak', 'Diterima'];
var DIST_HEAD = ['Distributor', 'Group (kosongkan bila dihitung sendiri)', 'Aktif (YA/TIDAK)'];
var LOG_HEAD = ['Waktu', 'ID Klaim', 'Admin', 'Salesman', 'Kolom', 'Nilai Lama', 'Nilai Baru'];
var DATA_EDITABLE = ['Diajukan Oleh', 'Kontak'];
var SALES_EDITABLE = ['AO SKU 2000', 'Nilai SKU 2000 (Rp)', 'Target AO', 'Metode Bayar', 'Bank / No. Rek', 'Cabang', 'A/N'];

/* ===== LOGIKA KOMPETISI AO SKU 2000 (dipakai sama persis di server & form) ===== */
var METHODS = {own:'Rekening sendiri', titip:'Titip 1 rekening', co:'Rekening perusahaan'};
var BULAN = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];

function periodeLabel(p) { var m = /^(\d{4})-(\d{2})$/.exec(p || ''); return m ? BULAN[+m[2] - 1] + ' ' + m[1] : String(p || ''); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function lastDay(p) { var m = /^(\d{4})-(\d{2})$/.exec(p || ''); if (!m) return ''; var d = new Date(Date.UTC(+m[1], +m[2], 0)); return p + '-' + pad2(d.getUTCDate()); }
function toISO(v) {
  if (v == null || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v) ? '' : v.getFullYear() + '-' + pad2(v.getMonth() + 1) + '-' + pad2(v.getDate());
  var s = String(v).trim(), m;
  if ((m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/.exec(s))) return m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
  if ((m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/.exec(s))) { var y = +m[3]; if (y < 100) y += 2000; return y + '-' + pad2(+m[2]) + '-' + pad2(+m[1]); }
  return '';
}
function fmtDate(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function normKode(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }
function kwList(s) { return String(s || '').split(',').map(function (w) { return w.trim().toUpperCase(); }).filter(String); }

/** SKU 2000 non Money Mouse: nama/kode barang memuat salah satu kata kunci & tidak memuat kata pengecualian */
function isSku2000(nama, kode, S) {
  var n = String(nama || '').toUpperCase(), k = String(kode || '').toUpperCase().trim();
  var inc = kwList(S.skuInclude || '4X10,40PCS'), exc = kwList(S.skuExclude || 'MONEY MOUSE');
  if (exc.some(function (w) { return n.indexOf(w) >= 0 || k === w; })) return false;
  return inc.some(function (w) { return n.indexOf(w) >= 0 || k === w; });
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

/**
 * Hitung AO SKU 2000 per salesman dari transaksi.
 * members: [{dist, tx:[{d:'YYYY-MM-DD', k:kodeOutlet, s:salesman, q:qty, v:nilai}]}]  (tx sudah difilter SKU 2000 non MM)
 * AO = jumlah outlet berbeda dengan pembelian bersih ≥ minimal karton (S.minDus) di periode, per salesman per distributor.
 * tx.q harus sudah dalam satuan dus.
 */
function computeAo(members, periode, S) {
  var out = [], minD = Number(S && S.minDus) || 1;
  members.forEach(function (m) {
    var by = {};
    (m.tx || []).forEach(function (t) {
      if (!t.d || t.d.slice(0, 7) !== periode) return;
      var s = String(t.s || '').trim() || '(tanpa salesman)', k = normKode(t.k);
      if (!k) return;
      var x = by[s] = by[s] || {outlets: {}, value: 0};
      x.outlets[k] = (x.outlets[k] || 0) + (Number(t.q) || 0);
      x.value += Number(t.v) || 0;
    });
    Object.keys(by).sort().forEach(function (s) {
      var x = by[s], ao = Object.keys(x.outlets).filter(function (k) { return x.outlets[k] >= minD - 1e-9; }).length;
      out.push({dist: m.dist, name: s, ao: ao, value: Math.round(x.value)});
    });
  });
  return out;
}

/**
 * Tentukan pemenang.
 * input.rows: [{dist, name, ao, value, target, pay}]
 * Syarat: target > 0 dan AO >= target. Pemenang = AO tertinggi; seri → nilai (Rp) SKU 2000 tertinggi.
 */
function computeKomp(input, S) {
  var prize = Number(S.prize) || 0;
  var rows = input.rows.map(function (r, i) {
    var t = Number(r.target) || 0, ao = Number(r.ao) || 0;
    return {i: i, dist: r.dist, name: r.name, ao: ao, value: Number(r.value) || 0, target: t, ach: t > 0 ? ao / t : 0,
      eligible: t > 0 && ao >= t, why: t <= 0 ? 'Target belum diisi' : ao < t ? 'AO di bawah target' : '', pay: r.pay || {m: 'own'}, winner: false, rank: 0, incentive: 0};
  });
  var order = rows.slice().sort(function (a, b) { return b.ao - a.ao || b.value - a.value || (a.name < b.name ? -1 : 1); });
  order.forEach(function (r, j) { r.rank = j + 1; });
  var elig = order.filter(function (r) { return r.eligible; });
  var win = elig[0] || null, tie = false;
  if (win) {
    win.winner = true; win.incentive = prize;
    tie = elig.length > 1 && elig[1].ao === win.ao && elig[1].value === win.value;
    if (elig.length > 1 && elig[1].ao === win.ao) win.tieNote = elig[1].value === win.value ? 'Seri penuh dengan ' + elig[1].name + ' — perlu keputusan admin' : 'AO sama dengan ' + elig[1].name + ', unggul nilai SKU 2000';
  }
  var list = win ? [{i: win.i, name: win.name, dist: win.dist, m: METHODS[win.pay.m] ? win.pay.m : 'own', bank: win.pay.bank || '', cab: win.pay.cab || '', an: win.pay.an || '', nom: prize}] : [];
  var titipSum = list.filter(function (x) { return x.m === 'titip'; }).reduce(function (a, x) { return a + x.nom; }, 0);
  var titipOn = titipSum > 0 && titipSum >= Number(S.titipThr);
  var agg = {nom: 0, tax: 0, net: 0};
  list.forEach(function (x) {
    x.rate = x.m === 'co' ? Number(S.coRate) : x.m === 'titip' ? (titipOn ? Number(S.titipRate) : 0) : 0;
    x.tax = Math.round(x.nom * x.rate / 100); x.net = x.nom - x.tax; x.flag = x.m === 'own' && x.nom >= Number(S.ownThr);
    agg.nom += x.nom; agg.tax += x.tax; agg.net += x.net;
  });
  return {rows: rows, order: order, winner: win, tie: tie, eligibleCount: elig.length,
    pay: {list: list, titipSum: titipSum, titipOn: titipOn, nom: agg.nom, tax: agg.tax, net: agg.net}, total: agg.nom, totalNet: agg.net};
}
/* ===== akhir logika kompetisi ===== */


/* ===================== WEB APP ===================== */
function doGet(e) {
  if (e && e.parameter && e.parameter.fn === 'getPublicSettings') {
    try { return apiOut_({ok: true, data: getPublicSettings()}); } catch (err) { return apiOut_({ok: false, error: String(err.message || err)}); }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Form Klaim Kompetisi AO SKU 2000')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ===================== API JSON (untuk frontend di Vercel) =====================
 * Frontend memanggil: POST <url web app>  body (text/plain): {"fn":"submitKlaim","args":[payload]}
 * Balasan: {"ok":true,"data":...} atau {"ok":false,"error":"pesan"}.
 * Cek cepat di browser: <url web app>?fn=getPublicSettings
 */
function apiFuncs_() { return {getPublicSettings: getPublicSettings, submitKlaim: submitKlaim, uploadSource: uploadSource}; }
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
  return JSON.parse(JSON.stringify({prize: S.prize, skuInclude: String(S.skuInclude || ''), skuExclude: String(S.skuExclude || ''), minDus: S.minDus || 1, packRules: S.packRules, ownThr: S.ownThr, titipThr: S.titipThr,
    titipRate: S.titipRate, coRate: S.coRate, entity: String(S.entity || ''), allowOther: yes_(S.allowOther),
    needCode: !!String(S.code || '').trim(), open: yes_(S.open), entries: distEntries_()}));
}

/** daftar pilihan: group (beberapa distributor) & distributor tunggal */
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

/** upload file transaksi (dipanggil per file sebelum submit) */
function uploadSource(fileName, b64) {
  if (!b64 || String(b64).length > 15 * 1024 * 1024) throw new Error('File terlalu besar untuk disimpan (maks. ±10 MB per file).');
  var name = 'BELUM SUBMIT - ' + Utilities.formatDate(new Date(), TZ, 'yyMMdd HHmmss') + ' - ' + str_(fileName, 120);
  var blob = Utilities.newBlob(Utilities.base64Decode(String(b64)), MimeType.MICROSOFT_EXCEL, name.replace(/[\\\/:*?"<>|]/g, ' '));
  return srcFolder_().createFile(blob).getId();
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
    var dup = findDuplicate_(ss, input.groupLabel, input.periode);
    if (dup) throw new Error('Klaim ' + input.groupLabel + ' periode ' + periodeLabel(input.periode) + ' sudah diajukan (' + dup + '). Hubungi admin bila perlu revisi.');
    var claim = computeKomp(input, S);
    var now = new Date(), sh = ss.getSheetByName(SHEET.data), id = nextId_(sh, now);
    var files = [];
    input.members.forEach(function (m) {
      if (!m.fileId) return;
      try {
        var f = DriveApp.getFileById(m.fileId);
        f.setName((id + ' - ' + m.dist + ' - ' + m.fileName).replace(/[\\\/:*?"<>|]/g, ' '));
        files.push({dist: m.dist, name: m.fileName, url: f.getUrl()});
      } catch (e) { files.push({dist: m.dist, name: m.fileName, url: ''}); }
    });
    var rec = {id: id, submittedAt: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), head: headOf_(input), settings: pubSettings_(S),
      source: input.members.map(function (m) { return {dist: m.dist, fileName: m.fileName, dataMin: m.dataMin, dataMax: m.dataMax, rows: m.rowsRead, skuRows: m.tx.length}; }),
      files: files, totals: totalsOf_(claim),
      rowsSnapshot: input.rows.map(function (r) { return {dist: r.dist, name: r.name, ao: r.ao, value: r.value, target: r.target}; })};
    var w = claim.winner;
    sh.appendRow([id, now, cell_(input.groupLabel), cell_(input.members.map(function (m) { return m.dist; }).join(', ')), periodeLabel(input.periode),
      cell_(input.pengaju), cell_(input.kontak), claim.rows.length, claim.eligibleCount,
      w ? cell_(w.name) : '— (tidak ada)', w ? cell_(w.dist) : '', w ? w.ao : '', w ? w.target : '', claim.total, claim.pay.tax, claim.totalNet,
      'Baru', w ? PDF_WAIT : '— (tidak ada)', w && w.tieNote ? w.tieNote : '', JSON.stringify(rec), filesCell_(files)]);
    writeSales_(ss, id, input, claim);
    SpreadsheetApp.flush();
    return {id: id, winner: w ? {name: w.name, dist: w.dist, ao: w.ao, target: w.target} : null, eligible: claim.eligibleCount, total: claim.total, totalNet: claim.totalNet};
  } finally {
    lock.releaseLock();
  }
}

function writeSales_(ss, id, input, claim, rowNos) {
  var sh = ss.getSheetByName(SHEET.sales);
  var vals = claim.rows.map(function (r) {
    var p = r.winner ? claim.pay.list[0] : null, pay = r.pay || {};
    return [id, periodeLabel(input.periode), cell_(input.groupLabel), cell_(r.dist), cell_(r.name), r.ao, r.value, r.target || '',
      r.target ? r.ach : '', r.eligible ? 'YA' : 'TIDAK', r.rank, r.winner ? 'PEMENANG' : '', r.winner ? (r.tieNote || '') : r.why,
      METHODS[pay.m] || METHODS.own, cell_(pay.bank), cell_(pay.cab), cell_(pay.an), p ? p.tax : '', p ? p.net : ''];
  });
  if (!vals.length) return;
  if (rowNos) vals.forEach(function (v, j) { sh.getRange(rowNos[j], 1, 1, v.length).setValues([v]).setBackground(null); });
  else {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, vals.length, SALES_HEAD.length).setValues(vals);
    rowNos = vals.map(function (v, j) { return start + j; });
  }
  claim.rows.forEach(function (r, j) { if (r.winner) sh.getRange(rowNos[j], 1, 1, SALES_HEAD.length).setBackground('#e6f4ec'); });
}

function findDuplicate_(ss, groupLabel, periode, excludeId) {
  var sh = ss.getSheetByName(SHEET.data);
  if (sh.getLastRow() < 2) return '';
  var D = function (h) { return DATA_HEAD.indexOf(h); }, key = normDist_(groupLabel), lbl = periodeLabel(periode), hit = '';
  sh.getRange(2, 1, sh.getLastRow() - 1, DATA_HEAD.length).getValues().forEach(function (v) {
    if (!hit && v[0] !== excludeId && normDist_(v[D('Distributor / Group')]) === key && String(v[D('Periode')]) === lbl && String(v[D('Status')]).trim() !== 'Ditolak') hit = v[0];
  });
  return hit;
}

/* ===================== MENU ADMIN ===================== */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Kompetisi AO 2000')
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
  note_('Klaim ' + id + ' siap di sheet Cetak. File > Print: Current sheet, Portrait, Fit to width.');
}

function regenPdfSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  var row = findDataRow_(ss, id);
  if (!isVerifiedRow_(ss, row)) { note_('Klaim ' + id + ' belum diverifikasi. Ubah Status menjadi "Diverifikasi" — PDF dibuat otomatis.'); return; }
  writePdfLink_(ss, row, id);
  note_('PDF klaim ' + id + ' sudah dibuat ulang.');
}

function recalcSelected() {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), id = selectedId_(ss);
  if (!id) return;
  note_('Menghitung ulang ' + id + '…');
  try {
    var r = recalcClaim_(ss, id);
    note_(id + ' dihitung ulang. Pemenang: ' + (r.before || '-') + ' → ' + (r.after || 'tidak ada') + '.' +
      (isVerifiedRow_(ss, findDataRow_(ss, id)) ? ' PDF diperbarui.' : ' PDF dibuat setelah status Diverifikasi.'));
  } catch (e) { note_('Gagal menghitung ulang ' + id + ': ' + e.message); }
}

function selectedId_(ss) {
  var sh = ss.getActiveSheet();
  if ([SHEET.data, SHEET.sales].indexOf(sh.getName()) < 0) { note_('Buka sheet Data Klaim / Data Salesman, lalu klik baris klaimnya.'); return ''; }
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
  var C = function (h) { return SALES_HEAD.indexOf(h); };
  var inv = {}; Object.keys(METHODS).forEach(function (k) { inv[METHODS[k]] = k; });
  var srows = rowsFor_(ss.getSheetByName(SHEET.sales), SALES_HEAD, id);
  var input = {groupLabel: rec.head.groupLabel, members: rec.head.members, periode: rec.head.periode,
    pengaju: str_(d[D('Diajukan Oleh')], 80), kontak: str_(d[D('Kontak')], 60),
    rows: srows.map(function (s) {
      var v = s.v;
      return {dist: String(v[C('Distributor')]).trim(), name: String(v[C('Salesman')]).trim(), ao: num_(v[C('AO SKU 2000')]), value: num_(v[C('Nilai SKU 2000 (Rp)')]),
        target: num_(v[C('Target AO')]), _row: s.row,
        pay: {m: inv[String(v[C('Metode Bayar')]).trim()] || 'own', bank: str_(v[C('Bank / No. Rek')], 80), cab: str_(v[C('Cabang')], 60), an: str_(v[C('A/N')], 80)}};
    })};
  return {id: id, row: row, rec: rec, input: input, claim: computeKomp(input, rec.settings)};
}

function recalcClaim_(ss, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var L, before;
  try {
    L = loadClaim_(ss, id);
    var rec = L.rec, claim = L.claim, input = L.input, now = new Date(), who = userEmail_(), w = claim.winner;
    before = rec.totals.winner || '';
    var logs = [];
    (rec.rowsSnapshot || []).forEach(function (o) {
      var n = input.rows.filter(function (r) { return r.dist === o.dist && r.name === o.name; })[0];
      if (!n) return;
      [['ao', 'AO SKU 2000'], ['value', 'Nilai SKU 2000'], ['target', 'Target AO']].forEach(function (f) {
        if ((o[f[0]] || 0) !== (n[f[0]] || 0)) logs.push([now, id, who, cell_(n.name + ' (' + n.dist + ')'), f[1], o[f[0]] || 0, n[f[0]] || 0]);
      });
    });
    logs.push([now, id, who, '(klaim)', 'Pemenang', before, w ? w.name : '']);
    if (!rec.original) rec.original = {totals: rec.totals};
    rec.totals = totalsOf_(claim);
    rec.rowsSnapshot = input.rows.map(function (r) { return {dist: r.dist, name: r.name, ao: r.ao, value: r.value, target: r.target}; });
    rec.revisions = (rec.revisions || []).concat([{at: Utilities.formatDate(now, TZ, 'dd/MM/yyyy HH:mm'), by: who}]);
    writeSales_(ss, id, input, claim, input.rows.map(function (r) { return r._row; }));
    var dsh = ss.getSheetByName(SHEET.data), D = function (h) { return DATA_HEAD.indexOf(h) + 1; };
    dsh.getRange(L.row, D('Jml Salesman'), 1, 9).setValues([[claim.rows.length, claim.eligibleCount, w ? cell_(w.name) : '— (tidak ada)', w ? cell_(w.dist) : '',
      w ? w.ao : '', w ? w.target : '', claim.total, claim.pay.tax, claim.totalNet]]);
    dsh.getRange(L.row, 1, 1, DATA_HEAD.length).setBackground(null);
    var nc = dsh.getRange(L.row, D('Catatan Admin'));
    var old = String(nc.getValue() || '').replace(/\s*\[Revisi ke-\d+ \([^)]*\)\]$/, '');
    nc.setValue((old ? old + ' ' : '') + '[Revisi ke-' + rec.revisions.length + ' (' + rec.revisions[rec.revisions.length - 1].at + ')]');
    if (!isVerifiedRow_(ss, L.row)) dsh.getRange(L.row, D('PDF')).setValue(w ? PDF_WAIT : '— (tidak ada)');
    dsh.getRange(L.row, D('_data')).setValue(JSON.stringify(rec));
    var lsh = ss.getSheetByName(SHEET.log);
    lsh.getRange(lsh.getLastRow() + 1, 1, logs.length, LOG_HEAD.length).setValues(logs);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  if (isVerifiedRow_(ss, L.row)) writePdfLink_(ss, L.row, id);
  return {before: before, after: L.claim.winner ? L.claim.winner.name : ''};
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
    var map = {}; map[SHEET.data] = [DATA_HEAD, DATA_EDITABLE]; map[SHEET.sales] = [SALES_HEAD, SALES_EDITABLE];
    var m = map[name]; if (!m) return;
    if (m[1].indexOf(m[0][e.range.getColumn() - 1]) < 0) return;
    e.range.setBackground(EDIT_MARK);
    e.source.toast('Klik baris ini lalu menu Kompetisi AO 2000 > Hitung ulang klaim terpilih agar peringkat, pemenang & PDF ikut berubah.', 'Data diubah', 8);
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
  } catch (err) { e.source.toast('Gagal memproses status: ' + err.message, 'Kompetisi AO 2000', 10); }
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
      ss.toast('Klaim ' + id + ' diverifikasi. PDF sedang dibuat…', 'Kompetisi AO 2000', 8);
      SpreadsheetApp.flush();
      processPdfQueue();
    }
  } else {
    var pulled = trashPdf_(cell);
    cell.setValue(rec.totals.total > 0 ? PDF_WAIT : '— (tidak ada)');
    if (rec.verified) { delete rec.verified; sh.getRange(row, D('_data')).setValue(JSON.stringify(rec)); }
    if (pulled) ss.toast('Status ' + id + ' menjadi "' + status + '". PDF ditarik ke Trash.', 'Kompetisi AO 2000', 8);
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
    var cP = DATA_HEAD.indexOf('PDF');
    sh.getRange(2, 1, sh.getLastRow() - 1, DATA_HEAD.length).getValues().forEach(function (v, i) { if (v[cP] === PDF_PENDING) todo.push({row: i + 2, id: String(v[0])}); });
  } finally { lock.releaseLock(); }
  for (var i = 0; i < todo.length; i++) {
    if (Date.now() - started > 4 * 60 * 1000) { leftover = true; break; }
    writePdfLink_(ss, todo[i].row, todo[i].id);
    SpreadsheetApp.flush();
  }
  if (leftover) ScriptApp.newTrigger(PDF_HANDLER).timeBased().after(30 * 1000).create();
}

function writePdfLink_(ss, row, id) {
  var cell = ss.getSheetByName(SHEET.data).getRange(row, DATA_HEAD.indexOf('PDF') + 1);
  trashPdf_(cell);
  try {
    var L = loadClaim_(ss, id);
    if (!L.claim.winner) { cell.setValue('— (tidak ada)'); return; }
    var file = makePdf_(ss, L);
    cell.setFormula('=HYPERLINK("' + file.getUrl() + '","PDF Klaim")');
  } catch (e) { cell.setValue('Gagal: ' + e.message + ' (pakai menu Buat ulang PDF)'); }
}

function makePdf_(ss, L) {
  var tmp = ss.insertSheet('tmp_' + L.id + '_' + Date.now());
  try {
    var size = renderPrint_(tmp, L);
    SpreadsheetApp.flush();
    var url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + tmp.getSheetId() +
      '&size=A4&portrait=true&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=CENTER' +
      '&fzr=false&horizontal_alignment=CENTER&top_margin=0.4&bottom_margin=0.4&left_margin=0.4&right_margin=0.4' +
      '&r1=0&c1=0&r2=' + size.rows + '&c2=' + size.cols;
    var resp, tries = 0;
    do {
      resp = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()}, muteHttpExceptions: true});
      if (resp.getResponseCode() === 429) Utilities.sleep(3000 * (tries + 1));
    } while (resp.getResponseCode() === 429 && ++tries < 3);
    if (resp.getResponseCode() !== 200) throw new Error('export PDF ' + resp.getResponseCode());
    var name = L.id + ' - Kompetisi AO 2000 - ' + L.input.groupLabel + ' - ' + periodeLabel(L.input.periode);
    return pdfFolder_().createFile(resp.getBlob().setName(name.replace(/[\\\/:*?"<>|]/g, ' ') + '.pdf'));
  } finally { ss.deleteSheet(tmp); }
}

function pdfFolder_() { return folder_('folderId', 'Kompetisi AO 2000 - PDF'); }
function srcFolder_() { return folder_('srcFolderId', 'Kompetisi AO 2000 - File Transaksi'); }
function folder_(key, name) {
  var id = String(getSettings_()[key] || '').trim();
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var folder = DriveApp.createFolder(name);
  setSetting_(key, folder.getId());
  return folder;
}
function trashPdf_(cell) {
  var m = String(cell.getFormula() || '').match(/\/d\/([\w-]{20,})/);
  if (!m) return false;
  try { DriveApp.getFileById(m[1]).setTrashed(true); return true; } catch (e) { return false; }
}

/* ===================== TEMPLATE CETAK (A4 portrait) ===================== */
function renderPrint_(sh, L) {
  var C = L.claim, I = L.input, rec = L.rec, S = rec.settings, N = 8, w = C.winner;
  var green = '#0f5c4a', soft = '#e8f2ee', grey = '#f3f4f2', border = '#9aa09c';
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  if (sh.getMaxColumns() < N) sh.insertColumnsAfter(sh.getMaxColumns(), N - sh.getMaxColumns());
  if (sh.getMaxColumns() > N) sh.deleteColumns(N + 1, sh.getMaxColumns() - N);
  var need = 60 + C.rows.length;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.setHiddenGridlines(true);
  [40, 150, 130, 70, 105, 70, 80, 150].forEach(function (x, i) { sh.setColumnWidth(i + 1, x); });
  var r = 1;
  var put = function (row, c1, c2, val) { if (typeof val === 'string') val = cell_(val); var rg = sh.getRange(row, c1, 1, c2 - c1 + 1); if (c2 > c1) rg.merge(); rg.setValue(val); return rg; };
  var box = function (r1, r2) { sh.getRange(r1, 1, r2 - r1 + 1, N).setBorder(true, true, true, true, true, true, border, SpreadsheetApp.BorderStyle.SOLID); };

  put(r++, 1, N, 'KLAIM INSENTIF KOMPETISI AO SKU 2000').setFontSize(15).setFontWeight('bold').setHorizontalAlignment('center').setFontColor(green);
  put(r++, 1, N, S.entity).setFontSize(11).setFontWeight('bold').setHorizontalAlignment('center');
  if (!rec.verified) put(r, 1, N, 'DRAFT — BELUM DIVERIFIKASI ADMIN · TIDAK UNTUK PEMBAYARAN').setFontWeight('bold').setFontColor('#b3261e').setHorizontalAlignment('center');
  sh.getRange(r, 1, 1, N).setBorder(null, null, true, null, null, null, green, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
  r += 2;
  var info = [['No. Klaim', L.id, 'Periode', periodeLabel(I.periode)],
              ['Distributor / Group', I.groupLabel, 'Diajukan oleh', I.pengaju + (I.kontak ? ' (' + I.kontak + ')' : '')],
              ['Anggota', I.members.join(', '), 'Tanggal submit', rec.submittedAt]];
  if (rec.revisions && rec.revisions.length) info.push(['Status data', 'Dikoreksi admin (revisi ke-' + rec.revisions.length + ', ' + rec.revisions[rec.revisions.length - 1].at + ')', 'Pemenang awal', (rec.original && rec.original.totals.winner) || '-']);
  if (rec.verified) info.push(['Diverifikasi', (rec.verified.by || 'admin') + ' · ' + rec.verified.at, 'Status', rec.verified.status]);
  info.forEach(function (x) { put(r, 1, 2, x[0]).setFontWeight('bold'); put(r, 3, 4, ': ' + x[1]); put(r, 5, 6, x[2]).setFontWeight('bold'); put(r, 7, 8, ': ' + x[3]); r++; });
  r++;

  put(r++, 1, N, 'A. PERINGKAT AO SKU 2000 (NON MONEY MOUSE)').setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var h = r;
  sh.getRange(r++, 1, 1, N).setValues([['Rank', 'Salesman', 'Distributor', 'AO', 'Nilai SKU 2000 (Rp)', 'Target AO', 'Pencapaian', 'Keterangan']])
    .setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setWrap(true);
  var rows = C.order.map(function (x) {
    return [x.rank, cell_(x.name), cell_(x.dist), x.ao, x.value, x.target || '-', x.target ? x.ach : '-', x.winner ? 'PEMENANG' + (x.tieNote ? ' (' + x.tieNote + ')' : '') : x.eligible ? 'Memenuhi target' : x.why];
  });
  if (rows.length) {
    sh.getRange(r, 1, rows.length, N).setValues(rows);
    sh.getRange(r, 1, rows.length, 1).setHorizontalAlignment('center');
    sh.getRange(r, 4, rows.length, 1).setHorizontalAlignment('center');
    sh.getRange(r, 5, rows.length, 1).setNumberFormat('#,##0');
    sh.getRange(r, 6, rows.length, 1).setHorizontalAlignment('center');
    sh.getRange(r, 7, rows.length, 1).setNumberFormat('0.0%').setHorizontalAlignment('center');
    sh.getRange(r, 8, rows.length, 1).setWrap(true).setFontSize(8);
    C.order.forEach(function (x, j) { if (x.winner) sh.getRange(r + j, 1, 1, N).setFontWeight('bold').setBackground('#e6f4ec'); });
    r += rows.length;
  }
  box(h, r - 1); r++;

  put(r++, 1, N, 'B. RINCIAN PEMBAYARAN INSENTIF').setFontWeight('bold').setBackground(green).setFontColor('#ffffff');
  var ph = r, P = C.pay;
  sh.getRange(r++, 1, 1, N).setValues([['No', 'Penerima', 'Distributor', 'Metode', 'Bank / No. Rek', 'Nominal', 'Pajak', 'Diterima']])
    .setFontWeight('bold').setBackground(soft).setHorizontalAlignment('center').setWrap(true);
  var pf = r;
  P.list.forEach(function (x, j) {
    sh.getRange(r++, 1, 1, N).setValues([[j + 1, cell_(x.name) + (x.an ? ' (a.n. ' + cell_(x.an) + ')' : ''), cell_(x.dist), METHODS[x.m] + (x.rate ? ' (' + String(x.rate).replace('.', ',') + '%)' : ''),
      cell_([x.bank, x.cab].filter(String).join(' · ')), x.nom, x.tax, x.net]]);
  });
  if (!P.list.length) put(r++, 1, N, 'Tidak ada salesman yang mencapai target AO SKU 2000.').setFontStyle('italic');
  sh.getRange(r, 1, 1, N).setValues([['', 'TOTAL', '', '', '', P.nom, P.tax, P.net]]).setFontWeight('bold').setBackground(grey);
  sh.getRange(pf, 6, r - pf + 1, 3).setNumberFormat('#,##0').setHorizontalAlignment('right');
  sh.getRange(pf, 1, r - pf + 1, 1).setHorizontalAlignment('center');
  sh.getRange(pf, 2, r - pf + 1, 4).setWrap(true);
  box(ph, r); r++;
  put(r, 1, N, 'Terbilang: ' + terbilang_(P.net) + ' rupiah').setFontStyle('italic').setFontWeight('bold');
  r += 2;

  var src = (rec.source || []).map(function (s) { return s.dist + ': ' + s.fileName + ' (' + fmtDate(s.dataMin) + ' – ' + fmtDate(s.dataMax) + ')'; }).join('; ');
  var notes = ['Catatan perhitungan:',
    '• AO SKU 2000 = jumlah outlet berbeda dengan pembelian bersih minimal ' + fmtDus(S.minDus || 1) + ' karton SKU 2000 non Money Mouse dalam periode, per salesman (qty PCS / renceng dikonversi ke dus). SKU dikenali dari kata kunci: ' + S.skuInclude + ' (kecuali ' + S.skuExclude + ').',
    '• Pemenang: satu salesman dengan AO tertinggi per ' + (I.members.length > 1 ? 'group (' + I.members.join(' + ') + ')' : 'distributor') + ', dengan syarat AO ≥ target AO SKU 2000. AO sama → nilai SKU 2000 tertinggi.',
    '• Insentif Rp ' + fmtNum_(S.prize) + ' untuk satu orang. Pajak: rekening sendiri < Rp ' + fmtNum_(S.ownThr) + ' = 0%; titip rekening kumulatif ≥ Rp ' + fmtNum_(S.titipThr) + ' = ' + String(S.titipRate).replace('.', ',') + '%; rekening perusahaan = ' + String(S.coRate).replace('.', ',') + '%.',
    '• Sumber data: ' + src];
  notes.forEach(function (t, j) { put(r++, 1, N, t).setFontSize(8).setFontColor('#555555').setWrap(true).setFontWeight(j ? 'normal' : 'bold'); });
  r++;
  [[1, 2, 'Dibuat oleh,', 'Distributor'], [3, 4, 'Diperiksa oleh,', 'SPV / ASM'], [5, 6, 'Disetujui oleh,', 'Head of Sales'], [7, 8, 'Diterima oleh,', 'Finance']].forEach(function (s) {
    put(r, s[0], s[1], s[2]).setHorizontalAlignment('center');
    put(r + 4, s[0], s[1], '(____________________)').setHorizontalAlignment('center');
    put(r + 5, s[0], s[1], s[3]).setHorizontalAlignment('center').setFontWeight('bold');
  });
  r += 5;
  sh.getRange(1, 1, r, N).setFontFamily('Arial');
  sh.getRange(5, 1, r - 4, N).setFontSize(9);
  return {rows: r, cols: N};
}

/* ===================== SETUP ===================== */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheets_(ss);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === STATUS_HANDLER; });
  if (!has) ScriptApp.newTrigger(STATUS_HANDLER).forSpreadsheet(ss).onEdit().create();
  srcFolder_();
  try { onOpen(); } catch (e) {}
  ss.toast('Struktur sheet siap. Lengkapi sheet Daftar Distributor, lalu Deploy > New deployment > Web app.', 'Kompetisi AO 2000', 10);
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
  if (!ss.getSheetByName(SHEET.dist)) header_(ss, SHEET.dist, DIST_HEAD, function (sh) {
    sh.getRange(2, 1, DIST_SEED.length, 3).setValues(DIST_SEED);
    sh.setColumnWidth(1, 220); sh.setColumnWidth(2, 260);
    sh.getRange('C2:C').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['YA', 'TIDAK'], true).build());
  });
  header_(ss, SHEET.data, DATA_HEAD, function (sh) {
    sh.getRange('B:B').setNumberFormat('dd/MM/yyyy HH:mm'); sh.getRange('N:P').setNumberFormat('#,##0');
    sh.getRange('Q2:Q').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS, true).build());
    sh.hideColumns(DATA_HEAD.indexOf('_data') + 1); sh.setColumnWidth(1, 120); sh.setColumnWidth(3, 200);
  });
  header_(ss, SHEET.sales, SALES_HEAD, function (sh) {
    sh.getRange('G:G').setNumberFormat('#,##0'); sh.getRange('I:I').setNumberFormat('0.0%'); sh.getRange('R:S').setNumberFormat('#,##0');
    sh.getRange('N2:N').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(METHODS).map(function (k) { return METHODS[k]; }), true).build());
  });
  header_(ss, SHEET.log, LOG_HEAD, function (sh) { sh.getRange('A:A').setNumberFormat('dd/MM/yyyy HH:mm'); });
  markEditable_(ss.getSheetByName(SHEET.data), DATA_HEAD, DATA_EDITABLE);
  markEditable_(ss.getSheetByName(SHEET.sales), SALES_HEAD, SALES_EDITABLE);
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
    if (editable.indexOf(h) >= 0) cell.setBackground('#b86a00').setNote('Boleh dikoreksi admin. Setelah edit, jalankan menu Kompetisi AO 2000 > Hitung ulang klaim terpilih.');
    else if (h !== '_data') cell.setBackground('#0f5c4a');
  });
}

/* ===================== HELPERS ===================== */
function getSettings_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set), S = {};
  SETTINGS.forEach(function (s) { S[s[2]] = s[1]; });
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) { if (r[2]) S[r[2]] = r[1]; });
  S.packRules = String(S.packRules == null ? '' : S.packRules);
  ['prize', 'minDus', 'ownThr', 'titipThr', 'titipRate', 'coRate'].forEach(function (k) {
    S[k] = typeof S[k] === 'number' ? S[k] : parseFloat(String(S[k]).replace(/\./g, '').replace(',', '.')) || 0;
  });
  return S;
}
function pubSettings_(S) { return {prize: S.prize, skuInclude: S.skuInclude, skuExclude: S.skuExclude, minDus: S.minDus || 1, packRules: S.packRules, ownThr: S.ownThr, titipThr: S.titipThr, titipRate: S.titipRate, coRate: S.coRate, entity: S.entity}; }
function setSetting_(key, value) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET.set);
  var keys = sh.getRange(2, 3, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < keys.length; i++) if (keys[i][0] === key) { sh.getRange(i + 2, 2).setValue(value); return; }
}
function yes_(v) { return String(v == null ? 'YA' : v).trim().toUpperCase() !== 'TIDAK'; }
function headOf_(i) { return {groupLabel: i.groupLabel, members: i.members.map(function (m) { return m.dist || m; }), periode: i.periode, pengaju: i.pengaju, kontak: i.kontak}; }
function totalsOf_(c) { return {winner: c.winner ? c.winner.name : '', eligible: c.eligibleCount, total: c.total, tax: c.pay.tax, totalNet: c.totalNet}; }
function filesCell_(files) {
  if (!files.length) return '';
  if (files.length === 1 && files[0].url) return '=HYPERLINK("' + files[0].url + '","' + String(files[0].name).replace(/"/g, '') + '")';
  return files.map(function (f) { return f.dist + ': ' + (f.url || '(gagal simpan)'); }).join('\n');
}
function str_(v, max) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max || 120); }
function num_(v) { v = Number(v); return isFinite(v) && v > 0 ? Math.min(v, 1e13) : 0; }
function cell_(s) { s = String(s == null ? '' : s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function normDist_(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function note_(msg) { SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Kompetisi AO 2000', 10); }
function userEmail_() { try { return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail(); } catch (e) { return ''; } }
function fmtNum_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

function sanitize_(p, S) {
  if (!p || typeof p !== 'object') throw new Error('Data tidak valid.');
  var periode = str_(p.periode, 7);
  if (!/^\d{4}-\d{2}$/.test(periode)) throw new Error('Periode klaim wajib dipilih.');
  var pengaju = str_(p.pengaju, 80);
  if (!pengaju) throw new Error('Nama pengaju wajib diisi.');
  var entry, members;
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
  members = entry.members.map(function (dist) {
    var m = got.filter(function (x) { return x && normDist_(x.dist) === normDist_(dist); })[0];
    if (!m) throw new Error('Data transaksi ' + dist + ' belum di-upload.');
    var dataMin = toISO(m.dataMin), dataMax = toISO(m.dataMax);
    if (!dataMin || dataMin > periode + '-07') throw new Error('Data ' + dist + ' harus mencakup awal ' + periodeLabel(periode) + ' (file mulai ' + fmtDate(dataMin) + ').');
    if (!dataMax || dataMax < periode + '-24') throw new Error('Data ' + dist + ' belum mencakup akhir ' + periodeLabel(periode) + ' (file sampai ' + fmtDate(dataMax) + ').');
    var tx = (Array.isArray(m.tx) ? m.tx : []).slice(0, 300000).map(function (t) {
      var b = str_(t.b, 100), kb = str_(t.kb, 40);
      var q = t.qr !== undefined ? toDus(t.qr, t.u, b, kb, S) : Number(t.q) || 0;   // konversi satuan dihitung ulang di server
      return {d: toISO(t.d), k: str_(t.k, 40), s: str_(t.s, 80), q: q, v: Number(t.v) || 0, b: b, kb: kb};
    }).filter(function (t) { return t.d && t.k && t.q !== null && isSku2000(t.b, t.kb, S); });
    return {dist: dist, fileId: str_(m.fileId, 100), fileName: str_(m.fileName, 120), dataMin: dataMin, dataMax: dataMax, rowsRead: Number(m.rowsRead) || 0, tx: tx};
  });
  var ao = computeAo(members, periode, S);
  if (!ao.length) throw new Error('Tidak ada transaksi SKU 2000 di periode ' + periodeLabel(periode) + '.');
  var extra = {};
  (Array.isArray(p.rows) ? p.rows : []).forEach(function (r) {
    if (!r) return;
    var pay = r.pay || {};
    extra[normDist_(r.dist) + '|' + str_(r.name, 80)] = {target: num_(r.target), pay: {m: METHODS[pay.m] ? pay.m : 'own', bank: str_(pay.bank, 80), cab: str_(pay.cab, 60), an: str_(pay.an, 80)}};
  });
  var rows = ao.map(function (a) {
    var x = extra[normDist_(a.dist) + '|' + a.name] || {target: 0, pay: {m: 'own', bank: '', cab: '', an: ''}};
    return {dist: a.dist, name: a.name, ao: a.ao, value: a.value, target: Math.round(x.target), pay: x.pay};
  });
  if (!rows.some(function (r) { return r.target > 0; })) throw new Error('Isi target AO SKU 2000 minimal untuk satu salesman.');
  return {groupLabel: entry.label, members: members, periode: periode, pengaju: pengaju, kontak: str_(p.kontak, 60), rows: rows};
}

function nextId_(sh, now) {
  var prefix = 'AO-' + Utilities.formatDate(now, TZ, 'yyMM') + '-', n = 0;
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
