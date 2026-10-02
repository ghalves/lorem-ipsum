'use strict';
const express = require('express');
const config = require('../config');
const svc = require('../lib/store-service');
const sync = require('../lib/sync');
const { verifyWebhookHmac } = require('../lib/session');
const { getDb } = require('../db');

const router = express.Router();

// Corpo cru para validar a assinatura HMAC.
router.use(express.raw({ type: '*/*', limit: '1mb' }));

router.use((req, res, next) => {
  const header = req.get('x-linkedstore-hmac-sha256') || req.get('http_x_linkedstore_hmac_sha256');
  const raw = req.body instanceof Buffer ? req.body : Buffer.from('');
  if (!verifyWebhookHmac(raw, header) && !(config.devMode && req.get('x-dev-skip-hmac') === '1')) {
    return res.status(401).json({ error: 'assinatura inválida' });
  }
  try { req.payload = JSON.parse(raw.toString() || '{}'); } catch { return res.status(400).end(); }
  next();
});

// A Nuvemshop espera 2XX em até 3 s: respondemos logo e processamos depois.
function later(fn) {
  setImmediate(() => Promise.resolve().then(fn).catch((e) => console.error('[webhook]', e.message)));
}

router.post('/nuvemshop', (req, res) => {
  const { store_id: storeId, event, id } = req.payload;
  res.status(200).json({ ok: true });
  const store = storeId ? svc.getStore(storeId) : null;
  // loja desinstalada não tem mais token: ignora tudo até reinstalar
  if (!store || store.uninstalled_at) return;
  later(async () => {
    switch (event) {
      case 'product/created':
      case 'product/updated':
        await sync.syncProduct(storeId, id);
        break;
      case 'product/deleted':
        svc.markProductDeleted(storeId, id);
        break;
      case 'order/paid':
        if (config.tryon.debug) console.log(`[debug ${storeId}] servidor aviso order/paid pedido=${id}`);
        svc.logEvent(storeId, { type: 'order_paid', meta: { order_id: id } });
        await sync.importOrder(storeId, id);
        break;
      case 'app/uninstalled':
        svc.markUninstalled(storeId);
        break;
      default:
        break;
    }
  });
});

// ---- Webhooks obrigatórios de LGPD (URLs cadastradas no Portal de Parceiros) ----

router.post('/lgpd/store-redact', (req, res) => {
  const storeId = req.payload.store_id;
  if (storeId) svc.redactStore(storeId);
  res.status(200).json({ ok: true });
});

// Fotos e provas ficam sob um código aleatório do navegador, sem ligação com o
// cliente da loja, e expiram sozinhas (foto em 24 h, provas em 7 dias); o
// comprador apaga tudo pelo "Apagar agora" do provador. O único dado que liga a
// pessoa é o WhatsApp que ela informou: se a Nuvemshop mandar o telefone do
// cliente, ele sai da lista de leads (e aparece na resposta do pedido de dados).
function customerPhone(payload) {
  return require('../tryon/service').normalizePhone(payload?.customer?.phone || '');
}

router.post('/lgpd/customers-redact', (req, res) => {
  const phone = customerPhone(req.payload);
  const removed = phone && req.payload.store_id ? require('../tryon/service').deleteLead(req.payload.store_id, phone) : 0;
  console.log('[lgpd] customers/redact', req.payload.store_id, req.payload.customer?.id, removed ? 'WhatsApp apagado' : 'nada vinculado');
  res.status(200).json({ ok: true, removed });
});

router.post('/lgpd/customers-data-request', (req, res) => {
  const phone = customerPhone(req.payload);
  const lead = phone && req.payload.store_id ? require('../tryon/service').findLead(req.payload.store_id, phone) : null;
  console.log('[lgpd] customers/data_request', req.payload.store_id, req.payload.customer?.id);
  res.status(200).json({
    ok: true,
    data: lead ? { whatsapp: lead.phone, informado_em: lead.created_at } : null,
    note: 'Fotos e provas não têm vínculo com o cliente da loja e expiram sozinhas (24 h / 7 dias).',
  });
});

module.exports = router;
