'use strict';
const { getDb, parse } = require('../db');

const DEFAULT_SETTINGS = {
  enabled: true,
  language: 'pt',
  // Onde o botão entra na página de produto (vazio = detecção automática)
  selectors: {
    anchor: '',         // elemento depois do qual o botão aparece
    addToCart: '',      // botão de comprar do tema (usado pelo "Comprar" do provador)
  },
  tryon: {
    enabled: true,
    plan: null,          // null = usa TRYON_DEFAULT_PLAN
    leadCapture: true,   // pede o WhatsApp antes da 2ª prova
    freeBeforeLead: 1,   // quantas provas o comprador faz antes de pedir o WhatsApp
    dailyPerShopper: 10, // provas por comprador em 24 h (protege a cota do mês)
    button: 'Provar virtualmente',
    buttonAnimation: true, // varinha do botão balança como na espera da prova
    showBrand: true,       // marca Miaou no provador (só planos Escalar e Volume podem desligar)
  },
};

function localized(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value.pt || value.es || value.en || Object.values(value)[0] || '';
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [k, v] of Object.entries(extra || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? deepMerge(base[k], v)
      : v;
  }
  return out;
}

// ---------- lojas ----------

function getStore(id) {
  const row = getDb().prepare('SELECT * FROM stores WHERE id = ?').get(Number(id));
  if (!row) return null;
  return { ...row, settings: deepMerge(DEFAULT_SETTINGS, parse(row.settings, {})) };
}

function upsertStore({ id, accessToken, scope, name, domain }) {
  getDb().prepare(`
    INSERT INTO stores (id, access_token, scope, name, domain)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      access_token = excluded.access_token,
      scope = excluded.scope,
      name = COALESCE(excluded.name, stores.name),
      domain = COALESCE(excluded.domain, stores.domain),
      uninstalled_at = NULL
  `).run(Number(id), accessToken, scope || null, name || null, domain || null);
  return getStore(id);
}

function updateSettings(storeId, patch) {
  const current = getStore(storeId);
  const next = deepMerge(current.settings, patch);
  getDb().prepare('UPDATE stores SET settings = ? WHERE id = ?').run(JSON.stringify(next), Number(storeId));
  return next;
}

function setStoreField(storeId, field, value) {
  const allowed = ['script_association_id', 'last_sync_at', 'uninstalled_at', 'name', 'domain', 'access_token'];
  if (!allowed.includes(field)) throw new Error('campo inválido');
  getDb().prepare(`UPDATE stores SET ${field} = ? WHERE id = ?`).run(value, Number(storeId));
}

/**
 * Desinstalação: o token de acesso deixa de valer e é apagado na hora; o
 * painel fecha. Os demais dados ficam até o store/redact da Nuvemshop (ou até
 * o lojista reinstalar, o que recupera o histórico).
 */
function markUninstalled(storeId) {
  getDb().prepare("UPDATE stores SET uninstalled_at = ?, access_token = '', script_association_id = NULL WHERE id = ?")
    .run(new Date().toISOString(), Number(storeId));
}

/** LGPD store/redact: apaga todos os dados da loja. */
function redactStore(storeId) {
  const db = getDb();
  const id = Number(storeId);
  try { require('../tryon/service').deleteStoreFiles(id); } catch { /* sem arquivos */ }
  for (const t of ['events', 'products', 'order_claims',
    'tryon_photos', 'tryon_jobs', 'tryon_products', 'tryon_image_info', 'tryon_leads', 'tryon_lead_links', 'tryon_shares', 'tryon_sales']) {
    db.prepare(`DELETE FROM ${t} WHERE store_id = ?`).run(id);
  }
  db.prepare('DELETE FROM stores WHERE id = ?').run(id);
}

// ---------- produtos ----------

/** Converte o produto da API Nuvemshop no formato interno. */
function normalizeProduct(p) {
  const v0 = (p.variants || [])[0] || {};
  const price = v0.promotional_price && Number(v0.promotional_price) > 0 ? v0.promotional_price : v0.price;
  return {
    id: Number(p.id),
    name: localized(p.name),
    handle: localized(p.handle),
    image: p.images?.[0]?.src || null,
    images: (p.images || []).filter((i) => i && typeof i.src === 'string')
      .map((i) => ({ id: Number(i.id) || null, src: i.src })).slice(0, 50),
    variantImages: Object.fromEntries((p.variants || [])
      .filter((v) => v && v.id && v.image_id).map((v) => [String(v.id), Number(v.image_id)])),
    categories: (p.categories || []).map((c) => ({ id: Number(c.id), name: localized(c.name) })),
    url: typeof p.canonical_url === 'string' ? p.canonical_url : null,
    price: price != null && price !== '' ? String(price) : null,
  };
}

function upsertProduct(storeId, product) {
  const p = normalizeProduct(product);
  getDb().prepare(`
    INSERT INTO products (store_id, id, name, handle, image, images, variant_images, categories, url, price, deleted, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
    ON CONFLICT(store_id, id) DO UPDATE SET
      name = excluded.name, handle = excluded.handle, image = excluded.image, images = excluded.images,
      variant_images = excluded.variant_images,
      categories = excluded.categories, url = excluded.url, price = excluded.price,
      deleted = 0, updated_at = datetime('now')
  `).run(Number(storeId), p.id, p.name, p.handle, p.image, JSON.stringify(p.images), JSON.stringify(p.variantImages),
    JSON.stringify(p.categories), p.url, p.price);
  return p;
}

