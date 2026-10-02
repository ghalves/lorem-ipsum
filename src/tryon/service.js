'use strict';
/**
 * Provador virtual: fotos, provas (jobs), leads, compartilhamento e cota.
 *
 * Geração: o modelo principal (Muse, barato) começa na hora. Se ele falhar, ou
 * não responder em TRYON_HEDGE_AFTER_MS (30 s), a reserva (Nano Banana 2) é disparada
 * em paralelo e vale a primeira imagem que chegar. Vale para roupas e óculos.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { getDb, parse } = require('../db');
const svc = require('../lib/store-service');
const provider = require('./provider');
const prompts = require('./prompt');
const image = require('./image');
const { getPlan, ALERT_AT } = require('./plans');

const cfg = config.tryon;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const newId = () => crypto.randomUUID();
const shareId = () => crypto.randomBytes(9).toString('base64url');
const SHOPPER_RE = /^[a-z0-9-]{16,64}$/i;
const validShopper = (s) => (typeof s === 'string' && SHOPPER_RE.test(s) ? s : null);
const UUID_RE = /^[0-9a-f-]{36}$/i;
const validUuid = (s) => (typeof s === 'string' && UUID_RE.test(s) ? s : null);

function err(message, status, code) { return Object.assign(new Error(message), { status, code }); }

// ---------- arquivos ----------

function storeDir(storeId) {
  const dir = path.join(cfg.storageDir, String(Number(storeId)));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function removeFile(p) { if (p) fs.rm(p, { force: true }, () => {}); }
function deleteStoreFiles(storeId) {
  fs.rmSync(path.join(cfg.storageDir, String(Number(storeId))), { recursive: true, force: true });
}

function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

// ---------- datas ----------

const sqlTime = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
/** 00:00 do dia 1 do mês corrente em Brasília (UTC-3), em UTC no formato do SQLite. */
function monthStart(now = Date.now()) {
  const local = new Date(now - 3 * 3600000);
  const start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + 3 * 3600000;
  return sqlTime(new Date(start));
}
const hoursAgo = (h) => sqlTime(new Date(Date.now() - h * 3600000));
/** IP guardado só como hash com o segredo do servidor (serve para contar, não para identificar). */
function ipKey(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', config.sessionSecret).update(String(ip)).digest('base64url').slice(0, 22);
}

// ---------- fotos ----------

function savePhoto(storeId, shopperId, buffer) {
  const shopper = validShopper(shopperId);
  if (!shopper) throw err('comprador inválido', 400);
  if (!buffer?.length || buffer.length > MAX_PHOTO_BYTES) throw err('foto muito grande (máx. 8 MB)', 413);
  const kind = sniffImage(buffer);
  if (!kind) throw err('formato de foto não aceito (use JPG, PNG ou WebP)', 415);
  const id = newId();
  const file = path.join(storeDir(storeId), `${id}-in.${kind.ext}`);
  fs.writeFileSync(file, buffer);
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  getDb().prepare('INSERT INTO tryon_photos (id, store_id, shopper_id, path, hash) VALUES (?, ?, ?, ?, ?)')
    .run(id, Number(storeId), shopper, file, hash);
  // já começa a achar rosto e corpo: a prova é pedida logo em seguida
  analyzePhoto({ id, path: file }).catch(() => {});
  return { photoId: id };
}

const analyzing = new Map();
/**
 * Caixas do rosto, dos olhos e do corpo na foto do comprador (uma vez por foto,
 * de 1 a 3 s no modelo barato). null se não achou ou se deu erro: a prova segue
 * sem recorte/colagem.
 */
function analyzePhoto(photo) {
  if (cfg.mock || !cfg.composite) return Promise.resolve(null);
  const row = getDb().prepare('SELECT analysis FROM tryon_photos WHERE id = ?').get(photo.id);
  if (row?.analysis) {
    const a = parse(row.analysis, null);
    return Promise.resolve(a && !a.none ? a : null);
  }
  if (!analyzing.has(photo.id)) {
    const t0 = Date.now();
    analyzing.set(photo.id, (async () => {
      let result = null;
      try {
        const text = await provider.describe(fileDataUrl(photo.path), prompts.PERSON_PROMPT, AbortSignal.timeout(15000));
        result = prompts.parseAnalysis(text);
        if (result) result.ms = Date.now() - t0;
      } catch (e) { console.warn(`[provador] análise da foto: ${e.message}`); }
      getDb().prepare('UPDATE tryon_photos SET analysis = ? WHERE id = ?').run(JSON.stringify(result || { none: true }), photo.id);
      return result;
    })().finally(() => setTimeout(() => analyzing.delete(photo.id), 1000)));
  }
  return analyzing.get(photo.id);
}

/** Espera a análise no máximo ms; depois segue sem ela. */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(undefined), ms))]);
}

function getPhoto(storeId, photoId, shopperId) {
  const id = validUuid(photoId);
  if (!id) return null;
  const row = getDb().prepare(`SELECT * FROM tryon_photos WHERE id = ? AND store_id = ? AND created_at >= ?`)
    .get(id, Number(storeId), hoursAgo(cfg.photoTtlHours));
  if (!row || (shopperId && row.shopper_id !== shopperId) || !fs.existsSync(row.path)) return null;
  return row;
}

function fileDataUrl(file) {
  const buf = fs.readFileSync(file);
  const kind = sniffImage(buf) || { type: 'image/jpeg' };
  return `data:${kind.type};base64,${buf.toString('base64')}`;
}

// ---------- produto: imagem e descrição ----------

