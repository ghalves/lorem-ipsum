'use strict';
/**
 * API do provador virtual, usada pela tela do provador (iframe servido por este
 * mesmo servidor, então as chamadas são da mesma origem).
 *
 * O comprador é identificado só por um id aleatório criado no navegador
 * (shopper). A foto e as provas ficam presas a ele e expiram sozinhas.
 */
const express = require('express');
const fs = require('node:fs');
const config = require('../config');
const svc = require('../lib/store-service');
const tryon = require('../tryon/service');
const { createEventToken, verifyEventToken, createRecToken } = require('../lib/session');
const { allowedOrigin } = require('./storefront');

const router = express.Router({ mergeParams: true });

// limites por IP e por comprador: protege a cota do lojista de abuso
const buckets = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key) || { n: 0, t: now };
  if (now - b.t > windowMs) { b.n = 0; b.t = now; }
  b.n++;
  buckets.set(key, b);
  if (buckets.size > 50000) buckets.clear();
  return b.n > max;
}

function loadStore(req, res, next) {
  const store = svc.getStore(req.params.storeId);
  if (!store || store.uninstalled_at) return res.status(404).json({ error: 'loja não encontrada' });
  req.store = store;
  next();
}

function shopperOf(req) {
  return tryon.validShopper(req.get('x-shopper') || req.query.shopper || req.body?.shopperId);
}

function requireToken(req, res, next) {
  const token = req.get('x-szp-token') || req.body?.token;
  if (!verifyEventToken(token, req.store.id)) return res.status(401).json({ error: 'sessão do provador expirou: reabra o provador' });
  const shopper = shopperOf(req);
  if (!shopper) return res.status(400).json({ error: 'comprador inválido' });
  req.shopper = shopper;
  next();
}

const sendError = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'erro interno', code: e.code || null });

function sendImage(res, file, type) {
  if (!file || !fs.existsSync(file)) return res.status(404).json({ error: 'imagem expirada' });
  res.set('Cache-Control', 'private, max-age=3600').type(type || 'image/jpeg');
  fs.createReadStream(file).pipe(res);
}

router.use((req, res, next) => {
  // o loader da vitrine manda eventos de outra origem (sendBeacon/fetch simples)
  if (/\/(events|debug)$/.test(req.path)) res.set('Access-Control-Allow-Origin', '*');
  next();
});
router.use('/:storeId', loadStore);

// Abertura do provador: produto, disponibilidade, se precisa do WhatsApp e token.
router.get('/:storeId/session', (req, res) => {
  const product = svc.getProduct(req.store.id, req.query.product);
  if (!product) return res.status(404).json({ error: 'produto não encontrado' });
  const shopper = shopperOf(req);
  const avail = tryon.availability(req.store, product);
  const parentOrigin = allowedOrigin(req.store, req.query.origin);
  if (!parentOrigin && req.query.origin) require('../lib/sync').refreshDomainsThrottled(req.store.id).catch(() => {});
  // foto da variação escolhida na página (cor); só vale se for uma foto deste produto
  const image = svc.productImage(product, req.query.imageId);
  if (avail.enabled) tryon.prepare(req.store.id, product, image);
  const t = req.store.settings.tryon;
  res.set('Cache-Control', 'no-store').json({
    token: createEventToken(req.store.id),
    parentOrigin,
    available: avail.enabled,
    reason: avail.enabled ? null : avail.reason,
    kind: avail.kind || tryon.productKind(product),
    product: { id: product.id, name: product.name, image, price: product.price },
    needsLead: shopper ? tryon.needsLead(req.store, shopper) : false,
    hasLead: shopper ? tryon.hasLead(req.store.id, shopper) : false,
    history: shopper ? tryon.history(req.store.id, shopper, 1).length > 0 : false,
    storeName: req.store.name || '',
    brand: tryon.brandFor(req.store),
    leadCapture: Boolean(t.leadCapture),
    freeBeforeLead: Math.max(0, Math.floor(Number(t.freeBeforeLead ?? 1))),
    debug: config.tryon.debug,
  });
});

// Foto do comprador (JPEG já reduzido no navegador).
router.post('/:storeId/photo', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '9mb' }), requireToken, (req, res) => {
  if (limited(`p:${req.ip}`, 40, 3600000)) return res.status(429).json({ error: 'muitas fotos em pouco tempo' });
  const blocked = tryon.uploadBlocked(req.store, req.shopper, req.ip);
  if (blocked) return res.status(429).json({ error: 'você chegou ao limite de provas de hoje', code: blocked });
  try { res.status(201).json(tryon.savePhoto(req.store.id, req.shopper, req.body)); } catch (e) { sendError(res, e); }
});

router.get('/:storeId/photo/:photoId', (req, res) => {
  const photo = tryon.getPhoto(req.store.id, req.params.photoId, shopperOf(req));
  if (!photo) return res.status(404).json({ error: 'foto expirada' });
  sendImage(res, photo.path);
});

router.use(express.json({ limit: '10kb', type: ['application/json', 'text/plain'] }));

