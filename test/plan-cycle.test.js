'use strict';
/** Ciclo da cota: renova todo mês no dia em que o plano foi ativado (Brasília). */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const { planCycle } = require('../src/tryon/service');

// horário de Brasília (UTC-3) -> instante
const br = (s) => Date.parse(`${s}-03:00`);

test('ativado dia 17: ciclo de 17 a 16 e renova no dia 17', () => {
  const c = planCycle('2026-09-17T15:00:00-03:00', br('2026-10-07T12:00:00'));
  assert.equal(c.start, '2026-09-17 03:00:00');            // 17/09 00:00 em Brasília, em UTC
  assert.equal(c.renewsAt, new Date(br('2026-10-17T00:00:00')).toISOString());
  const d = planCycle('2026-09-17T15:00:00-03:00', br('2026-10-17T08:00:00'));
  assert.equal(d.start, '2026-10-17 03:00:00', 'no dia 17 começa o ciclo novo');
});

test('ativado dia 31: em mês mais curto renova no último dia', () => {
  const c = planCycle('2027-01-31T10:00:00-03:00', br('2027-02-10T10:00:00'));
  assert.equal(c.start, '2027-01-31 03:00:00');
  assert.equal(c.renewsAt, new Date(br('2027-02-28T00:00:00')).toISOString());
  const d = planCycle('2027-01-31T10:00:00-03:00', br('2027-03-05T10:00:00'));
  assert.equal(d.start, '2027-02-28 03:00:00');
  assert.equal(d.renewsAt, new Date(br('2027-03-31T00:00:00')).toISOString());
});

test('virada do ano e loja sem data de ativação (dia 1º)', () => {
  const c = planCycle('2026-11-20T10:00:00-03:00', br('2027-01-05T10:00:00'));
  assert.equal(c.start, '2026-12-20 03:00:00');
  assert.equal(c.renewsAt, new Date(br('2027-01-20T00:00:00')).toISOString());
  const old = planCycle(null, br('2026-10-07T10:00:00'));
  assert.equal(old.start, '2026-10-01 03:00:00');
  assert.equal(old.renewsAt, new Date(br('2026-11-01T00:00:00')).toISOString());
});

test('setPlan: plano novo começa o ciclo hoje; trocar de plano mantém o dia', () => {
  const svc = require('../src/lib/store-service');
  const { setPlan } = require('../src/tryon/service');
  svc.upsertStore({ id: 777001, accessToken: 't', scope: '', name: 'Loja', domain: 'x.com' });
  setPlan(777001, 'essencial');
  const since = svc.getStore(777001).settings.tryon.planSince;
  assert.ok(Math.abs(Date.parse(since) - Date.now()) < 5000, 'data de ativação = agora');
  setPlan(777001, 'crescer');
  assert.equal(svc.getStore(777001).settings.tryon.planSince, since, 'upgrade mantém o dia');
  setPlan(777001, 'none');
  svc.updateSettings(777001, { tryon: { planSince: '2020-01-05T12:00:00Z' } });
  const q = setPlan(777001, 'essencial');
  assert.notEqual(svc.getStore(777001).settings.tryon.planSince, '2020-01-05T12:00:00Z', 'voltar de "sem plano" recomeça o ciclo');
  assert.ok(q.renewsAt);
});
