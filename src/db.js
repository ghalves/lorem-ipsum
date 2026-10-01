'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY,            -- id da loja na Nuvemshop (user_id do OAuth)
  access_token TEXT NOT NULL,
  scope TEXT,
  name TEXT,
  domain TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  script_association_id INTEGER,
  installed_at TEXT NOT NULL DEFAULT (datetime('now')),
  uninstalled_at TEXT,
  last_sync_at TEXT
);

CREATE TABLE IF NOT EXISTS products (
  store_id INTEGER NOT NULL,
  id INTEGER NOT NULL,
  name TEXT,
  handle TEXT,
  image TEXT,
  categories TEXT NOT NULL DEFAULT '[]', -- [{id,name}]
  url TEXT,
  price TEXT,
  tryon_kind TEXT,                       -- auto (null) | garment | glasses | off
  deleted INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, id)
);

-- Uso na vitrine (botão visto, provador aberto, clique em Comprar, compartilhamento)
-- e pedidos pagos. meta.v é um id de visita aleatório: conta pessoas, não cliques.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  product_id INTEGER,
  type TEXT NOT NULL,
  meta TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_store_time ON events(store_id, created_at);

-- Página de "obrigado" da loja: o loader informa quais produtos daquele pedido
-- o comprador provou. Liga a venda ao provador pelo número do pedido, sem
-- adivinhação e sem dado do cliente. (size_recommended guarda "__tryon".)
CREATE TABLE IF NOT EXISTS order_claims (
  store_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  size_recommended TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, order_id, product_id)
);

-- ===== Provador virtual =====

-- Foto enviada pelo comprador. Fica no disco por poucas horas (TRYON_PHOTO_TTL_HOURS)
-- para ele provar outras peças sem enviar de novo. O id é aleatório e é o único
-- acesso à foto; não guardamos nome, e-mail nem id de cliente da loja.
CREATE TABLE IF NOT EXISTS tryon_photos (
  id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  shopper_id TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tryon_photos_time ON tryon_photos(created_at);

CREATE TABLE IF NOT EXISTS tryon_jobs (
  id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  shopper_id TEXT NOT NULL,
  photo_id TEXT,
  product_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'garment',     -- garment | glasses
  status TEXT NOT NULL DEFAULT 'queued',    -- queued | running | done | error
  model TEXT,
  hedged INTEGER NOT NULL DEFAULT 0,        -- a reserva chegou a ser disparada
  cost_usd REAL,
  ms INTEGER,
  error TEXT,
  error_kind TEXT,                          -- photo | blocked | provider
  output_path TEXT,
  output_type TEXT,
  feedback INTEGER,                         -- 1 realista | -1 não corresponde
  credit_used INTEGER NOT NULL DEFAULT 0,   -- sem uso (versões antigas tinham provas extras)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tryon_jobs_store_time ON tryon_jobs(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tryon_jobs_shopper ON tryon_jobs(store_id, shopper_id);

-- Descrição da peça (feita uma vez por imagem de produto) usada no prompt.
-- Tipo e descrição da peça por foto de produto (cada variação de cor é uma
-- peça diferente para a IA). Substitui tryon_products, que era por produto.
CREATE TABLE IF NOT EXISTS tryon_image_info (
  store_id INTEGER NOT NULL,
  image TEXT NOT NULL,
  type TEXT,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, image)
);

CREATE TABLE IF NOT EXISTS tryon_products (
  store_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  image TEXT,
  type TEXT,                                -- dress | top | bottom | full | glasses | other
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, product_id)
);

-- WhatsApp que o comprador informou para continuar provando (2ª prova em diante).
CREATE TABLE IF NOT EXISTS tryon_leads (
  store_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  shopper_id TEXT NOT NULL,
  product_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_tryon_leads_shopper ON tryon_leads(store_id, shopper_id);

-- Quais navegadores (comprador) cada WhatsApp liberou. Um número só libera
-- poucos aparelhos: impede que um número inventado sirva para todo mundo.
CREATE TABLE IF NOT EXISTS tryon_lead_links (
  store_id INTEGER NOT NULL,
  phone TEXT NOT NULL,
  shopper_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, phone, shopper_id)
);
CREATE INDEX IF NOT EXISTS idx_tryon_lead_links_shopper ON tryon_lead_links(store_id, shopper_id);

-- Link público de compartilhamento de uma prova (expira em TRYON_SHARE_TTL_DAYS).
CREATE TABLE IF NOT EXISTS tryon_shares (
  id TEXT PRIMARY KEY,
  store_id INTEGER NOT NULL,
  job_id TEXT NOT NULL,
  product_id INTEGER NOT NULL,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pedido pago com produto que o comprador provou (página de obrigado + webhook).
CREATE TABLE IF NOT EXISTS tryon_sales (
  store_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (store_id, order_id, product_id)
);
`;

/** Colunas acrescentadas depois (bancos criados por versões anteriores). */
const MIGRATIONS = [
  ['products', 'url', 'TEXT'],
  ['products', 'price', 'TEXT'],
  ['products', 'tryon_kind', 'TEXT'],
  ['tryon_photos', 'analysis', 'TEXT'], // JSON: caixas do rosto, olhos e corpo (recorte/colagem)
  ['tryon_jobs', 'post', 'TEXT'],       // JSON: recorte e colagem aplicados na prova
  ['tryon_photos', 'hash', 'TEXT'],     // sha256 da foto: a mesma foto no mesmo produto não gera outra prova
  ['tryon_jobs', 'ip', 'TEXT'],         // hash do IP (com segredo): limite diário por IP em cada loja
  ['products', 'images', 'TEXT'],       // JSON [{id, src}]: todas as fotos (variações usam image_id)
  ['tryon_jobs', 'product_image', 'TEXT'],  // foto do produto usada (a da variação escolhida)
];

function migrate(conn) {
  for (const [table, column, type] of MIGRATIONS) {
    const cols = conn.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(column)) conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  conn.exec('CREATE INDEX IF NOT EXISTS idx_tryon_jobs_ip ON tryon_jobs(store_id, ip, created_at)');
  // bancos antigos: cada WhatsApp já informado continua liberando o navegador que o informou
  if (!conn.prepare('SELECT 1 FROM tryon_lead_links LIMIT 1').get()) {
    conn.exec(`INSERT OR IGNORE INTO tryon_lead_links (store_id, phone, shopper_id, created_at)
      SELECT store_id, phone, shopper_id, created_at FROM tryon_leads`);
  }
}

function getDb() {
  if (db) return db;
  if (config.dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  }
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

const parse = (s, fallback) => {
  if (s === null || s === undefined) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
};

module.exports = { getDb, parse };
