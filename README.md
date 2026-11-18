# Portal Klaim Insentif Distributor — Harum Group

Frontend (portal + 5 form klaim) di-host di **Vercel** dari repo GitHub ini.
Backend tetap di **Google Apps Script** masing-masing program (sudah terhubung ke Google Sheet admin).

```
Distributor ──► Vercel (halaman portal & form)
                   │  fetch POST {fn, args}
                   ▼
            Apps Script Web App (doPost)  ──►  Google Sheet admin + PDF di Drive
```

| Halaman Vercel | Form | Folder Apps Script | Kunci di `assets/config.js` |
|---|---|---|---|
| `/` | Portal (menu) | – | – |
| `/insentif-salesman` | Insentif Salesman Distributor | `apps-script/insentif-salesman` | `sales` |
| `/noo-opak` | Insentif NOO BMX Opak | `apps-script/noo-opak` | `noo` |
| `/kompetisi-ao2000` | Kompetisi AO SKU 2000 | `apps-script/kompetisi-ao2000` | `kompetisi` |
| `/insentif-spv` | Insentif SPV Distributor | `apps-script/insentif-spv` | `spv` |
| `/insentif-distributor` | Insentif Distributor (kuartal) | `apps-script/insentif-distributor` | `distributor` |
| `/insentif-salesman-class` | Insentif Salesman Class A/B | `apps-script/insentif-salesman-class` | `salesClass` |

## Struktur repo

```
apps-script/<form>/Code.gs     ← backend, ditempel ke project Apps Script masing-masing
apps-script/<form>/Index.html  ← tampilan form (SATU sumber untuk Apps Script & Vercel)
apps-script/portal-lama/       ← portal versi Apps Script (cadangan, tidak dipakai Vercel)
portal/index.html              ← halaman portal di Vercel
assets/config.js               ← URL Web App Apps Script tiap form
assets/gas-bridge.js           ← penghubung: google.script.run → fetch ke Apps Script
assets/klaim-ui.css / .js      ← tampilan seragam (header, isian, tombol, bar kirim) khusus versi Vercel
scripts/build.mjs              ← build Vercel: menyusun folder www/
vercel.json                    ← konfigurasi Vercel (build, clean URL, header)
```

Saat build, `scripts/build.mjs` menyalin `apps-script/<form>/Index.html` ke `www/<form>/index.html`
dan menyisipkan `config.js`, `gas-bridge.js` serta lapisan tampilan `klaim-ui`. Jadi tampilan form cukup diubah di satu tempat.

---

## Langkah 1 — Update kelima project Apps Script (wajib, sekali)

Backend perlu fungsi `doPost` (API JSON) agar bisa dipanggil dari Vercel. Untuk **setiap** program:

1. Buka project Apps Script program tsb.
2. Ganti isi `Code.gs` dengan `apps-script/<form>/Code.gs`, dan `Index.html` dengan `apps-script/<form>/Index.html`. Simpan.
3. **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy.**
   URL Web App **tidak berubah**, jadi `assets/config.js` tidak perlu diedit.
4. Cek: buka `URL_WEB_APP?fn=getPublicSettings` di browser → harus tampil JSON berawalan `{"ok":true,...}`.

Pastikan deployment tetap **Execute as: Me** dan **Who has access: Anyone**.

## Langkah 2 — Upload ke GitHub

Lewat web: github.com → **New repository** (disarankan *Private*) → **uploading an existing file** → tarik seluruh isi folder ini → *Commit*.

Atau lewat terminal:

```bash
cd klaim-insentif-portal
git init
git add .
git commit -m "Portal klaim insentif"
git branch -M main
git remote add origin https://github.com/<akun>/klaim-insentif-portal.git
git push -u origin main
```

## Langkah 3 — Deploy di Vercel

1. vercel.com → **Add New… → Project** → **Import** repo `klaim-insentif-portal` (hubungkan akun GitHub bila diminta).
2. Pengaturan terbaca otomatis dari `vercel.json` (Framework: *Other*, Build: `node scripts/build.mjs`, Output: `www`). Klik **Deploy**.
3. Link portal siap, mis. `https://klaim-insentif-portal.vercel.app`. Opsional: **Settings → Domains** untuk domain sendiri (mis. `klaim.harumgroup.co.id`).
4. Setiap `git push` ke `main` otomatis memicu deploy ulang.

Link Apps Script lama tetap berfungsi sebagai cadangan.

---

## Perawatan

| Ingin mengubah… | Lakukan |
|---|---|
| Tampilan / validasi form | Edit `apps-script/<form>/Index.html` → push ke GitHub (Vercel). Bila link Apps Script lama masih dipakai, tempel juga ke Apps Script. |
| Perhitungan / logika server | Edit `apps-script/<form>/Code.gs` → tempel ke Apps Script → **Deploy → Manage deployments → Edit → New version**. Logika hitung di form juga ada di `Index.html` (blok *LOGIKA*), jaga keduanya tetap sama. |
| URL Web App (deployment baru) | Ganti di `assets/config.js` → push. |
| Menu portal | Edit `portal/index.html` (daftar `FORMS`) → push. |
| Nominal, pajak, daftar distributor | Langsung di Google Sheet admin (sheet *Pengaturan* / *Daftar Distributor*). Tidak perlu deploy. |

Uji di komputer sendiri (perlu Node 18+): `npm run dev` lalu buka alamat yang muncul.

## Kendala umum

- **"Server tidak mengembalikan data…"** — Apps Script belum di-deploy versi baru (belum ada `doPost`), atau akses bukan *Anyone*. Ulangi Langkah 1.
- **"Alamat server untuk form ini belum diatur"** — URL di `assets/config.js` kosong/salah format (harus `https://script.google.com/macros/s/…/exec`).
- **Form lama di Apps Script masih tampil versi lama** — lupa *New version* saat deploy.
- **Upload file transaksi gagal** — maks. 10 MB per file; export cukup periode yang diperlukan.
