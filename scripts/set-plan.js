#!/usr/bin/env node
'use strict';
/**
 * Define o plano do provador virtual de uma loja.
 * Usado pelo operador enquanto a cobrança da Nuvemshop não está ligada.
 *
 *   node scripts/set-plan.js 123456 essencial      # troca o plano
 *   node scripts/set-plan.js 123456 none           # tira o plano (provador some)
 *   node scripts/set-plan.js 123456                # mostra plano e uso do mês
 */
const svc = require('../src/lib/store-service');
const tryon = require('../src/tryon/service');
const { PLANS, VOLUME, isPlan } = require('../src/tryon/plans');

const [storeId, arg] = process.argv.slice(2);
if (!storeId) {
  console.log('Uso: node scripts/set-plan.js <id da loja> [plano]');
  console.log('Planos:', PLANS.map((p) => `${p.key} (${p.quota} provas, R$ ${p.price})`).join(', '), ', none');
  console.log('Volume:', VOLUME.map((p) => `${p.key} (R$ ${p.price})`).join(', '));
  process.exit(1);
}
const store = svc.getStore(storeId);
if (!store) { console.error(`Loja ${storeId} não encontrada.`); process.exit(1); }

if (arg) {
  if (arg !== 'none' && !isPlan(arg)) { console.error(`Plano "${arg}" não existe.`); process.exit(1); }
  tryon.setPlan(store.id, arg);
  console.log(`Plano: ${arg}.`);
}
const q = tryon.quota(svc.getStore(store.id));
console.log(`${store.name || store.id}: ${q.plan.name} · ${q.used}/${q.plan.quota} provas no ciclo · renova em ${new Date(q.renewsAt).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