function markProductDeleted(storeId, productId) {
  getDb().prepare('UPDATE products SET deleted = 1 WHERE store_id = ? AND id = ?').run(Number(storeId), Number(productId));
}

function rowToProduct(row) {
  if (!row) return null;
  return {
    ...row, categories: parse(row.categories, []), images: parse(row.images, []),
    variantImages: parse(row.variant_images, {}),
    // produto importado antes de guardarmos as fotos: precisa ser atualizado
    needsImages: row.images == null || row.variant_images == null,
  };
}

/**
 * Foto do produto para a prova: a da variação escolhida (variantId ou image_id), desde que
 * seja mesmo uma foto deste produto; senão, a principal. Nunca aceita URL de
 * fora, então ninguém usa o provador com imagens que não são da loja.
 */
function productImage(product, imageId, variantId) {
  // a variação (cor) escolhida aponta para uma das fotos (image_id, vindo da API)
  const id = Number(imageId) || Number(product?.variantImages?.[String(variantId)]) || 0;
  if (product && id) {
    const hit = (product.images || []).find((i) => i.id === id);
    if (hit) return hit.src;
  }
  return product?.image || null;
}

function getProduct(storeId, productId) {
  return rowToProduct(getDb().prepare('SELECT * FROM products WHERE store_id = ? AND id = ? AND deleted = 0')
    .get(Number(storeId), Number(productId)));
}

function listProducts(storeId, { search = '', limit = 50, offset = 0 } = {}) {
  const lim = Math.max(1, Math.min(500, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  // busca pelo nome (qualquer parte) ou pelo número exato do produto
  const term = String(search || '').trim();
  const where = 'store_id = ? AND deleted = 0 AND (name LIKE ? OR CAST(id AS TEXT) = ?)';
  const args = [Number(storeId), `%${term}%`, term];
  const items = getDb().prepare(`SELECT * FROM products WHERE ${where} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`)
    .all(...args, lim, off).map(rowToProduct);
  const total = getDb().prepare(`SELECT COUNT(*) AS n FROM products WHERE ${where}`).get(...args).n;
  return { total, items };
}

/** Provador por produto: automático (null), roupa, óculos ou desligado. */
function updateProductTryonKind(storeId, productId, kind) {
  const valid = [null, '', 'garment', 'glasses', 'off'];
  if (!valid.includes(kind ?? null)) throw Object.assign(new Error('Tipo de prova inválido'), { status: 400 });
  getDb().prepare('UPDATE products SET tryon_kind = ? WHERE store_id = ? AND id = ?')
    .run(kind || null, Number(storeId), Number(productId));
  return getProduct(storeId, productId);
}

// ---------- pedidos ----------

/** Guarda o que a página de "obrigado" informou: produtos provados neste pedido. */
function saveOrderClaims(storeId, orderId, list) {
  const st = getDb().prepare(`
    INSERT INTO order_claims (store_id, order_id, product_id, size_recommended) VALUES (?, ?, ?, ?)
    ON CONFLICT(store_id, order_id, product_id) DO NOTHING
  `);
  // devolve quantos produtos são NOVOS neste pedido (repetir o aviso não conta)
  let n = 0;
  for (const r of list) n += st.run(Number(storeId), Number(orderId), Number(r.productId), r.size || '__tryon').changes;
  return n;
}
/** Aviso da página de obrigado para este produto neste pedido: { size, createdAt } ou null. */
function claimFor(storeId, orderId, productId) {
  const row = getDb().prepare('SELECT size_recommended, created_at FROM order_claims WHERE store_id = ? AND order_id = ? AND product_id = ?')
    .get(Number(storeId), Number(orderId), Number(productId));
  return row ? { size: row.size_recommended || '', createdAt: row.created_at } : null;
}
/** O pedido já foi pago (webhook chegou antes da página de obrigado)? */
function orderWasPaid(storeId, orderId) {
  return Boolean(getDb().prepare(`
    SELECT 1 FROM events WHERE store_id = ? AND type = 'order_paid'
      AND CAST(json_extract(meta, '$.order_id') AS INTEGER) = ? LIMIT 1
  `).get(Number(storeId), Number(orderId)));
}

// ---------- eventos ----------

const EVENT_TYPES = new Set(['order_paid', 'tryon_view', 'tryon_open', 'tryon_buy', 'tryon_share', 'share_view', 'share_click']);

function logEvent(storeId, e) {
  if (!EVENT_TYPES.has(e.type)) return false;
  getDb().prepare('INSERT INTO events (store_id, product_id, type, meta) VALUES (?, ?, ?, ?)')
    .run(Number(storeId), e.productId ? Number(e.productId) : null, e.type, e.meta ? JSON.stringify(e.meta).slice(0, 2000) : null);
  return true;
}

/** Limpeza diária: eventos com mais de 2 anos e avisos de pedido que nunca foram pagos. */
function purgeOldData() {
  const db = getDb();
  const events = db.prepare("DELETE FROM events WHERE created_at < datetime('now', '-730 days')").run().changes;
  db.prepare("DELETE FROM order_claims WHERE created_at < datetime('now', '-30 days')").run();
  return { events };
}

module.exports = {
  DEFAULT_SETTINGS, localized, normalizeProduct,
  getStore, upsertStore, updateSettings, setStoreField, markUninstalled, redactStore,
  upsertProduct, markProductDeleted, getProduct, listProducts, updateProductTryonKind,
  saveOrderClaims, claimFor, orderWasPaid, logEvent, purgeOldData, productImage,
};
