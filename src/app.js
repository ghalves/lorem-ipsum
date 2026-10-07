'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const config = require('./config');
const { getDb } = require('./db');

function createApp({ schedulePurge = false } = {}) {
  getDb();
  if (schedulePurge) {
    const svc = require('./lib/store-service');
    const tryon = require('./tryon/service');
    const purge = () => {
      const r = svc.purgeOldData();
      if (r.events) console.log(`[retenção] ${r.events} eventos antigos apagados`);
    };
    const purgeTryon = () => {
      try {
        const r = tryon.purge();
        if (r.photos || r.outputs) console.log(`[provador] ${r.photos} fotos e ${r.outputs} provas expiradas apagadas`);
      } catch (e) { console.error('[provador] limpeza', e.message); }
    };
    purge();
    purgeTryon();
    setInterval(purge, 24 * 3600 * 1000).unref();
    setInterval(purgeTryon, 3600 * 1000).unref();
  }
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (req.path.startsWith('/tryon')) {
      // Tela do provador virtual: emoldurada pela loja; fotos locais via blob:
      // fontes do Google só para o "Estilo da loja" (o tema da loja já usa o mesmo serviço)
      res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors https: http://localhost:* http://127.0.0.1:*");
    } else if (req.path.startsWith('/dashboard')) {
      // Painel do lojista: não pode ser emoldurado (clickjacking).
      res.set('X-Frame-Options', 'DENY');
      // fontes do Google só na prévia do "Estilo da loja" em Preferências
      res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'");
    }
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/favicon.ico', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(__dirname, '..', 'public', 'favicon.ico')));

  // Script da vitrine com a URL da API embutida (em produção o mesmo arquivo
  // é gerado por `npm run build:script` e enviado ao Portal de Parceiros).
  const { renderLoader, renderNubeApp } = require('../scripts/build-loader');
  app.get('/storefront/loader.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300')
      .set('Access-Control-Allow-Origin', '*').send(renderLoader(config.appUrl));
  });
  // app NubeSDK (o arquivo enviado ao Portal é o dist/miaou-nube.js, igual a este)
  app.get('/storefront/nube-app.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300')
      .set('Access-Control-Allow-Origin', '*').send(renderNubeApp(config.appUrl));
  });

  app.use('/auth', require('./routes/auth'));
  app.use('/webhooks', require('./routes/webhooks'));
  app.use('/api/storefront', require('./routes/storefront'));
  app.use('/api/tryon', require('./routes/tryon'));
  app.use('/s', require('./routes/share'));
  app.use('/api/admin', require('./routes/admin'));
  if (config.devMode) app.use('/dev', require('./routes/dev'));

  const pub = path.join(__dirname, '..', 'public');
  // O provador roda em iframe dentro da loja: permitir ser emoldurado.
  // A página cita o CSS e o JS com a versão no endereço (?v=): uma atualização
  // chega na hora, sem o navegador do comprador usar o script antigo do cache.
  const tryonDir = path.join(pub, 'tryon');
  let tryonHtml = null;
  const renderTryonHtml = () => {
    const v = (f) => require('node:crypto').createHash('sha1').update(fs.readFileSync(path.join(tryonDir, f))).digest('hex').slice(0, 10);
    return fs.readFileSync(path.join(tryonDir, 'index.html'), 'utf8')
      .replace('href="tryon.css"', `href="tryon.css?v=${v('tryon.css')}"`)
      .replace('src="tryon.js"', `src="tryon.js?v=${v('tryon.js')}"`);
  };
  app.get(['/tryon/', '/tryon/index.html'], (req, res) => {
    if (!tryonHtml || config.devMode) tryonHtml = renderTryonHtml();
    res.set('Cache-Control', 'no-cache').type('html').send(tryonHtml);
  });
  app.use('/tryon', express.static(tryonDir, { maxAge: config.devMode ? 0 : '7d', index: false }));
  app.use('/dashboard', express.static(path.join(pub, 'admin'), { maxAge: 0 }));
  // Marca (logo usada no painel, no provador e no cartão da vitrine).
  app.use('/brand', express.static(path.join(pub, 'brand'), {
    maxAge: config.devMode ? 0 : '30d',
    setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*'),
  }));
  // Fonte Rethink Sans hospedada aqui mesmo: a CSP só permite arquivos do próprio servidor
  // (e assim o navegador do comprador não fala com o Google). Os arquivos não mudam.
  app.use('/fonts', express.static(path.join(pub, 'fonts'), { maxAge: config.devMode ? 0 : '365d', immutable: !config.devMode }));
  // Página pública de privacidade e método (link discreto fora do card do provador).
  app.use('/privacidade', express.static(path.join(pub, 'privacidade'), { maxAge: config.devMode ? 0 : '1h' }));
  // em teste, a raiz já entra no painel da loja demo; em produção o painel abre pela Nuvemshop
  app.get('/', (req, res) => res.redirect(config.devMode ? '/dev/login' : '/dashboard/'));

  app.use((req, res) => res.status(404).json({ error: 'não encontrado' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'erro interno' : err.message });
  });
  return app;
}

module.exports = { createApp };
