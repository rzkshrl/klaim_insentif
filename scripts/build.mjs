/**
 * BUILD untuk Vercel (tanpa dependency).
 * Menyusun folder www/ dari:
 *   - portal/index.html                 → www/index.html
 *   - assets/*                          → www/assets/*
 *   - apps-script/<form>/Index.html     → www/<form>/index.html  (+ sisipan config.js & gas-bridge.js)
 * Sumber form hanya satu: file Index.html di folder apps-script (sama dengan yang ditempel di Apps Script).
 */
import {readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'www');

// slug halaman → [folder apps-script, kunci api di config.js]
const FORMS = {
  'insentif-salesman':    ['insentif-salesman', 'sales', 'Insentif Salesman'],
  'noo-opak':             ['noo-opak', 'noo', 'Insentif NOO BMX Opak'],
  'kompetisi-ao2000':     ['kompetisi-ao2000', 'kompetisi', 'Kompetisi AO SKU 2000'],
  'insentif-spv':         ['insentif-spv', 'spv', 'Insentif SPV'],
  'insentif-distributor': ['insentif-distributor', 'distributor', 'Insentif Distributor']
};

const FAVICON = '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2216%22 fill=%22%230f5c4a%22/%3E%3Ctext x=%2232%22 y=%2243%22 font-size=%2234%22 font-family=%22Arial%22 font-weight=%22700%22 fill=%22white%22 text-anchor=%22middle%22%3EH%3C/text%3E%3C/svg%3E">';

rmSync(out, {recursive: true, force: true});
mkdirSync(join(out, 'assets'), {recursive: true});

copyFileSync(join(root, 'portal', 'index.html'), join(out, 'index.html'));
for (const f of readdirSync(join(root, 'assets'))) copyFileSync(join(root, 'assets', f), join(out, 'assets', f));

for (const [slug, [folder, key, title]] of Object.entries(FORMS)) {
  let html = readFileSync(join(root, 'apps-script', folder, 'Index.html'), 'utf8');
  if (!html.includes('<head>')) throw new Error(`apps-script/${folder}/Index.html tidak memiliki <head>`);
  if (html.includes('gas-bridge.js')) throw new Error(`apps-script/${folder}/Index.html sudah berisi gas-bridge — jangan disisipkan manual`);
  html = html
    .replace('<base target="_top">\n', '')
    .replace('<head>', `<head>\n${FAVICON}\n<meta name="theme-color" content="#ffffff">\n<script src="/assets/config.js"></script>\n<script src="/assets/gas-bridge.js" data-app="${key}"></script>\n<script src="/assets/klaim-ui.js" data-title="${title}"></script>`)
    .replace('</head>', '<link rel="stylesheet" href="/assets/klaim-ui.css">\n</head>');
  mkdirSync(join(out, slug), {recursive: true});
  writeFileSync(join(out, slug, 'index.html'), html);
  console.log(`✓ /${slug}/  ← apps-script/${folder}/Index.html  (api: ${key})`);
}
console.log('✓ /  ← portal/index.html');
console.log('Build selesai → www/');
