'use strict';
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
      res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline'; frame-ancestors https: http://localhost:* http://127.0.0.1:*");
    } else if (req.path.startsWith('/admin')) {
      // Painel do lojista: não pode ser emoldurado (clickjacking).
      res.set('X-Frame-Options', 'DENY');
      res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    }
    next();
  });

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/favicon.ico', (req, res) => res.set('Cache-Control', 'public, max-age=604800').sendFile(path.join(__dirname, '..', 'public', 'favicon.ico')));

  // Script da vitrine com a URL da API embutida (em produção o mesmo arquivo
  // é gerado por `npm run build:script` e enviado ao Portal de Parceiros).
  const { renderLoader } = require('../scripts/build-loader');
  app.get('/storefront/loader.js', (req, res) => {
    res.type('application/javascript').set('Cache-Control', 'public, max-age=300')
      .set('Access-Control-Allow-Origin', '*').send(renderLoader(config.appUrl));
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
  app.use('/tryon', express.static(path.join(pub, 'tryon'), { maxAge: config.devMode ? 0 : '1h' }));
  app.use('/admin', express.static(path.join(pub, 'admin'), { maxAge: 0 }));
  // Marca (logo usada no painel, no provador e no cartão da vitrine).
  app.use('/brand', express.static(path.join(pub, 'brand'), {
    maxAge: config.devMode ? 0 : '30d',
    setHeaders: (res) => res.set('Access-Control-Allow-Origin', '*'),
  }));
  // Página pública de privacidade e método (link discreto fora do card do provador).
  app.use('/privacidade', express.static(path.join(pub, 'privacidade'), { maxAge: config.devMode ? 0 : '1h' }));
  // em teste, a raiz já entra no painel da loja demo; em produção o painel abre pela Nuvemshop
  app.get('/', (req, res) => res.redirect(config.devMode ? '/dev/login' : '/admin/'));

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
