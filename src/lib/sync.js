'use strict';
const config = require('../config');
const ns = require('./nuvemshop');
const svc = require('./store-service');
const { verifyRecToken } = require('./session');

const WEBHOOK_EVENTS = [
  'product/created', 'product/updated', 'product/deleted',
  'order/paid', 'app/uninstalled',
];

/**
 * Produto importado por uma versão antiga (sem fotos nem mapa variação → foto):
 * atualiza em segundo plano na primeira visita, no máximo a cada 10 minutos.
 */
const lastProductRefresh = new Map();
function refreshProductIfStale(storeId, product) {
  if (!product?.needsImages) return;
  const key = `${storeId}:${product.id}`;
  if (Date.now() - (lastProductRefresh.get(key) || 0) < 10 * 60 * 1000) return;
  lastProductRefresh.set(key, Date.now());
  if (lastProductRefresh.size > 20000) lastProductRefresh.clear();
  const store = svc.getStore(storeId);
  if (!store || store.uninstalled_at || store.access_token === 'dev-token') return;
  syncProduct(storeId, product.id).catch((e) => console.warn(`[produto] ${product.id}: ${e.message}`));
}

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
  // app NubeSDK: os provados vêm gravados no próprio pedido (feito no checkout)
  const fromExtra = claimsFromOrderExtra(store.id, orderId, order);
  let saved = 0;
  for (const item of order?.products || []) {
    const productId = Number(item.product_id);
    const c = svc.claimFor(store.id, orderId, productId);
    if (c && c.size === '__tryon' && (fromExtra.has(productId) || claimMatchesOrder(c, order))) {
      saved += require('../tryon/service').recordSale(store.id, orderId, productId);
    }
  }
  return saved;
}

/**
 * Produtos provados com token válido deste servidor (a assinatura impede que
 * alguém invente provas). Usado pela página de obrigado e pelo pedido.
 */
function verifiedTried(storeId, list) {
  return (Array.isArray(list) ? list : []).slice(0, 20)
    .filter((r) => r && typeof r === 'object')
    .map((r) => ({ productId: Number(r.productId), size: '__tryon', token: typeof r.token === 'string' ? r.token.slice(0, 500) : '' }))
    .filter((r) => Number.isSafeInteger(r.productId) && r.productId > 0)
    .filter((r) => verifyRecToken(r.token, storeId, r.productId, '__tryon'))
    .filter((r) => svc.getProduct(storeId, r.productId));
}

/**
 * Lê o campo "miaou" que o app NubeSDK grava no pedido durante o checkout
 * ({ v: 1, p: [[productId, token], ...] }) e registra os produtos provados.
 * Devolve os ids registrados: eles pertencem a este pedido, então dispensam a
 * janela de tempo da página de obrigado (boleto pode pagar dias depois).
 */
function claimsFromOrderExtra(storeId, orderId, order) {
  let extra = order?.extra;
  if (typeof extra === 'string') { try { extra = JSON.parse(extra); } catch { extra = null; } }
  let raw = extra && typeof extra === 'object' ? extra.miaou : null;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { raw = null; } }
  const pairs = raw && Array.isArray(raw.p) ? raw.p : [];
  const tried = verifiedTried(storeId, pairs.filter(Array.isArray).map(([productId, token]) => ({ productId, token })));
  if (tried.length) svc.saveOrderClaims(storeId, orderId, tried);
  return new Set(tried.map((r) => r.productId));
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

module.exports = { refreshProductIfStale, refreshDomainsThrottled, resetDomainRefresh, syncAllProducts, syncProduct, importOrder, claimMatchesOrder, verifiedTried, claimsFromOrderExtra, ensureWebhooks, ensureScript, onInstall, WEBHOOK_EVENTS };
