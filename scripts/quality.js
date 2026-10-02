#!/usr/bin/env node
'use strict';
/**
 * Realismo das provas (joinha do comprador) e câmera do celular, para o
 * operador acompanhar a qualidade. Não aparece no painel do lojista.
 *
 *   node scripts/quality.js            # todas as lojas, últimos 30 dias
 *   node scripts/quality.js 123456     # uma loja, com os produtos
 *   node scripts/quality.js 123456 90  # janela em dias
 */
const { getDb } = require('../src/db');

const [storeArg, daysArg] = process.argv.slice(2);
const days = Math.min(365, Math.max(1, Number(daysArg) || 30));
const since = `-${days} days`;
const db = getDb();
const pct = (up, down) => (up + down ? `${Math.round((up / (up + down)) * 100)}%` : 'sem avaliações');
const line = (r) => `${pct(r.up || 0, r.down || 0)} realista · ${r.up || 0} sim, ${r.down || 0} não · ${r.done || 0} provas`;

const stores = db.prepare(`SELECT j.store_id AS id, s.name, SUM(j.feedback = 1) AS up, SUM(j.feedback = -1) AS down, SUM(j.status = 'done') AS done
  FROM tryon_jobs j LEFT JOIN stores s ON s.id = j.store_id
  WHERE j.created_at >= datetime('now', ?) ${storeArg ? 'AND j.store_id = ?' : ''}
  GROUP BY j.store_id ORDER BY done DESC`).all(...(storeArg ? [since, Number(storeArg)] : [since]));

if (!stores.length) { console.log(`Nenhuma prova nos últimos ${days} dias.`); process.exit(0); }
const all = stores.reduce((a, r) => ({ up: a.up + (r.up || 0), down: a.down + (r.down || 0), done: a.done + (r.done || 0) }), { up: 0, down: 0, done: 0 });
console.log(`Últimos ${days} dias · todas as lojas: ${line(all)}`);
for (const s of stores) console.log(`  ${s.name || s.id} (${s.id}): ${line(s)}`);

// celulares que fecham a página da loja ao abrir a câmera (Android com pouca memória)
const cam = db.prepare(`SELECT SUM(type = 'camera_open') AS opens, SUM(type = 'camera_reload') AS reloads
  FROM events WHERE type IN ('camera_open', 'camera_reload') AND created_at >= datetime('now', ?) ${storeArg ? 'AND store_id = ?' : ''}`)
  .get(...(storeArg ? [since, Number(storeArg)] : [since]));
const opens = cam.opens || 0;
const reloads = cam.reloads || 0;
console.log(opens
  ? `\nCâmera do celular: ${Math.round(Math.min(1, reloads / opens) * 100)}% recarregou a página (${reloads} de ${opens})`
  : '\nCâmera do celular: ninguém usou no período');

if (storeArg) {
  const products = db.prepare(`SELECT j.product_id AS id, p.name, SUM(j.feedback = 1) AS up, SUM(j.feedback = -1) AS down, SUM(j.status = 'done') AS done
    FROM tryon_jobs j LEFT JOIN products p ON p.store_id = j.store_id AND p.id = j.product_id
    WHERE j.store_id = ? AND j.created_at >= datetime('now', ?)
    GROUP BY j.product_id ORDER BY down DESC, done DESC LIMIT 30`).all(Number(storeArg), since);
  console.log('\nPor produto (mais "não" primeiro):');
  for (const p of products) console.log(`  ${p.name || p.id}: ${line(p)}`);
}
