'use strict';
const crypto = require('node:crypto');
const config = require('../config');

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

/** Token assinado para o painel do lojista (válido por 12 h). */
function createSession(storeId, ttlSeconds = 12 * 3600) {
  const payload = b64(JSON.stringify({ sid: Number(storeId), exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign(payload)}`;
}

function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Token curto que a vitrine recebe junto da configuração e devolve ao registrar
 * eventos. Não é segredo do cliente: só evita que qualquer um poste estatística
 * falsa no painel do lojista sem nem passar pela página do produto.
 */
function createEventToken(storeId, ttlSeconds = 24 * 3600) {
  const payload = b64(JSON.stringify({ ev: Number(storeId), exp: Math.floor(Date.now() / 1000) + ttlSeconds }));
  return `${payload}.${sign(payload)}`;
}

function verifyEventToken(token, storeId) {
  const data = verifySession(token);
  return Boolean(data && data.ev === Number(storeId));
}

/**
 * Recomendação assinada: o provador recebe uma para cada resultado e a página
 * de obrigado devolve junto com o pedido. Sem ela, qualquer um poderia dizer
 * que "o provador recomendou G" num pedido que não passou pelo provador.
 */
function createRecToken(storeId, productId, size, ttlSeconds = 7 * 24 * 3600) {
  const payload = b64(JSON.stringify({
    rs: Number(storeId), rp: Number(productId), sz: String(size), exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  }));
  return `${payload}.${sign(payload)}`;
}

function verifyRecToken(token, storeId, productId, size) {
  const data = verifySession(token);
  return Boolean(data && data.rs === Number(storeId) && data.rp === Number(productId)
    && typeof data.sz === 'string' && data.sz.trim().toUpperCase() === String(size).trim().toUpperCase());
}

/** Valida o header x-linkedstore-hmac-sha256 enviado pela Nuvemshop. */
function verifyWebhookHmac(rawBody, header) {
  if (!header || !config.nuvemshop.clientSecret) return false;
  const digest = crypto.createHmac('sha256', config.nuvemshop.clientSecret).update(rawBody).digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(String(header).trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  createSession, verifySession, createEventToken, verifyEventToken, createRecToken, verifyRecToken, verifyWebhookHmac,
};
