'use strict';
/** API do painel do lojista. Autenticada pelo token de sessão emitido no OAuth. */
const express = require('express');
const svc = require('../lib/store-service');
const sync = require('../lib/sync');
const config = require('../config');
const { verifySession } = require('../lib/session');
const tryon = require('../tryon/service');
const { PLANS, VOLUME, isPlan, getPlan } = require('../tryon/plans');

const router = express.Router();
router.use(express.json({ limit: '20kb' }));

router.use((req, res, next) => {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const session = verifySession(token);
  if (!session || !session.sid) return res.status(401).json({ error: 'sessão inválida ou expirada' });
  const store = svc.getStore(session.sid);
  if (!store) return res.status(401).json({ error: 'loja não encontrada' });
  // app desinstalado: a sessão emitida antes deixa de valer
  if (store.uninstalled_at) return res.status(401).json({ error: 'app desinstalado nesta loja' });
  req.store = store;
  next();
});

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const bad = (res, errors) => res.status(400).json({ error: errors.join('; '), errors });

router.get('/me', wrap(async (req, res) => {
  // abrir o painel atualiza os domínios da loja (ex.: domínio próprio novo),
  // para o provador voltar a conversar com a página do produto
  try {
    if (await sync.refreshDomainsThrottled(req.store.id, 30 * 1000)) req.store = svc.getStore(req.store.id);
  } catch (e) { console.warn(`[domínios] loja ${req.store.id}: ${e.message}`); }
  const s = req.store;
  res.json({
    store: { id: s.id, name: s.name, domain: s.domain, installed_at: s.installed_at, last_sync_at: s.last_sync_at },
    scriptInstalled: Boolean(s.script_association_id),
    scriptConfigured: Boolean(config.nuvemshop.scriptId),
    loaderUrl: `${config.appUrl}/storefront/loader.js?store=${s.id}`,
    settings: s.settings,
    tryon: tryon.quota(s),
    brandRemovable: Boolean(getPlan(s.settings.tryon.plan || config.tryon.defaultPlan).removeBrand),
    supportEmail: config.supportEmail,
    counts: { products: svc.listProducts(s.id, { limit: 1 }).total },
  });
}));

router.put('/settings', (req, res) => {
  const patch = req.body || {};
  const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => ['enabled', 'selectors', 'tryon'].includes(k)));
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  if ('enabled' in clean && typeof clean.enabled !== 'boolean') return bad(res, ['"enabled" deve ser verdadeiro ou falso']);
  if ('selectors' in clean) {
    if (!isObj(clean.selectors)) return bad(res, ['"selectors" inválido']);
    const out = {};
    for (const k of ['anchor', 'addToCart']) {
      if (!(k in clean.selectors)) continue;
      const v = clean.selectors[k];
      if (typeof v !== 'string' || v.length > 300) return bad(res, [`Seletor inválido em "${k}"`]);
      out[k] = v.trim();
    }
    clean.selectors = out;
  }
  if ('tryon' in clean) {
    // plano não se muda por aqui (cobrança): só as preferências
    const t = clean.tryon;
    if (!isObj(t)) return bad(res, ['"tryon" inválido']);
    const out = {};
    for (const k of ['enabled', 'leadCapture', 'buttonAnimation', 'showBrand']) {
      if (k in t) {
        if (typeof t[k] !== 'boolean') return bad(res, [`"tryon.${k}" deve ser verdadeiro ou falso`]);
        out[k] = t[k];
      }
    }
    if ('freeBeforeLead' in t) {
      const n = Number(t.freeBeforeLead);
      if (!Number.isInteger(n) || n < 0 || n > 5) return bad(res, ['Provas antes do WhatsApp: de 0 a 5']);
      out.freeBeforeLead = n;
    }
    if ('dailyPerShopper' in t) {
      const n = Number(t.dailyPerShopper);
      if (!Number.isInteger(n) || n < 1 || n > 50) return bad(res, ['Provas por comprador por dia: de 1 a 50']);
      out.dailyPerShopper = n;
    }
    if ('button' in t) {
      const b = String(t.button || '').trim();
      if (!b || b.length > 40) return bad(res, ['Texto do botão: de 1 a 40 caracteres']);
      out.button = b;
    }
    clean.tryon = out;
  }
  res.json({ settings: svc.updateSettings(req.store.id, clean) });
});

// ---- produtos ----
router.get('/products', (req, res) => {
  const { search = '', limit = 50, offset = 0 } = req.query;
  const r = svc.listProducts(req.store.id, { search: String(search), limit, offset });
  res.json({ total: r.total, items: r.items.map((p) => ({ ...p, tryon_auto: tryon.productKind({ ...p, tryon_kind: null }) })) });
});
router.put('/products/:id/tryon', (req, res, next) => {
  try {
    const p = svc.updateProductTryonKind(req.store.id, req.params.id, req.body?.kind ?? null);
    return p ? res.json({ product: p }) : res.status(404).json({ error: 'produto não encontrado' });
  } catch (e) { next(e); }
});
router.post('/products/sync', wrap(async (req, res) => {
  const count = await sync.syncAllProducts(req.store.id);
  res.json({ ok: true, count });
}));
router.post('/script/install', wrap(async (req, res) => {
  const result = await sync.ensureScript(req.store.id);
  res.json({ ok: !result?.skipped, result });
}));

// ---- provador virtual ----
router.get('/tryon', (req, res) => {
  res.json({
    quota: tryon.quota(req.store),
    // período: today | yesterday | número de dias (7, 30, 90)
    stats: tryon.stats(req.store.id, ['today', 'yesterday'].includes(req.query.period) ? req.query.period : (req.query.period || req.query.days)),
    settings: req.store.settings.tryon,
    plans: PLANS,
    volume: VOLUME,
    allowSelfPlan: config.tryon.allowSelfPlan,
    simulated: config.tryon.mock,
  });
});
router.put('/tryon/plan', (req, res) => {
  // até a cobrança da Nuvemshop estar ligada, o plano é definido pelo operador
  // (scripts/set-plan.js). Pelo painel, só em teste.
  if (!config.tryon.allowSelfPlan) return res.status(403).json({ error: 'Troca de plano pelo suporte Miaou' });
  const key = String(req.body?.plan || '');
  if (!isPlan(key)) return bad(res, ['Plano inválido']);
  svc.updateSettings(req.store.id, { tryon: { plan: key } });
  res.json({ quota: tryon.quota(svc.getStore(req.store.id)) });
});
router.get('/tryon/leads', (req, res) => res.json({ leads: tryon.listLeads(req.store.id, { limit: req.query.limit }) }));
router.get('/tryon/leads.csv', (req, res) => {
  const cell = (v) => {
    const t = String(v ?? '');
    // evita fórmula ao abrir no Excel/Sheets
    const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
    return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const rows = [['WhatsApp', 'Produto', 'Provas', 'Data (UTC)']]
    .concat(tryon.listLeads(req.store.id, { limit: 5000 }).map((l) => [l.phone, l.product_name || '', l.tryons, l.created_at]));
  res.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="leads-provador.csv"')
    .send('\ufeff' + rows.map((r) => r.map(cell).join(';')).join('\r\n'));
});

module.exports = router;
