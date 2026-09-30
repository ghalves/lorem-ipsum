'use strict';
/**
 * API pública usada pelo script da vitrine (loader.js).
 * Não expõe token nem dados do lojista; tudo é chaveado pelo id da loja.
 */
const express = require('express');
const config = require('../config');
const svc = require('../lib/store-service');
const { createEventToken, verifyEventToken } = require('../lib/session');

const router = express.Router();

router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});
router.use(express.json({ limit: '20kb', type: ['application/json', 'text/plain'] }));

// Limite simples por IP (memória). Em produção, use Redis.
const hits = new Map();
router.use((req, res, next) => {
  const key = req.ip;
  const now = Date.now();
  const h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > 60000) { h.n = 0; h.t = now; }
  h.n++;
  hits.set(key, h);
  if (hits.size > 50000) hits.clear();
  if (h.n > 240) return res.status(429).json({ error: 'muitas requisições' });
  next();
});

function loadStore(req, res, next) {
  const store = svc.getStore(req.params.storeId);
  if (!store || store.uninstalled_at) return res.status(404).json({ error: 'loja não encontrada' });
  req.store = store;
  next();
}

/**
 * Origem autorizada a receber as mensagens do provador: o domínio da loja
 * (inclusive subdomínios) ou, em desenvolvimento, localhost.
 */
function allowedOrigin(store, origin) {
  if (typeof origin !== 'string' || !/^https?:\/\/[^/]+$/.test(origin)) return null;
  let host;
  try { host = new URL(origin).hostname; } catch { return null; }
  if (config.devMode && /^(localhost|127\.0\.0\.1)$/.test(host)) return origin;
  // store.domain guarda todos os endereços da loja, separados por vírgula
  const domains = String(store.domain || '').split(',')
    .map((d) => d.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').toLowerCase())
    .filter(Boolean);
  return domains.some((d) => host === d || host.endsWith(`.${d}`)) ? origin : null;
}

// Configuração do botão para a página de produto.
router.get('/:storeId/config', loadStore, (req, res) => {
  const settings = req.store.settings;
  const out = {
    enabled: settings.enabled,
    selectors: settings.selectors,
    product: null,
    tryon: { enabled: false },
    // vale 7 dias: a página de obrigado usa o mesmo token para ligar o pedido ao provador
    token: createEventToken(req.store.id, 7 * 24 * 3600),
  };
  res.set('Cache-Control', 'no-store');
  const productId = Number(req.query.product);
  if (!settings.enabled || !productId) return res.json(out);
  const product = svc.getProduct(req.store.id, productId);
  if (!product) return res.json(out);
  out.product = { id: product.id, name: product.name, image: product.image };
  const avail = require('../tryon/service').availability(req.store, product);
  out.tryon = {
    enabled: avail.enabled, kind: avail.kind || null, button: settings.tryon.button || 'Provar virtualmente',
    animate: settings.tryon.buttonAnimation !== false,
  };
  res.json(out);
});

/**
 * Página de "obrigado" da loja: o loader manda o número do pedido e os produtos
 * que o comprador provou (cada um com o token assinado na hora da prova). Só
 * vira venda quando a Nuvemshop confirma o pedido como pago (webhook order/paid)
 * e o produto provado está no pedido, então um envio falso não cria venda.
 */
router.post('/:storeId/conversion', loadStore, (req, res) => {
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  // exige o token da vitrine: só quem passou pela página de produto tem
  if (!verifyEventToken(b.token, req.store.id)) return res.status(401).json({ error: 'token inválido' });
  const orderId = typeof b.orderId === 'number' ? b.orderId
    : (typeof b.orderId === 'string' && /^\d{1,15}$/.test(b.orderId) ? Number(b.orderId) : NaN);
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return res.status(400).json({ error: 'pedido inválido' });
  // "tried" (loader atual) ou "recs" com size "__tryon" (loader antigo ainda em cache nas lojas)
  const list = Array.isArray(b.tried) ? b.tried : (Array.isArray(b.recs) ? b.recs.filter((r) => r && r.size === '__tryon') : []);
  // a prova precisa ter sido registrada por este servidor
  const tried = require('../lib/sync').verifiedTried(req.store.id, list);
  if (!tried.length) return res.json({ ok: true, saved: 0 });
  const saved = svc.saveOrderClaims(req.store.id, orderId, tried);
  // o pagamento já tinha sido confirmado antes desta página abrir: importa agora,
  // só quando o aviso trouxe produto novo (repetir o mesmo aviso não gasta a cota da API)
  if (saved > 0 && svc.orderWasPaid(req.store.id, orderId)) {
    require('../lib/sync').importOrder(req.store.id, orderId).catch(() => {});
  }
  res.json({ ok: true, saved });
});

module.exports = router;
module.exports.allowedOrigin = allowedOrigin;
