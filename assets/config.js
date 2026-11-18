/**
 * KONFIGURASI PORTAL KLAIM INSENTIF
 * ---------------------------------
 * URL Web App Apps Script (backend) untuk masing-masing form.
 * Bila ada deployment Apps Script baru dengan URL berbeda, cukup ganti di sini,
 * commit ke GitHub, dan Vercel akan deploy ulang otomatis.
 */
window.KLAIM_CONFIG = {
  api: {
    sales:       'https://script.google.com/macros/s/AKfycbyvqTF6_K4qGETjAl1Lwusy0jN91Ias_KzO6BdLDB94FAyBYhyy1ClalMV98G34cA4Azw/exec',
    noo:         'https://script.google.com/macros/s/AKfycbzUgLSH2q3ALsKvuVNDEDPqYM19siJT1hOOvLChSFnpM35pmX5gVTFAkp4FvfNcn0zIvA/exec',
    kompetisi:   'https://script.google.com/macros/s/AKfycbxdtdquz3clxJ53Gv0ZrDQwilxsOrZdg2PXYFtiJtvBlRL8cvfmDBlO8JdrqXXeZf2DFA/exec',
    spv:         'https://script.google.com/macros/s/AKfycbzM_OevxiEHf1IjyLZUGxpO7ru3aoh9-17tjOMTct3si2XcAXeLFjV2shcJNax5gH2n/exec',
    distributor: 'https://script.google.com/macros/s/AKfycbzwEnGZIpX0XJM5p-OGBxSqmUXO9cg2zrvboPYZlXHQZSfK8G-HlkzlRZNX3VT3rxWscA/exec',
    salesClass:  ''   // ← tempel URL Web App form Insentif Salesman Class A/B di sini
  },
  // batas waktu panggilan ke server (ms) — upload file transaksi bisa agak lama
  timeoutMs: 180000
};