router.post('/:storeId/jobs', requireToken, (req, res) => {
  // rajada por IP (memória); os limites diários por comprador, IP e loja ficam no banco (service)
  if (limited(`j:${req.ip}`, 30, 3600000)) {
    return res.status(429).json({ error: 'muitas provas em pouco tempo: tente mais tarde', code: 'rate' });
  }
  try {
    const job = tryon.createJob(req.store, {
      shopperId: req.shopper, photoId: req.body.photoId, productId: req.body.productId, imageId: req.body.imageId, ip: req.ip,
    });
    if (config.tryon.debug) {
      console.log(`[debug ${req.store.id}] servidor prova produto=${req.body.productId} imageId=${req.body.imageId ?? '-'} foto=${job.product_image || '(principal)'}${job.reused ? ' (reaproveitada)' : ''}`);
    }
    if (job.reused) return res.status(200).json({ job: tryon.publicJob(job), reused: true });
    const v = typeof req.body.visitId === 'string' && /^[a-z0-9]{6,40}$/i.test(req.body.visitId) ? req.body.visitId : undefined;
    svc.logEvent(req.store.id, { type: 'tryon_open', productId: job.product_id, meta: { v, job: job.id } });
    res.status(201).json({ job: tryon.publicJob(job) });
  } catch (e) { sendError(res, e); }
});

router.get('/:storeId/jobs/:jobId', (req, res) => {
  const job = tryon.getJob(req.store.id, req.params.jobId, shopperOf(req));
  if (!job) return res.status(404).json({ error: 'prova não encontrada' });
  const out = tryon.publicJob(job);
  // assinatura da prova: a página de obrigado liga o pedido a quem provou
  if (job.status === 'done') out.saleToken = createRecToken(req.store.id, job.product_id, '__tryon');
  res.set('Cache-Control', 'no-store').json({ job: out });
});

router.get('/:storeId/jobs/:jobId/image', (req, res) => {
  const job = tryon.getJob(req.store.id, req.params.jobId, shopperOf(req));
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'prova não encontrada' });
  sendImage(res, job.output_path, job.output_type);
});

router.post('/:storeId/jobs/:jobId/feedback', requireToken, (req, res) => {
  const job = tryon.getJob(req.store.id, req.params.jobId, req.shopper);
  if (!job) return res.status(404).json({ error: 'prova não encontrada' });
  res.json({ feedback: tryon.setFeedback(job, Number(req.body.value)) });
});

router.post('/:storeId/jobs/:jobId/share', requireToken, (req, res) => {
  const job = tryon.getJob(req.store.id, req.params.jobId, req.shopper);
  if (!job || job.status !== 'done') return res.status(404).json({ error: 'prova não encontrada' });
  const share = tryon.createShare(job);
  svc.logEvent(req.store.id, { type: 'tryon_share', productId: job.product_id, meta: { share: share.id } });
  res.json(share);
});

router.post('/:storeId/lead', requireToken, (req, res) => {
  if (limited(`l:${req.ip}`, 20, 3600000)) return res.status(429).json({ error: 'muitas tentativas' });
  try {
    tryon.saveLead(req.store, req.shopper, req.body.phone, req.body.productId);
    res.json({ ok: true });
  } catch (e) { sendError(res, e); }
});

router.get('/:storeId/history', (req, res) => {
  const shopper = shopperOf(req);
  if (!shopper) return res.json({ items: [] });
  res.set('Cache-Control', 'no-store').json({ items: tryon.history(req.store.id, shopper) });
});

// Eventos simples da vitrine/provador (sem dado pessoal).
// Diagnóstico (TRYON_DEBUG=true): o app da vitrine e o provador contam o que
// acontece na loja real; vai só para o log do servidor
router.post('/:storeId/debug', (req, res) => {
  if (!config.tryon.debug) return res.status(204).end();
  if (limited(`d:${req.ip}`, 300, 3600000)) return res.status(429).end();
  const b = req.body && typeof req.body === 'object' ? req.body : {};
  const from = b.from === 'tryon' ? 'provador' : 'loja';
  const what = String(b.event || '?').slice(0, 40);
  let data = '';
  try { data = JSON.stringify(b.data ?? null).slice(0, 1500); } catch { /* ignora */ }
  console.log(`[debug ${req.store.id}] ${from} ${what} ${data}`);
  res.status(204).end();
});

router.post('/:storeId/events', (req, res) => {
  const b = req.body || {};
  if (!verifyEventToken(b.token, req.store.id)) return res.status(401).json({ error: 'token inválido' });
  if (!['tryon_view', 'tryon_buy'].includes(b.type)) return res.status(400).json({ error: 'evento inválido' });
  const v = typeof b.visitId === 'string' && /^[a-z0-9]{6,40}$/i.test(b.visitId) ? b.visitId : undefined;
  svc.logEvent(req.store.id, { type: b.type, productId: Number(b.productId) || null, meta: v ? { v } : null });
  res.json({ ok: true });
});

// LGPD: "Apagar agora" no provador.
router.delete('/:storeId/data', (req, res) => {
  const shopper = shopperOf(req);
  if (!shopper) return res.status(400).json({ error: 'comprador inválido' });
  res.json({ deleted: tryon.deleteShopperData(req.store.id, shopper) });
});

module.exports = router;
module.exports.appUrl = config.appUrl;
