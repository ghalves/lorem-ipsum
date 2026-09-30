'use strict';
const config = require('../config');
const ns = require('./nuvemshop');
const svc = require('./store-service');

const WEBHOOK_EVENTS = [
  'product/created', 'product/updated', 'product/deleted',
  'order/paid', 'app/uninstalled',
];

/**
 * Atualiza os endereços da loja (original + domínios próprios). O provador só
 * conversa com páginas nesses endereços; um domínio novo passa a valer aqui.
 */
async function refreshDomains(storeId, api) {
  try {
    const info = await api.getStore();
    const all = [info.original_domain].concat(info.domains || [])
      .map((d) => String(d || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim().toLowerCase())
      .filter(Boolean);
    if (all.length) svc.setStoreField(storeId, 'domain', [...new Set(all)].join(','));
    else console.warn(`[domínios] loja ${storeId} sem domínio informado pela Nuvemshop`);
  } catch (e) { console.warn(`[domínios] loja ${storeId}: ${e.message}`); }
}

/**
 * Atualiza os domínios de uma loja no máximo a cada 10 minutos. Chamado quando
 * o lojista abre o painel e quando o provador é aberto num endereço que ainda
 * não conhecemos (domínio próprio recém-configurado).
 */
const lastDomainRefresh = new Map();
async function refreshDomainsThrottled(storeId, minIntervalMs = 10 * 60 * 1000) {
  const store = svc.getStore(storeId);
  if (!store || store.uninstalled_at || !store.access_token || store.access_token === 'dev-token') return false;
  const last = lastDomainRefresh.get(store.id) || 0;
  if (Date.now() - last < minIntervalMs) return false;
  lastDomainRefresh.set(store.id, Date.now());
  if (lastDomainRefresh.size > 10000) lastDomainRefresh.clear();
  await refreshDomains(store.id, ns.client(store.id, store.access_token));
  return true;
}
function resetDomainRefresh(storeId) { lastDomainRefresh.delete(Number(storeId)); }

/** Importa todo o catálogo da loja (paginado). */
async function syncAllProducts(storeId) {
  const store = svc.getStore(storeId);
  if (!store) throw new Error('Loja não encontrada');
  if (config.devMode && store.access_token === 'dev-token') {
    require('../routes/dev').seed();
    return svc.listProducts(store.id, { limit: 1 }).total;
  }
  const api = ns.client(store.id, store.access_token);
  await refreshDomains(store.id, api);
  let page = 1;
  let count = 0;
  for (;;) {
    const products = await api.listProducts(page, 200);
    if (!Array.isArray(products) || !products.length) break;
    for (const p of products) { svc.upsertProduct(store.id, p); count++; }
    if (products.length < 200) break;
    page++;
  }
  svc.setStoreField(store.id, 'last_sync_at', new Date().toISOString());
  return count;
}

async function syncProduct(storeId, productId) {
  const store = svc.getStore(storeId);
  if (!store) return null;
  const api = ns.client(store.id, store.access_token);
  try {
    return svc.upsertProduct(store.id, await api.getProduct(productId));
  } catch (err) {
    if (err.status === 404) { svc.markProductDeleted(store.id, productId); return null; }
    throw err;
  }
}

/**
 * Pedido pago: cada produto do pedido que o comprador provou antes (aviso da
 * página de obrigado, dentro da janela de tempo) conta como venda com o provador.
 * Vale qualquer tamanho e também óculos. Devolve quantas vendas registrou.
 */
async function importOrder(storeId, orderId) {
  const store = svc.getStore(storeId);
  if (!store || store.access_token === 'dev-token') return 0;
  const order = await ns.client(store.id, store.access_token).getOrder(orderId);
  let saved = 0;
  for (const item of order?.products || []) {
    const productId = Number(item.product_id);
    const c = svc.claimFor(store.id, orderId, productId);
    if (c && c.size === '__tryon' && claimMatchesOrder(c, order)) saved += require('../tryon/service').recordSale(store.id, orderId, productId);
  }
  return saved;
}

/**
 * A página de obrigado abre logo depois do checkout: o aviso só vale se chegou
 * entre alguns minutos antes da criação do pedido e 48 h depois. Isso impede
 * que alguém "reivindique" pedidos antigos (ou futuros) chutando números.
 * Se a Nuvemshop não informar a data do pedido, o aviso é aceito.
 */
const CLAIM_WINDOW = { beforeMs: 10 * 60 * 1000, afterMs: 48 * 3600 * 1000 };
function claimMatchesOrder(claim, order) {
  const created = Date.parse(order?.created_at || '');
  if (!Number.isFinite(created)) return true;
  const at = Date.parse(String(claim.createdAt || '').replace(' ', 'T') + 'Z');   // SQLite: UTC sem fuso
  if (!Number.isFinite(at)) return false;
  return at >= created - CLAIM_WINDOW.beforeMs && at <= created + CLAIM_WINDOW.afterMs;
}

/** Cadastra os webhooks que ainda não existem na loja. */
async function ensureWebhooks(storeId) {
  const store = svc.getStore(storeId);
  const api = ns.client(store.id, store.access_token);
  const url = `${config.appUrl}/webhooks/nuvemshop`;
  const existing = await api.listWebhooks().catch(() => []);
  const have = new Set((existing || []).filter((w) => w.url === url).map((w) => w.event));
  const created = [];
  for (const event of WEBHOOK_EVENTS) {
    if (have.has(event)) continue;
    await api.createWebhook(event, url);
    created.push(event);
  }
  return created;
}

/** Associa o script da vitrine (cadastrado no Portal de Parceiros) à loja. */
async function ensureScript(storeId) {
  const store = svc.getStore(storeId);
  if (!config.nuvemshop.scriptId) return { skipped: 'NUVEMSHOP_SCRIPT_ID não configurado' };
  const api = ns.client(store.id, store.access_token);
  const res = await api.associateScript(config.nuvemshop.scriptId, { store: String(store.id) });
  svc.setStoreField(store.id, 'script_association_id', res?.id || config.nuvemshop.scriptId);
  if (config.nuvemshop.thankYouScriptId) {
    try { await api.associateScript(config.nuvemshop.thankYouScriptId, { store: String(store.id) }); }
    catch (e) { console.warn(`[script] página de obrigado, loja ${store.id}: ${e.message}`); }
  }
  return res;
}

/** Tudo o que roda depois da instalação (em segundo plano). */
async function onInstall(storeId) {
  const steps = { webhooks: null, script: null, products: null };
  try { steps.webhooks = await ensureWebhooks(storeId); } catch (e) { steps.webhooks = `erro: ${e.message}`; }
  try { steps.script = await ensureScript(storeId); } catch (e) { steps.script = `erro: ${e.message}`; }
  try { steps.products = await syncAllProducts(storeId); } catch (e) { steps.products = `erro: ${e.message}`; }
  console.log(`[install] loja ${storeId}`, JSON.stringify(steps));
  return steps;
}

module.exports = { refreshDomainsThrottled, resetDomainRefresh, syncAllProducts, syncProduct, importOrder, claimMatchesOrder, ensureWebhooks, ensureScript, onInstall, WEBHOOK_EVENTS };
