'use strict';
const config = require('../config');

class NuvemshopError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const userAgent = () => `${config.appName} (${config.nuvemshop.contactEmail})`;

/** Troca o code do OAuth pelo access_token. */
async function exchangeCode(code) {
  const res = await fetch(`${config.nuvemshop.authBase}/apps/authorize/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent() },
    body: JSON.stringify({
      client_id: config.nuvemshop.appId,
      client_secret: config.nuvemshop.clientSecret,
      grant_type: 'authorization_code',
      code,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new NuvemshopError(body.error_description || 'Falha ao trocar o code', res.status, body);
  }
  return body; // { access_token, token_type, scope, user_id }
}

function authorizeUrl(state) {
  const u = new URL(`${config.nuvemshop.authBase}/apps/${config.nuvemshop.appId}/authorize`);
  if (state) u.searchParams.set('state', state);
  return u.toString();
}

/** Cliente da API REST para uma loja. */
function client(storeId, accessToken) {
  const base = `${config.nuvemshop.apiBase}/${config.nuvemshop.apiVersion}/${storeId}`;

  async function request(method, path, body, attempt = 0) {
    const res = await fetch(base + path, {
      method,
      headers: {
        // A Nuvemshop historicamente usa "Authentication"; as versões novas
        // aceitam "Authorization". Enviamos os dois.
        Authentication: `bearer ${accessToken}`,
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': userAgent(),
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 && attempt < 4) {
      const wait = Number(res.headers.get('x-rate-limit-reset')) || 1000 * (attempt + 1);
      await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
      return request(method, path, body, attempt + 1);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch {
      // resposta que não é JSON (página de erro do proxy, manutenção...)
      throw new NuvemshopError(`${method} ${path} -> ${res.status} (resposta não é JSON)`, res.status, text.slice(0, 500));
    }
    if (res.status === 404 && method === 'GET' && /page=/.test(path)) return [];
    if (!res.ok) throw new NuvemshopError(`${method} ${path} -> ${res.status}`, res.status, data);
    return data;
  }

  return {
    request,
    getStore: () => request('GET', '/store'),
    getProduct: (id) => request('GET', `/products/${id}`),
    getOrder: (id) => request('GET', `/orders/${id}`),
    listProducts: (page = 1, perPage = 200) => request('GET', `/products?page=${page}&per_page=${perPage}`),
    listWebhooks: () => request('GET', '/webhooks'),
    createWebhook: (event, url) => request('POST', '/webhooks', { event, url }),
    associateScript: (scriptId, params) =>
      request('POST', '/scripts', { script_id: scriptId, query_params: JSON.stringify(params || {}) }),
    listScripts: () => request('GET', '/scripts'),
  };
}

module.exports = { exchangeCode, authorizeUrl, client, NuvemshopError };