const imageCache = new Map();   // url -> { dataUrl, at }
async function productImageDataUrl(url) {
  if (!url) throw err('produto sem foto', 409, 'no_image');
  const hit = imageCache.get(url);
  if (hit && Date.now() - hit.at < 3600000) return hit.dataUrl;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw err(`foto do produto indisponível (${res.status})`, 502);
  const buf = Buffer.from(await res.arrayBuffer());
  const kind = sniffImage(buf);
  const type = kind?.type || res.headers.get('content-type') || 'image/jpeg';
  const dataUrl = `data:${type};base64,${buf.toString('base64')}`;
  imageCache.set(url, { dataUrl, at: Date.now() });
  if (imageCache.size > 300) imageCache.delete(imageCache.keys().next().value);
  return dataUrl;
}

const describing = new Map();
/**
 * Tipo e descrição da peça, calculados uma vez por foto de produto: cada cor
 * (foto da variação) é uma peça diferente para a IA.
 */
async function productInfo(storeId, product, image = product.image) {
  const db = getDb();
  const row = image ? db.prepare('SELECT * FROM tryon_image_info WHERE store_id = ? AND image = ?').get(Number(storeId), image) : null;
  if (row && row.type) return { type: row.type, description: row.description || '' };
  const guess = { type: prompts.guessType(product.name), description: '' };
  if (cfg.mock || !image) return guess;
  const key = `${storeId}:${image}`;
  if (!describing.has(key)) {
    describing.set(key, (async () => {
      let info = guess;
      try {
        const text = await provider.describe(image, prompts.DESCRIBE_PROMPT, AbortSignal.timeout(20000));
        const parsed = prompts.parseDescription(text);
        // o nome do produto manda quando diz "óculos" e a descrição discorda
        if (parsed) info = { type: guess.type === 'glasses' ? 'glasses' : parsed.type, description: parsed.description };
      } catch (e) { console.warn(`[provador] descrição do produto ${product.id}: ${e.message}`); }
      db.prepare(`INSERT INTO tryon_image_info (store_id, image, type, description) VALUES (?, ?, ?, ?)
        ON CONFLICT(store_id, image) DO UPDATE SET type = excluded.type,
        description = excluded.description, updated_at = datetime('now')`)
        .run(Number(storeId), image, info.type, info.description);
      return info;
    })().finally(() => describing.delete(key)));
  }
  return describing.get(key);
}

/** Tipo de prova do produto: roupa, óculos ou desligado. */
function productKind(product) {
  if (!product) return 'off';
  if (product.tryon_kind === 'off' || !product.image) return 'off';
  if (product.tryon_kind === 'glasses' || product.tryon_kind === 'garment') return product.tryon_kind;
  return prompts.guessType(product.name) === 'glasses' ? 'glasses' : 'garment';
}

/**
 * Abrir o provador já adianta o que dá: descrição da peça e foto do produto
 * ficam prontas antes do comprador escolher a foto dele.
 */
function prepare(storeId, product, image = product?.image) {
  if (!product || cfg.mock || !image) return;
  productInfo(storeId, product, image).catch(() => {});
  productImageDataUrl(image).catch(() => {});
}

// ---------- cota ----------

function tryonSettings(store) { return store.settings.tryon || {}; }

/** Marca Miaou no provador e no link compartilhado (com link para o site). */
function brandFor(store) {
  const t = tryonSettings(store);
  if (!require('./plans').showBrand(t.plan || cfg.defaultPlan, t)) return null;
  return { url: `${config.siteUrl}/?utm_source=provador&utm_medium=marca&utm_campaign=loja-${Number(store.id)}` };
}

function quota(store) {
  const t = tryonSettings(store);
  const plan = getPlan(t.plan || cfg.defaultPlan);
  const since = monthStart();
  const q = getDb().prepare(`SELECT
      SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS used,
      SUM(CASE WHEN status IN ('queued', 'running') THEN 1 ELSE 0 END) AS pending
    FROM tryon_jobs WHERE store_id = ? AND created_at >= ?`).get(store.id, since);
  const used = q.used || 0;
  const pending = q.pending || 0;
  const remaining = Math.max(0, plan.quota - used);
  return {
    plan: { key: plan.key, name: plan.name, price: plan.price, quota: plan.quota },
    used, pending, remaining,
    // em andamento também reservam: evita passar da cota com várias provas ao mesmo tempo
    // cota do mês no fim: o botão some da loja até o dia 1º (sem provas extras)
    available: used + pending < plan.quota,
    alert: plan.quota > 0 && used >= plan.quota * ALERT_AT,
    exhausted: plan.quota > 0 ? used >= plan.quota : true,
    since,
  };
}

/** Provador pode aparecer na vitrine desta loja/produto? */
function availability(store, product) {
  const t = tryonSettings(store);
  if (!store.settings.enabled || !t.enabled) return { enabled: false, reason: 'disabled' };
  const kind = productKind(product);
  if (kind === 'off') return { enabled: false, reason: 'product' };
  if (!quota(store).available) return { enabled: false, reason: 'quota' };
  return { enabled: true, kind };
}

// ---------- leads ----------

/** Formato +55DDNNNNNNNNN sem validar se é celular (usado no LGPD para achar o número). */
function normalizePhone(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^0/.test(d) || /^(\d)\1+$/.test(d)) return null;   // DDD válido e não "11111111111"
  if (d.length === 11 && d[2] !== '9') return null;        // celular com 9 dígitos
  return `+55${d}`;
}

// DDDs que existem no Brasil (Anatel).
const DDD = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);
/** Quantos aparelhos (navegadores) um mesmo WhatsApp libera em 30 dias. */
const PHONE_MAX_SHOPPERS = 3;

