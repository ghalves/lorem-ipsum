'use strict';
/**
 * Gera os scripts da vitrine com a URL da API embutida.
 *   APP_URL=https://app.miaou.com.br npm run build:script
 * - dist/miaou-nube.js: app NubeSDK (o que a Nuvemshop exige); envie este no
 *   Portal de Parceiros.
 * - dist/loader.js: script antigo da Script API, mantido por compatibilidade.
 */
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '..', 'public', 'storefront');

function render(file, appUrl) {
  return fs.readFileSync(path.join(DIR, file), 'utf8').replace(/__APP_URL__/g, String(appUrl).replace(/\/$/, ''));
}
const renderLoader = (appUrl) => render('loader.js', appUrl);
const renderNubeApp = (appUrl) => render('nube-app.js', appUrl);

if (require.main === module) {
  const config = require('../src/config');
  const dist = path.join(__dirname, '..', 'dist');
  fs.mkdirSync(dist, { recursive: true });
  for (const [name, fn] of [['miaou-nube.js', renderNubeApp], ['loader.js', renderLoader]]) {
    fs.writeFileSync(path.join(dist, name), fn(config.appUrl));
    console.log(`dist/${name} gerado para ${config.appUrl} (${fs.statSync(path.join(dist, name)).size} bytes)`);
  }
}

module.exports = { renderLoader, renderNubeApp };
