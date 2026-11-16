/**
 * PORTAL KLAIM INSENTIF DISTRIBUTOR — halaman menu
 * Buat project Apps Script baru (script.google.com > New project), tempel file ini sebagai Code.gs
 * dan file HTML bernama "Hub", lalu Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
 * Link form diatur di bagian FORMS pada file Hub.html.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Hub')
    .setTitle('Portal Klaim Insentif Distributor — Harum Group')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