/** O número tem cara de inventado? (repetido, sequência, blocos iguais) */
function looksFake(n9) {
  const sub8 = n9.slice(1);                                        // 8 dígitos depois do 9
  if (new Set(sub8).size <= 2) return true;                        // 99999999, 12121212, 99998888
  if (new Set(sub8.slice(1)).size <= 2 || new Set(sub8.slice(0, 7)).size <= 2) return true;   // 61212121, 12121219
  if (/(\d)\1{4,}/.test(n9)) return true;                          // 5 ou mais iguais seguidos: 99999-1234
  if (sub8.slice(0, 4) === sub8.slice(4)) return true;             // 1234-1234
  const up = '01234567890123';
  const down = '98765432109876';
  for (let i = 0; i + 6 <= sub8.length; i++) {                     // 6 ou mais em sequência: 91234-5678, 98765-4321
    const part = sub8.slice(i, i + 6);
    if (up.includes(part) || down.includes(part)) return true;
  }
  return false;
}

/**
 * WhatsApp do comprador: celular brasileiro de verdade no formato e sem cara
 * de inventado. Sem código por SMS, então valida o máximo possível aqui.
 * Devolve { phone } ou { error, code }.
 */
function validateWhatsapp(input) {
  let d = String(input || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 12 && d.startsWith('0')) d = d.slice(1);         // 0 + DDD + número
  if (d.length === 10) return { error: 'Use um celular com WhatsApp (DDD + 9 dígitos)', code: 'phone_landline' };
  if (d.length !== 11) return { error: 'Digite o celular com DDD: 2 dígitos do DDD e 9 do número', code: 'phone' };
  if (!DDD.has(Number(d.slice(0, 2)))) return { error: 'Esse DDD não existe. Confira o número', code: 'phone_ddd' };
  if (d[2] !== '9') return { error: 'Use um celular com WhatsApp (o número começa com 9)', code: 'phone_landline' };
  if (looksFake(d.slice(2))) return { error: 'Esse número parece inventado. Digite o seu WhatsApp', code: 'phone_fake' };
  return { phone: `+55${d}` };
}

function hasLead(storeId, shopperId) {
  return Boolean(getDb().prepare('SELECT 1 FROM tryon_lead_links WHERE store_id = ? AND shopper_id = ? LIMIT 1')
    .get(Number(storeId), shopperId));
}

function doneCount(storeId, shopperId) {
  return getDb().prepare("SELECT COUNT(*) AS n FROM tryon_jobs WHERE store_id = ? AND shopper_id = ? AND status IN ('done', 'queued', 'running')")
    .get(Number(storeId), shopperId).n;
}

function needsLead(store, shopperId) {
  const t = tryonSettings(store);
  if (!t.leadCapture) return false;
  const free = Math.max(0, Math.floor(Number(t.freeBeforeLead ?? 1)));
  return doneCount(store.id, shopperId) >= free && !hasLead(store.id, shopperId);
}

function saveLead(store, shopperId, phone, productId) {
  const shopper = validShopper(shopperId);
  if (!shopper) throw err('comprador inválido', 400);
  const v = validateWhatsapp(phone);
  if (v.error) throw err(v.error, 400, v.code);
  const p = v.phone;
  const db = getDb();
  // o mesmo número em muitos aparelhos: é número emprestado ou inventado
  const others = db.prepare(`SELECT COUNT(*) AS n FROM tryon_lead_links WHERE store_id = ? AND phone = ?
    AND shopper_id <> ? AND created_at >= datetime('now', '-30 days')`).get(store.id, p, shopper).n;
  if (others >= PHONE_MAX_SHOPPERS) throw err('Esse WhatsApp já foi usado em outros aparelhos. Digite o seu número', 400, 'phone_reused');
  db.prepare(`INSERT INTO tryon_leads (store_id, phone, shopper_id, product_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(store_id, phone) DO UPDATE SET shopper_id = excluded.shopper_id`)
    .run(store.id, p, shopper, Number(productId) || null);
  db.prepare(`INSERT INTO tryon_lead_links (store_id, phone, shopper_id) VALUES (?, ?, ?)
    ON CONFLICT DO UPDATE SET created_at = datetime('now')`).run(store.id, p, shopper);
  return p;
}

/** LGPD: WhatsApp de um cliente (pedido de dados / exclusão pela Nuvemshop). */
function findLead(storeId, phone) {
  return getDb().prepare('SELECT phone, created_at FROM tryon_leads WHERE store_id = ? AND phone = ?').get(Number(storeId), phone) || null;
}
function deleteLead(storeId, phone) {
  getDb().prepare('DELETE FROM tryon_lead_links WHERE store_id = ? AND phone = ?').run(Number(storeId), phone);
  return getDb().prepare('DELETE FROM tryon_leads WHERE store_id = ? AND phone = ?').run(Number(storeId), phone).changes;
}

function listLeads(storeId, { limit = 500 } = {}) {
  return getDb().prepare(`SELECT l.phone, l.created_at, l.product_id, p.name AS product_name,
      (SELECT COUNT(*) FROM tryon_jobs j WHERE j.store_id = l.store_id AND j.status = 'done'
        AND j.shopper_id IN (SELECT k.shopper_id FROM tryon_lead_links k WHERE k.store_id = l.store_id AND k.phone = l.phone)) AS tryons
    FROM tryon_leads l LEFT JOIN products p ON p.store_id = l.store_id AND p.id = l.product_id
    WHERE l.store_id = ? ORDER BY l.created_at DESC LIMIT ?`).all(Number(storeId), Math.min(5000, Number(limit) || 500));
}

// ---------- provas ----------

