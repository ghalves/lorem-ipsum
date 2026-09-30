'use strict';
/**
 * Gera o script da vitrine com a URL da API embutida.
 *   APP_URL=https://provador.suaempresa.com npm run build:script
 * Envie dist/loader.js no Portal de Parceiros (Scripts > nova versão).
 */
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'public', 'storefront', 'loader.js');

function renderLoader(appUrl) {
  return fs.readFileSync(SRC, 'utf8').replace(/__APP_URL__/g, String(appUrl).replace(/\/$/, ''));
}

if (require.main === module) {
  const config = require('../src/config');
  const out = path.join(__dirname, '..', 'dist', 'loader.js');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, renderLoader(config.appUrl));
  console.log(`dist/loader.js gerado para ${config.appUrl} (${fs.statSync(out).size} bytes)`);
}

module.exports = { renderLoader };
