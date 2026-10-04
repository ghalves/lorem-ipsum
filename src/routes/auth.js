'use strict';
const express = require('express');
const crypto = require('node:crypto');
const config = require('../config');
const ns = require('../lib/nuvemshop');
const svc = require('../lib/store-service');
const sync = require('../lib/sync');
const { createSession } = require('../lib/session');

const router = express.Router();

const STATE_COOKIE = 'szp_state';
const cookieOptions = {
  httpOnly: true, sameSite: 'lax', secure: config.appUrl.startsWith('https'), maxAge: 600000, path: '/',
};

function readCookie(req, name) {
  const raw = req.get('cookie') || '';
  const hit = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null;
}

function setCookie(res, name, value, opts) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path}`, `Max-Age=${Math.floor(opts.maxAge / 1000)}`];
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.secure) parts.push('Secure');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  res.append('Set-Cookie', parts.join('; '));
}

// Início da instalação (link "Instalar" fora da loja de apps).
router.get('/install', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, STATE_COOKIE, state, cookieOptions);
  res.redirect(ns.authorizeUrl(state));
});

// URL de redirecionamento cadastrada no Portal de Parceiros.
// A Nuvemshop chama esta URL na instalação e sempre que o lojista abre o app.
router.get('/callback', async (req, res, next) => {
  try {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Parâmetro "code" ausente.');
    // Se a instalação começou em /auth/install, o state precisa bater (CSRF).
    const expected = readCookie(req, STATE_COOKIE);
    if (expected) {
      const a = Buffer.from(String(state || ''));
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(400).send('Instalação inválida: refaça a partir da loja de aplicativos.');
      }
      setCookie(res, STATE_COOKIE, '', { ...cookieOptions, maxAge: 0 });
    }
    const token = await ns.exchangeCode(String(code));
    const storeId = Number(token.user_id);
    const already = svc.getStore(storeId);
    let name = null;
    let domain = null;
    try {
      const info = await ns.client(storeId, token.access_token).getStore();
      name = svc.localized(info.name);
      // Todos os endereços da loja (o original da Nuvemshop e os domínios próprios):
      // o provador só conversa com a página se ela estiver num deles.
      const all = [info.original_domain].concat(info.domains || [])
        .map((d) => String(d || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase())
        .filter(Boolean);
      domain = [...new Set(all)].join(',') || null;
    } catch { /* opcional */ }
    svc.upsertStore({ id: storeId, accessToken: token.access_token, scope: token.scope, name, domain });
    if (!already || already.uninstalled_at) {
      sync.onInstall(storeId).catch((e) => console.error('[install]', e));
    } else {
      // já instalada: confere webhooks e scripts (reinstalação antes do aviso
      // app/uninstalled chegar deixaria a loja sem eles)
      sync.ensureSetup(storeId).catch((e) => console.error('[setup]', e));
    }
    res.redirect(`/dashboard/#session=${createSession(storeId)}`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