let running = 0;
const waiting = [];
function slot() {
  if (running < cfg.concurrency) { running++; return Promise.resolve(); }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next(); else running--;
}

function rowToJob(row) {
  if (!row) return null;
  return { ...row, hedged: Boolean(row.hedged) };
}

/** Provas por comprador em 24 h (definido pelo lojista, padrão 10). */
function shopperDailyLimit(store) {
  const n = Math.floor(Number(tryonSettings(store).dailyPerShopper));
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/**
 * Limites diários (no banco, valem mesmo depois de reiniciar o servidor).
 * Só contam provas prontas ou em andamento: erro não gasta cota nem limite.
 * Devolve o código do limite atingido ou null.
 */
function dailyLimitHit(store, shopperId, ip) {
  const db = getDb();
  const since = hoursAgo(24);
  const mine = db.prepare(`SELECT COUNT(*) AS n FROM tryon_jobs WHERE store_id = ? AND shopper_id = ?
    AND created_at >= ? AND status IN ('done', 'queued', 'running')`).get(store.id, shopperId, since).n;
  if (mine >= shopperDailyLimit(store)) return 'shopper_daily';
  const key = ipKey(ip);
  if (key && cfg.ipDailyLimit > 0) {
    const fromIp = db.prepare(`SELECT COUNT(*) AS n FROM tryon_jobs WHERE store_id = ? AND ip = ?
      AND created_at >= ? AND status IN ('done', 'queued', 'running')`).get(store.id, key, since).n;
    if (fromIp >= cfg.ipDailyLimit) return 'ip_daily';
  }
  return null;
}

/** Limite atingido antes do envio da foto (não adianta analisar uma foto que não vai virar prova). */
function uploadBlocked(store, shopperId, ip) {
  return dailyLimitHit(store, shopperId, ip);
}

/**
 * Mesma foto (mesmo arquivo, mesmo enviado de novo) no mesmo produto: devolve
 * a prova que já existe (pronta ou em andamento) sem gastar a cota outra vez.
 */
function sameJob(storeId, shopperId, photo, product, image) {
  // provas antigas não guardavam a foto do produto: valiam a principal
  const row = getDb().prepare(`SELECT j.* FROM tryon_jobs j JOIN tryon_photos p ON p.id = j.photo_id
    WHERE j.store_id = ? AND j.shopper_id = ? AND j.product_id = ?
      AND IFNULL(j.product_image, ?) = ?
      AND (j.photo_id = ? OR (p.hash IS NOT NULL AND p.hash = ?))
      AND (j.status IN ('queued', 'running') OR (j.status = 'done' AND j.output_path IS NOT NULL))
    ORDER BY j.created_at DESC LIMIT 1`).get(Number(storeId), shopperId, Number(product.id), product.image || '', image || '',
    photo.id, photo.hash || null);
  if (!row) return null;
  if (row.status === 'done' && !fs.existsSync(row.output_path)) return null;
  return rowToJob(row);
}

function createJob(store, { shopperId, photoId, productId, imageId, variantId, ip }) {
  const shopper = validShopper(shopperId);
  if (!shopper) throw err('comprador inválido', 400);
  const product = svc.getProduct(store.id, productId);
  if (!product) throw err('produto não encontrado', 404);
  const avail = availability(store, product);
  if (!avail.enabled) {
    throw err(avail.reason === 'quota' ? 'provador indisponível no momento' : 'provador indisponível para este produto', 403, avail.reason);
  }
  const photo = getPhoto(store.id, photoId, shopper);
  if (!photo) throw err('foto expirada: envie de novo', 410, 'photo_expired');
  // foto da variação escolhida na página (cor), conferida contra as fotos do produto
  const image = svc.productImage(product, imageId, variantId);
  const again = sameJob(store.id, shopper, photo, product, image);
  if (again) return { ...again, reused: true };
  if (needsLead(store, shopper)) throw err('informe seu WhatsApp para continuar provando', 402, 'lead');
  const hit = dailyLimitHit(store, shopper, ip);
  if (hit) throw err('você chegou ao limite de provas de hoje', 429, hit);
  const id = newId();
  getDb().prepare(`INSERT INTO tryon_jobs (id, store_id, shopper_id, photo_id, product_id, product_image, kind, status, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`).run(id, store.id, shopper, photo.id, product.id, image, avail.kind, ipKey(ip));
  runJob(store.id, id).catch((e) => console.error('[provador]', e));
  return getJob(store.id, id);
}

function getJob(storeId, jobId, shopperId) {
  const id = validUuid(jobId);
  if (!id) return null;
  const job = rowToJob(getDb().prepare('SELECT * FROM tryon_jobs WHERE id = ? AND store_id = ?').get(id, Number(storeId)));
  if (!job || (shopperId && job.shopper_id !== shopperId)) return null;
  return job;
}

function updateJob(id, fields) {
  const keys = Object.keys(fields);
  getDb().prepare(`UPDATE tryon_jobs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => fields[k]), id);
}

/**
 * Modelos por tipo de prova. Roupas e óculos: Muse primeiro; o Nano Banana 2
 * só entra se o Muse falhar ou não responder em TRYON_HEDGE_AFTER_MS (30 s).
 * Vale a primeira imagem que chegar.
 */
function modelsFor(kind) {
  if (kind === 'glasses') return { primary: cfg.glassesPrimaryModel, fallback: cfg.glassesFallbackModel };
  return { primary: cfg.primaryModel, fallback: cfg.fallbackModel };
}

function produce(input, kind = 'garment') {
  const { primary, fallback } = modelsFor(kind);
  return new Promise((resolve, reject) => {
    let settled = false;
    let hedged = false;
    let started = 0;
    const errors = [];
    const controllers = [];
    let hedgeTimer = null;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(hedgeTimer);
      clearTimeout(overall);
      fn(v);
    };
    const launch = (model) => {
      started++;
      const ac = new AbortController();
      controllers.push(ac);
      provider.generate(model, input, ac.signal).then((r) => {
        controllers.forEach((c) => { if (c !== ac) c.abort(); });
        finish(resolve, { ...r, model, hedged });
      }).catch((e) => {
        if (e.kind === 'aborted') return;
        errors.push(e);
        console.warn(`[provador] ${model}: ${e.message}`);
        if (!hedged && fallback && fallback !== model) { hedged = true; clearTimeout(hedgeTimer); launch(fallback); return; }
        if (errors.length >= started) {
          const blocked = errors.every((x) => x.kind === 'blocked');
          finish(reject, Object.assign(new Error(errors.map((x) => x.message).join(' | ').slice(0, 500)), { kind: blocked ? 'blocked' : 'provider' }));
        }
      });
    };
    const overall = setTimeout(() => {
      controllers.forEach((c) => c.abort());
      finish(reject, Object.assign(new Error('tempo esgotado'), { kind: 'provider' }));
    }, cfg.timeoutMs);
    launch(primary);
    if (fallback && fallback !== primary) {
      hedgeTimer = setTimeout(() => { if (!hedged && !settled) { hedged = true; launch(fallback); } }, cfg.hedgeAfterMs);
    }
  });
}

/** Simulado: devolve a própria foto do comprador depois de alguns segundos. */
async function produceMock(photoFile, product) {
  await new Promise((r) => setTimeout(r, cfg.mockDelayMs));
  if (/\[erro\]/i.test(product.name || '')) throw Object.assign(new Error('falha simulada'), { kind: 'provider' });
  const buffer = fs.readFileSync(photoFile);
  return { buffer, type: (sniffImage(buffer) || {}).type || 'image/jpeg', cost: 0, model: 'mock', hedged: false };
}

/**
 * Foto que vai para a IA. Óculos: só a cabeça (espera a análise da foto por
 * até TRYON_ANALYSIS_WAIT_MS). Roupa: a foto inteira; a análise termina em
 * paralelo com a geração e só é usada na colagem.
 */
async function prepareInput(photo, kind) {
  const prep = { person: null, norm: null, plan: null, analysis: analyzePhoto(photo), post: {} };
  if (cfg.composite) {
    try { prep.norm = await image.normalize(fs.readFileSync(photo.path)); } catch (e) { prep.post.error = `foto: ${e.message}`; }
  }
  if (prep.norm && kind === 'glasses' && cfg.glassesCrop) {
    const t = Date.now();
    const a = await withTimeout(prep.analysis, cfg.analysisWaitMs);
    prep.post.waitMs = Date.now() - t;
    if (a) {
      prep.plan = image.plan('glasses', a, prep.norm.width, prep.norm.height);
      if (prep.plan.crop) {
        prep.person = `data:image/jpeg;base64,${(await image.cropJpeg(prep.norm, prep.plan.region)).toString('base64')}`;
        prep.post.crop = prep.plan.region;
      }
    } else prep.post.analysis = a === undefined ? 'demorou' : 'sem rosto';
  }
  if (!prep.person) prep.person = prep.norm ? `data:image/jpeg;base64,${prep.norm.jpeg.toString('base64')}` : fileDataUrl(photo.path);
  return prep;
}

/** Cola a prova de volta na foto original. Se não der, entrega o que a IA fez. */
async function finishOutput(out, prep, photo, kind) {
  if (!prep.norm) return out;
  const t = Date.now();
  try {
    let plan = prep.plan;
    if (!plan) {
      const a = await withTimeout(prep.analysis, 4000);
      if (!a) { prep.post.analysis = prep.post.analysis || (a === undefined ? 'demorou' : 'sem rosto'); return out; }
      plan = image.plan(kind, a, prep.norm.width, prep.norm.height);
    }
    if (!plan.edit) return out;
    const r = await image.composite({ norm: prep.norm, generated: out.buffer, ...plan });
    prep.post.ms = Date.now() - t;
    if (!r.buffer) {
      prep.post.composite = r;
      console.warn(`[provador] colagem não aplicada (${r.skipped})`);
      return out;   // no recorte dos óculos isso entrega um close do rosto: ainda serve
    }
    prep.post.composite = r.info;
    return { ...out, buffer: r.buffer, type: r.type };
  } catch (e) {
    prep.post.error = e.message;
    console.warn(`[provador] colagem: ${e.message}`);
    return out;
  }
}

async function runJob(storeId, jobId) {
  await slot();
  const t0 = Date.now();
  try {
    const job = getJob(storeId, jobId);
    if (!job || job.status !== 'queued') return;
    updateJob(jobId, { status: 'running' });
    const photo = getDb().prepare('SELECT * FROM tryon_photos WHERE id = ?').get(job.photo_id);
    const product = svc.getProduct(storeId, job.product_id);
    if (!photo || !fs.existsSync(photo.path) || !product) throw Object.assign(new Error('foto ou produto indisponível'), { kind: 'photo' });
    let out;
    let post = null;
    if (cfg.mock) {
      out = await produceMock(photo.path, product);
    } else {
      const image = job.product_image || product.image;
      const info = await productInfo(storeId, product, image);
      const type = job.kind === 'glasses' ? 'glasses' : (info.type === 'glasses' ? 'other' : info.type);
      const prep = await prepareInput(photo, job.kind);
      post = prep.post;
      const input = {
        prompt: prompts.garmentPrompt(type, info.description),
        person: prep.person,
        product: await productImageDataUrl(image),
      };
      out = await produce(input, job.kind);
      out = await finishOutput(out, prep, photo, job.kind);
    }
    const ext = EXT[out.type] || 'png';
    const file = path.join(storeDir(storeId), `${jobId}-out.${ext}`);
    fs.writeFileSync(file, out.buffer);
    updateJob(jobId, {
      status: 'done', model: out.model, hedged: out.hedged ? 1 : 0, cost_usd: out.cost ?? null,
      ms: Date.now() - t0, output_path: file, output_type: out.type,
      post: post ? JSON.stringify(post) : null,
      finished_at: sqlTime(new Date()),
    });
  } catch (e) {
    updateJob(jobId, {
      status: 'error', error: String(e.message || e).slice(0, 500), error_kind: e.kind || 'provider',
      ms: Date.now() - t0, finished_at: sqlTime(new Date()),
    });
  } finally {
    release();
  }
}

/** Visão pública de uma prova para o provador (sem caminho de arquivo nem custo). */
function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id, status: job.status, productId: job.product_id, kind: job.kind,
    error: job.status === 'error' ? (job.error_kind === 'blocked' ? 'blocked' : job.error_kind === 'photo' ? 'photo' : 'provider') : null,
    feedback: job.feedback, createdAt: job.created_at,
    image: job.status === 'done' && job.output_path ? `/api/tryon/${job.store_id}/jobs/${job.id}/image` : null,
  };
}

function history(storeId, shopperId, limit = 20) {
  return getDb().prepare(`SELECT j.*, j.product_image AS used_image, p.name AS product_name, p.image AS product_image, p.price AS product_price
    FROM tryon_jobs j LEFT JOIN products p ON p.store_id = j.store_id AND p.id = j.product_id
    WHERE j.store_id = ? AND j.shopper_id = ? AND j.status = 'done' AND j.output_path IS NOT NULL
    ORDER BY j.created_at DESC LIMIT ?`).all(Number(storeId), shopperId, limit)
    .map((j) => ({ ...publicJob(rowToJob(j)), productName: j.product_name, productImage: j.used_image || j.product_image, productPrice: j.product_price }));
}

function setFeedback(job, value) {
  const v = value === 1 || value === -1 ? value : null;
  updateJob(job.id, { feedback: v });
  return v;
}

// ---------- compartilhamento ----------

function createShare(job) {
  const existing = getDb().prepare('SELECT id FROM tryon_shares WHERE job_id = ?').get(job.id);
  const id = existing ? existing.id : shareId();
  if (!existing) {
    getDb().prepare('INSERT INTO tryon_shares (id, store_id, job_id, product_id) VALUES (?, ?, ?, ?)')
      .run(id, job.store_id, job.id, job.product_id);
  }
  return { id, url: `${config.appUrl}/s/${id}` };
}

function getShare(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{8,20}$/.test(id)) return null;
  const s = getDb().prepare('SELECT * FROM tryon_shares WHERE id = ? AND created_at >= ?')
    .get(id, sqlTime(new Date(Date.now() - cfg.shareTtlDays * 864e5)));
  if (!s) return null;
  const job = getJob(s.store_id, s.job_id);
  if (!job || !job.output_path || !fs.existsSync(job.output_path)) return null;
  const store = svc.getStore(s.store_id);
  if (!store || store.uninstalled_at) return null;
  return { share: s, job, store, product: svc.getProduct(s.store_id, s.product_id) };
}

function countShare(id, field) {
  if (!['views', 'clicks'].includes(field)) return;
  getDb().prepare(`UPDATE tryon_shares SET ${field} = ${field} + 1 WHERE id = ?`).run(id);
}

// ---------- LGPD e limpeza ----------

/** "Apagar agora": fotos, provas e links do comprador somem na hora. */
function deleteShopperData(storeId, shopperId) {
  const db = getDb();
  const sid = Number(storeId);
  const photos = db.prepare('SELECT path FROM tryon_photos WHERE store_id = ? AND shopper_id = ?').all(sid, shopperId);
  const jobs = db.prepare('SELECT id, output_path FROM tryon_jobs WHERE store_id = ? AND shopper_id = ?').all(sid, shopperId);
  photos.forEach((p) => removeFile(p.path));
  jobs.forEach((j) => removeFile(j.output_path));
  db.prepare('DELETE FROM tryon_photos WHERE store_id = ? AND shopper_id = ?').run(sid, shopperId);
  for (const j of jobs) db.prepare('DELETE FROM tryon_shares WHERE job_id = ?').run(j.id);
  // a prova continua contando na cota do mês, mas sem imagem e sem vínculo com o comprador
  db.prepare("UPDATE tryon_jobs SET output_path = NULL, photo_id = NULL, shopper_id = 'apagado' WHERE store_id = ? AND shopper_id = ?")
    .run(sid, shopperId);
  return { photos: photos.length, tryons: jobs.length };
}

/** Roda de hora em hora: fotos somem em TRYON_PHOTO_TTL_HOURS; provas e links em TRYON_SHARE_TTL_DAYS. */
function purge() {
  const db = getDb();
  const photoLimit = hoursAgo(cfg.photoTtlHours);
  const oldPhotos = db.prepare('SELECT id, path FROM tryon_photos WHERE created_at < ?').all(photoLimit);
  oldPhotos.forEach((p) => removeFile(p.path));
  db.prepare('DELETE FROM tryon_photos WHERE created_at < ?').run(photoLimit);
  const outLimit = sqlTime(new Date(Date.now() - cfg.shareTtlDays * 864e5));
  const oldOut = db.prepare('SELECT id, output_path FROM tryon_jobs WHERE output_path IS NOT NULL AND created_at < ?').all(outLimit);
  oldOut.forEach((j) => removeFile(j.output_path));
  db.prepare('UPDATE tryon_jobs SET output_path = NULL WHERE output_path IS NOT NULL AND created_at < ?').run(outLimit);
  db.prepare('DELETE FROM tryon_shares WHERE created_at < ?').run(outLimit);
  // depois de 30 dias a prova vira só estatística, sem id de comprador
  db.prepare("UPDATE tryon_jobs SET shopper_id = 'expirado' WHERE created_at < datetime('now', '-30 days') AND shopper_id NOT IN ('apagado', 'expirado')").run();
  db.prepare("DELETE FROM tryon_lead_links WHERE created_at < datetime('now', '-30 days')").run();
  db.prepare("UPDATE tryon_jobs SET ip = NULL WHERE ip IS NOT NULL AND created_at < datetime('now', '-2 days')").run();
  // prova que ficou "rodando" por causa de um reinício do servidor
  db.prepare("UPDATE tryon_jobs SET status = 'error', error = 'interrompida', error_kind = 'provider' WHERE status IN ('queued', 'running') AND created_at < datetime('now', '-10 minutes')").run();
  return { photos: oldPhotos.length, outputs: oldOut.length };
}

// ---------- vendas ----------

/**
 * Venda com o provador: produto provado (aviso da página de obrigado) que está
 * mesmo no pedido pago. O tamanho não importa: vale se o comprador clicou em
 * "Comprar" no provador ou escolheu o tamanho depois, na página do produto.
 * Chamado por importOrder, que já tem o pedido da Nuvemshop.
 */
function recordSale(storeId, orderId, productId, value = null) {
  const v = Number.isFinite(Number(value)) && value != null ? Math.round(Number(value) * 100) / 100 : null;
  return getDb().prepare('INSERT INTO tryon_sales (store_id, order_id, product_id, value) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING')
    .run(Number(storeId), Number(orderId), Number(productId), v).changes;
}

// ---------- relatório ----------

/** 00:00 do dia em Brasília (UTC-3) que contém `now`, em milissegundos. */
function dayStartMs(now = Date.now()) {
  const local = new Date(now - 3 * 3600000);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + 3 * 3600000;
}

/**
 * Janela do relatório: 'today' e 'yesterday' (dias de Brasília, série por hora)
 * ou N dias corridos (série por dia). A comparação usa a janela anterior do
 * mesmo tamanho: hoje até agora contra ontem até a mesma hora.
 */
function statsWindow(period, now = Date.now()) {
  if (period === 'today' || period === 'yesterday') {
    const today = dayStartMs(now);
    const start = period === 'today' ? today : today - 864e5;
    const end = period === 'today' ? now : today;
    return { key: period, start, end, prevStart: start - 864e5, prevEnd: end - 864e5, hourly: true, days: 1 };
  }
  const span = Math.max(1, Math.min(365, Math.round(Number(period)) || 30));
  const start = now - span * 864e5;
  return { key: String(span), start, end: now, prevStart: start - span * 864e5, prevEnd: start, hourly: false, days: span };
}

function stats(storeId, period = 30) {
  const db = getDb();
  const sid = Number(storeId);
  const w = statsWindow(period);
  const since = sqlTime(new Date(w.start));
  const until = sqlTime(new Date(w.end + 1000));
  const j = db.prepare(`SELECT
      SUM(status = 'done') AS done, SUM(status = 'error') AS errors,
      COUNT(DISTINCT CASE WHEN status = 'done' THEN shopper_id END) AS people,
      SUM(feedback = 1) AS up, SUM(feedback = -1) AS down,
      AVG(CASE WHEN status = 'done' THEN ms END) AS avg_ms,
      SUM(CASE WHEN status = 'done' AND hedged = 1 THEN 1 ELSE 0 END) AS hedged,
      SUM(CASE WHEN status = 'done' THEN COALESCE(cost_usd, 0) ELSE 0 END) AS cost
    FROM tryon_jobs WHERE store_id = ? AND created_at >= ? AND created_at < ?`).get(sid, since, until);
  const ev = (type) => db.prepare(`SELECT COUNT(DISTINCT COALESCE(json_extract(meta, '$.v'), 'e' || id)) AS n FROM events
    WHERE store_id = ? AND type = ? AND created_at >= ? AND created_at < ?`).get(sid, type, since, until).n;
  const leads = db.prepare('SELECT COUNT(*) AS n FROM tryon_leads WHERE store_id = ? AND created_at >= ? AND created_at < ?').get(sid, since, until).n;
  const shares = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(views), 0) AS views, COALESCE(SUM(clicks), 0) AS clicks
    FROM tryon_shares WHERE store_id = ? AND created_at >= ? AND created_at < ?`).get(sid, since, until);
  const sales = db.prepare('SELECT COUNT(DISTINCT order_id) AS n FROM tryon_sales WHERE store_id = ? AND created_at >= ? AND created_at < ?').get(sid, since, until).n;
  // receita: só o valor dos produtos provados nos pedidos pagos (não o pedido inteiro)
  const revenue = db.prepare('SELECT COALESCE(SUM(value), 0) AS v FROM tryon_sales WHERE store_id = ? AND created_at >= ? AND created_at < ?').get(sid, since, until).v;

  // série: por hora (hoje/ontem) ou por dia, com zeros onde não houve uso
  const bucket = w.hourly ? "strftime('%H', created_at, '-3 hours')" : "date(created_at, '-3 hours')";
  const byKey = new Map(db.prepare(`SELECT ${bucket} AS k, SUM(status = 'done') AS tryons,
      COUNT(DISTINCT CASE WHEN status = 'done' THEN shopper_id END) AS people
    FROM tryon_jobs WHERE store_id = ? AND created_at >= ? AND created_at < ? GROUP BY k`).all(sid, since, until).map((r) => [r.k, r]));
  const salesRows = db.prepare(`SELECT ${bucket} AS k, COUNT(DISTINCT order_id) AS n, COALESCE(SUM(value), 0) AS v
    FROM tryon_sales WHERE store_id = ? AND created_at >= ? AND created_at < ? GROUP BY k`).all(sid, since, until);
  const salesByKey = new Map(salesRows.map((r) => [r.k, r.n]));
  const revenueByKey = new Map(salesRows.map((r) => [r.k, r.v]));
  const daily = [];
  if (w.hourly) {
    const lastHour = w.key === 'today' ? new Date(w.end - 3 * 3600000).getUTCHours() : 23;
    for (let hr = 0; hr <= lastHour; hr++) {
      const k = String(hr).padStart(2, '0');
      const r = byKey.get(k);
      daily.push({ hour: hr, tryons: r?.tryons || 0, people: r?.people || 0, sales: salesByKey.get(k) || 0, revenue: revenueByKey.get(k) || 0 });
    }
  } else {
    for (let i = w.days - 1; i >= 0; i--) {
      const day = new Date(w.end - 3 * 3600000 - i * 864e5).toISOString().slice(0, 10);
      const r = byKey.get(day);
      daily.push({ day, tryons: r?.tryons || 0, people: r?.people || 0, sales: salesByKey.get(day) || 0, revenue: revenueByKey.get(day) || 0 });
    }
  }

  // janela anterior, do mesmo tamanho, para comparar
  const pSince = sqlTime(new Date(w.prevStart));
  const pUntil = sqlTime(new Date(w.prevEnd + 1000));
  const pj = db.prepare(`SELECT SUM(status = 'done') AS done, COUNT(DISTINCT CASE WHEN status = 'done' THEN shopper_id END) AS people
    FROM tryon_jobs WHERE store_id = ? AND created_at >= ? AND created_at < ?`).get(sid, pSince, pUntil);
  const prevSales = db.prepare('SELECT COUNT(DISTINCT order_id) AS n FROM tryon_sales WHERE store_id = ? AND created_at >= ? AND created_at < ?').get(sid, pSince, pUntil).n;
  const prevRevenue = db.prepare('SELECT COALESCE(SUM(value), 0) AS v FROM tryon_sales WHERE store_id = ? AND created_at >= ? AND created_at < ?').get(sid, pSince, pUntil).v;
  const hadBefore = db.prepare('SELECT 1 FROM tryon_jobs WHERE store_id = ? AND created_at < ? LIMIT 1').get(sid, since);
  const top = db.prepare(`SELECT j.product_id AS id, p.name, COUNT(*) AS tryons,
      (SELECT COUNT(DISTINCT order_id) FROM tryon_sales s WHERE s.store_id = j.store_id AND s.product_id = j.product_id AND s.created_at >= ? AND s.created_at < ?) AS sales
    FROM tryon_jobs j LEFT JOIN products p ON p.store_id = j.store_id AND p.id = j.product_id
    WHERE j.store_id = ? AND j.status = 'done' AND j.created_at >= ? AND j.created_at < ? GROUP BY j.product_id ORDER BY tryons DESC LIMIT 10`).all(since, until, sid, since, until);
  const rated = (j.up || 0) + (j.down || 0);
  const views = ev('tryon_view');
  const opened = ev('tryon_open');
  // visitas que terminaram uma prova (nova ou reaproveitada)
  const triedVisits = db.prepare(`SELECT COUNT(DISTINCT COALESCE(json_extract(e.meta, '$.v'), 'e' || e.id)) AS n
    FROM events e JOIN tryon_jobs j ON j.id = json_extract(e.meta, '$.job') AND j.status = 'done'
    WHERE e.store_id = ? AND e.type = 'tryon_start' AND e.created_at >= ? AND e.created_at < ?`).get(sid, since, until).n;
  return {
    period: w.key, days: w.days, hourly: w.hourly,
    views, opened, triedVisits,
    cameraOpens: ev('camera_open'), cameraReloads: ev('camera_reload'),
    tryons: j.done || 0, people: j.people || 0, errors: j.errors || 0,
    openRate: views ? Math.min(1, opened / views) : null,
    realistic: rated ? (j.up || 0) / rated : null, rated,
    avgSeconds: j.avg_ms ? Math.round(j.avg_ms / 100) / 10 : null,
    hedgedRate: j.done ? (j.hedged || 0) / j.done : null,
    costUsd: Math.round((j.cost || 0) * 1000) / 1000,
    buys: ev('tryon_buy'), leads, sales,
    revenue: Math.round(revenue * 100) / 100,
    previous: hadBefore ? { tryons: pj.done || 0, people: pj.people || 0, sales: prevSales, revenue: prevRevenue } : null,
    shares: shares.n, shareViews: shares.views, shareClicks: shares.clicks,
    daily, top,
  };
}

module.exports = {
  validShopper, savePhoto, getPhoto, prepare, productKind, availability, quota, needsLead, hasLead, saveLead, listLeads, findLead, deleteLead,
  normalizePhone, validateWhatsapp, brandFor, createJob, uploadBlocked, shopperDailyLimit, getJob, publicJob, history, setFeedback, createShare, getShare, countShare,
  deleteShopperData, deleteStoreFiles, purge, recordSale, stats, statsWindow, monthStart, parse,
};
