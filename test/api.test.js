'use strict';
/**
 * Testes de integração: sobe uma "Nuvemshop falsa" (OAuth + API REST) e o app,
 * e percorre instalação, webhooks, painel, vitrine, vendas e LGPD.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const express = require('express');

const SECRET = 'test-client-secret';
const STORE_ID = 424242;
const calls = [];
let productName = 'Vestido midi';
// desinstalar na Nuvemshop revoga o token e tira os scripts da loja
let revoked = false;
const scripts = new Set();
function uninstallAtNuvemshop() { revoked = true; scripts.clear(); }
const count = (call) => calls.filter((c) => c === call).length;

function mockNuvemshop() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { calls.push(`${req.method} ${req.path}`); next(); });
  app.post('/apps/authorize/token', (req, res) => {
    if (req.body.code !== 'good-code' || req.body.client_secret !== SECRET) return res.status(400).json({ error: 'invalid' });
    revoked = false;
    res.json({ access_token: 'tok-123', token_type: 'bearer', scope: 'read_products,write_scripts', user_id: STORE_ID });
  });
  const auth = (req, res, next) => (!revoked && req.get('authorization') === 'Bearer tok-123' ? next() : res.status(401).json({}));
  app.get(`/2025-03/${STORE_ID}/store`, auth, (req, res) => res.json({ name: { pt: 'Loja Teste' }, original_domain: 'teste.lojavirtualnuvem.com.br', domains: ['www.minhaloja.com.br'] }));
  app.get(`/2025-03/${STORE_ID}/webhooks`, auth, (req, res) => res.json([]));
  app.post(`/2025-03/${STORE_ID}/webhooks`, auth, (req, res) => res.status(201).json({ id: 1, ...req.body }));
  app.get(`/2025-03/${STORE_ID}/scripts`, auth, (req, res) => res.json([...scripts].map((id) => ({ id: 700 + id, script_id: id }))));
  app.post(`/2025-03/${STORE_ID}/scripts`, auth, (req, res) => {
    scripts.add(Number(req.body.script_id));
    res.status(201).json({ id: 777, params: JSON.parse(req.body.query_params) });
  });
  const product = (id) => ({
    id, name: { pt: id === 1 ? productName : 'Saia' }, handle: { pt: 'p' + id },
    attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }],
    variants: [
      { id: id * 10 + 1, values: [{ pt: 'Preto' }, { pt: 'P' }], stock: 3 },
      { id: id * 10 + 2, values: [{ pt: 'Preto' }, { pt: 'M' }], stock: null },
      { id: id * 10 + 3, values: [{ pt: 'Preto' }, { pt: 'G' }], stock: 0 },
    ],
    categories: [{ id: 9, name: { pt: 'Vestidos' } }], images: id === 1 ? [{ src: 'https://cdn.test/vestido.jpg' }] : [],
  });
  app.get(`/2025-03/${STORE_ID}/products`, auth, (req, res) => res.json(req.query.page === '1' ? [product(1), product(2)] : []));
  app.get(`/2025-03/${STORE_ID}/products/:id`, auth, (req, res) => res.json(product(Number(req.params.id))));
  // pedidos 9001 a 9003: app NubeSDK grava os provados no pedido (extra.miaou)
  const tok = (p) => require('../src/lib/session').createRecToken(STORE_ID, p, '__tryon');
  const extras = () => ({
    9001: { miaou: JSON.stringify({ v: 1, p: [[1, tok(1)], [2, tok(2)], [1, 'falso']] }) },
    9002: { miaou: JSON.stringify({ v: 1, p: [[1, tok(1)]] }) },
    9003: { miaou: JSON.stringify({ v: 1, p: [[1, 'forjado']] }) },
  });
  app.get(`/2025-03/${STORE_ID}/orders/:id`, auth, (req, res) => res.json({
    id: Number(req.params.id),
    extra: extras()[req.params.id],
    // pedidos 77777 e 9002 foram criados há 5 dias (9002: boleto pago agora)
    created_at: [77777, 9002].includes(Number(req.params.id)) ? new Date(Date.now() - 5 * 864e5).toISOString() : new Date().toISOString(),
    // pedido 8888: só a Saia (produto 2); os outros: o Vestido (produto 1)
    products: Number(req.params.id) === 8888
      ? [{ product_id: 2, variant_values: ['Preto', 'G'], quantity: 1 }]
      : [{ product_id: 1, variant_values: ['Preto', 'M'], quantity: 1 }],
  }));
  // página da loja lida pelo "Estilo da loja" (amostra real do tema Ipanema)
  app.get('/tema/', (req, res) => res.sendFile(require('node:path').join(__dirname, 'fixtures', 'tema-ipanema.html')));
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); });
}

let base;
let servers = [];
test.before(async () => {
  const mock = await listen(mockNuvemshop());
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;
  Object.assign(process.env, {
    DATABASE_PATH: ':memory:', SESSION_SECRET: 'sess', NUVEMSHOP_APP_ID: '123',
    NUVEMSHOP_CLIENT_SECRET: SECRET, NUVEMSHOP_API_BASE: mockUrl, NUVEMSHOP_AUTH_BASE: mockUrl,
    NUVEMSHOP_SCRIPT_ID: '555', APP_URL: 'http://app.test', STORE_STYLE_URL: `${mockUrl}/tema/`,
  });
  const { createApp } = require('../src/app');
  const app = await listen(createApp());
  base = `http://127.0.0.1:${app.address().port}`;
  servers = [mock, app];
});
test.after(() => servers.forEach((s) => s.close()));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let session;

async function adminApi(method, path, body) {
  const r = await fetch(base + '/api/admin' + path, {
    method, headers: { authorization: 'Bearer ' + session, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json() };
}

function hook(event, id) {
  const payload = JSON.stringify({ store_id: STORE_ID, event, id });
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return fetch(base + '/webhooks/nuvemshop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-linkedstore-hmac-sha256': hmac }, body: payload });
}
function lgpd(path, payloadObj) {
  const payload = JSON.stringify(payloadObj);
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  return fetch(base + '/webhooks/lgpd/' + path, { method: 'POST', headers: { 'x-linkedstore-hmac-sha256': hmac }, body: payload });
}
const storeCfg = async (product) => (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=${product}`)).json();
const originOf = async (o) => (await (await fetch(`${base}/api/tryon/${STORE_ID}/session?product=1&origin=${encodeURIComponent(o)}`)).json()).parentOrigin;
const tryToken = (productId) => require('../src/lib/session').createRecToken(STORE_ID, productId, '__tryon');
async function thankYou(orderId, body) {
  const cfg = await storeCfg(1);
  return (await fetch(`${base}/api/storefront/${STORE_ID}/conversion`, {
    method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ orderId, token: cfg.token, ...body }),
  })).json();
}
const salesOf = (orderId) => require('../src/db').getDb().prepare('SELECT product_id FROM tryon_sales WHERE store_id = ? AND order_id = ?')
  .all(STORE_ID, orderId).map((r) => r.product_id);

test('instalação via OAuth: token, webhooks, script e catálogo', async () => {
  const bad = await fetch(base + '/auth/callback?code=wrong', { redirect: 'manual' });
  assert.ok(bad.status >= 400, 'code inválido não instala');
  const r = await fetch(base + '/auth/callback?code=good-code', { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = r.headers.get('location');
  assert.match(loc, /^\/dashboard\/#session=/);
  session = loc.split('session=')[1];
  await wait(150);
  assert.ok(calls.includes(`POST /2025-03/${STORE_ID}/webhooks`));
  assert.ok(calls.includes(`POST /2025-03/${STORE_ID}/scripts`));
  const me = await adminApi('GET', '/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.store.name, 'Loja Teste');
  assert.equal(me.body.counts.products, 2);
  assert.equal(me.body.scriptInstalled, true);
});

test('painel recusa token forjado e o token da vitrine', async () => {
  const cfg = await storeCfg(1);
  for (const t of ['forjado.xyz', cfg.token]) {
    const r = await fetch(base + '/api/admin/me', { headers: { authorization: 'Bearer ' + t } });
    assert.equal(r.status, 401, t);
  }
});

test('vitrine: botão só com plano e em produto com foto', async () => {
  assert.equal((await storeCfg(1)).tryon.enabled, false, 'sem plano');
  const { getDb } = require('../src/db');
  const svc = require('../src/lib/store-service');
  svc.updateSettings(STORE_ID, { tryon: { plan: 'essencial' } });
  const cfg = await storeCfg(1);
  assert.equal(cfg.tryon.enabled, true);
  assert.equal(cfg.tryon.button, 'Provar em mim');
  assert.equal(cfg.sizeGuide, undefined, 'nada do guia de medidas');
  assert.equal((await storeCfg(2)).tryon.enabled, false, 'produto sem foto');
  assert.ok(getDb());
});

test('painel: preferências validadas; campos desconhecidos são ignorados', async () => {
  assert.equal((await adminApi('PUT', '/settings', { enabled: 'sim' })).status, 400);
  assert.equal((await adminApi('PUT', '/settings', { tryon: { button: '' } })).status, 400);
  assert.equal((await adminApi('PUT', '/settings', { selectors: { anchor: 42 } })).status, 400);
  const ok = await adminApi('PUT', '/settings', { tryon: { button: 'Provar em mim' }, selectors: { anchor: '.meu-lugar' }, sizeGuide: true, texts: { x: 1 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.tryon.button, 'Provar em mim');
  assert.equal(ok.body.settings.selectors.anchor, '.meu-lugar');
  assert.equal(ok.body.settings.sizeGuide, undefined);
  assert.equal(ok.body.settings.texts, undefined);
  for (const path of ['/charts', '/templates', '/reports', '/feedback', '/categories']) {
    assert.equal((await adminApi('GET', path)).status, 404, `${path} não existe mais`);
  }
});

test('aparência: Estilo da loja só do Crescer para cima, lido sozinho e aplicado no provador', async () => {
  const svc = require('../src/lib/store-service');
  const sessionStyle = async () => (await (await fetch(`${base}/api/tryon/${STORE_ID}/session?product=1`)).json()).style;
  assert.equal(await sessionStyle(), null, 'padrão: Estilo Miaou');
  // plano Essencial: recurso bloqueado
  svc.updateSettings(STORE_ID, { tryon: { plan: 'essencial' } });
  assert.equal((await adminApi('GET', '/me')).body.look.allowed, false);
  assert.equal((await adminApi('PUT', '/settings', { tryon: { look: { mode: 'loja' } } })).status, 403);
  assert.equal((await adminApi('POST', '/tryon/look/refresh')).status, 403);
  // validação
  for (const look of [{ mode: 'x' }, { buttonBg: 'red;}' }, { buttonRadius: 99 }, 'loja']) {
    assert.equal((await adminApi('PUT', '/settings', { tryon: { look } })).status, 400, JSON.stringify(look));
  }
  // fonte e endereço da fonte não entram pelo painel
  const sneaky = await adminApi('PUT', '/settings', { tryon: { look: { font: 'Evil', fontHref: 'https://evil.test/x.css' } } });
  assert.equal(sneaky.status, 200);
  assert.equal(sneaky.body.settings.tryon.look.font, undefined);
  // Crescer: ligar o Estilo da loja lê o tema na hora (sem botão)
  svc.updateSettings(STORE_ID, { tryon: { plan: 'crescer' } });
  const on = await adminApi('PUT', '/settings', { tryon: { look: { mode: 'loja' } } });
  assert.equal(on.status, 200);
  assert.ok(on.body.look.detectedAt, 'leu o tema ao ligar');
  assert.equal(on.body.look.theme, 'ipanema');
  let st = await sessionStyle();
  assert.equal(st.buttonBg, '#000000');
  assert.equal(st.buttonFg, '#ffffff');
  assert.equal(st.buttonRadius, 0);
  assert.equal(st.cardRadius, 8);
  assert.equal(st.font, 'Zalando Sans');
  assert.match(st.fontHref, /^https:\/\/fonts\.googleapis\.com\//);
  // ajuste à mão sobrevive à releitura do tema
  await adminApi('PUT', '/settings', { tryon: { look: { buttonBg: '#ffff00', buttonFg: '#ffffff', cardRadius: 20 } } });
  const reread = await adminApi('POST', '/tryon/look/refresh');
  assert.equal(reread.status, 200);
  st = await sessionStyle();
  assert.equal(st.buttonBg, '#ffff00', 'ajuste mantido');
  assert.equal(st.buttonFg, '#000000', 'contraste garantido');
  assert.equal(st.cardRadius, 20);
  assert.equal(st.buttonRadius, 0, 'o resto segue a loja');
  // voltar ao da loja
  await adminApi('PUT', '/settings', { tryon: { look: { buttonBg: null, buttonFg: null, cardRadius: null } } });
  assert.equal((await sessionStyle()).buttonBg, '#000000');
  // prévia do painel: mesmo cálculo, sem salvar
  const pv = await adminApi('POST', '/tryon/look/preview', { look: { buttonBg: '#1e3a8a', buttonRadius: 30 } });
  assert.equal(pv.status, 200);
  assert.match(pv.body.vars, /--btn-bg:#1e3a8a/);
  assert.match(pv.body.vars, /--btn-radius:9999px/);
  assert.equal((await sessionStyle()).buttonBg, '#000000', 'a prévia não salva');
  // descer de plano: o provador volta ao Estilo Miaou sozinho
  svc.updateSettings(STORE_ID, { tryon: { plan: 'essencial' } });
  assert.equal(await sessionStyle(), null);
  // a página do provador aceita a fonte do Google; a prévia abre sem sessão
  const csp = (await fetch(`${base}/tryon/?store=${STORE_ID}&preview=1`)).headers.get('content-security-policy');
  assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
  // volta ao padrão para os outros testes
  svc.updateSettings(STORE_ID, { tryon: { look: { mode: 'miaou' } } });
});

test('webhook com HMAC válido atualiza produto; inválido é rejeitado', async () => {
  const payload = JSON.stringify({ store_id: STORE_ID, event: 'product/updated', id: 1 });
  const bad = await fetch(base + '/webhooks/nuvemshop', { method: 'POST', headers: { 'content-type': 'application/json', 'x-linkedstore-hmac-sha256': 'errado' }, body: payload });
  assert.equal(bad.status, 401);
  productName = 'Vestido midi atualizado';
  assert.equal((await hook('product/updated', 1)).status, 200);
  await wait(100);
  const list = await adminApi('GET', '/products?search=atualizado');
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].tryon_auto, 'garment');
});

test('provador aceita todos os domínios da loja e recusa os outros', async () => {
  assert.equal(await originOf('https://www.minhaloja.com.br'), 'https://www.minhaloja.com.br', 'domínio próprio com www');
  assert.equal(await originOf('https://minhaloja.com.br'), 'https://minhaloja.com.br', 'domínio próprio sem www');
  assert.equal(await originOf('https://teste.lojavirtualnuvem.com.br'), 'https://teste.lojavirtualnuvem.com.br', 'domínio original');
  assert.equal(await originOf('https://minhaloja.com.br.golpe.com'), null, 'domínio parecido é recusado');
  assert.equal(await originOf('https://outra-loja.com.br'), null);
});

test('domínio próprio novo passa a valer sem reinstalar', async () => {
  const { getDb } = require('../src/db');
  getDb().prepare('UPDATE stores SET domain = ? WHERE id = ?').run('teste.lojavirtualnuvem.com.br', STORE_ID);
  require('../src/lib/sync').resetDomainRefresh(STORE_ID);
  assert.equal(await originOf('https://www.minhaloja.com.br'), null, 'endereço ainda desconhecido');
  await wait(150);   // a própria abertura pede a atualização em segundo plano
  assert.equal(await originOf('https://www.minhaloja.com.br'), 'https://www.minhaloja.com.br', 'domínio próprio passa a valer');
});

test('venda: só conta produto provado que está no pedido pago, dentro da janela de tempo', async () => {
  // pedido 5555: comprou o Vestido que provou (a Saia provada não estava no pedido)
  const r = await thankYou(5555, { tried: [{ productId: 1, token: tryToken(1) }, { productId: 2, token: tryToken(2) }, { productId: 1, token: 'falso' }] });
  assert.equal(r.saved, 2);
  await hook('order/paid', 5555);
  await wait(150);
  assert.deepEqual(salesOf(5555), [1]);
  // pedido 77777 foi criado há 5 dias: aviso de obrigado agora não vale
  await thankYou(77777, { tried: [{ productId: 1, token: tryToken(1) }] });
  await hook('order/paid', 77777);
  await wait(150);
  assert.deepEqual(salesOf(77777), []);
  // webhook chegou antes da página de obrigado: conta assim que o aviso chega
  await hook('order/paid', 6666);
  await wait(100);
  await thankYou(6666, { tried: [{ productId: 1, token: tryToken(1) }] });
  await wait(150);
  assert.deepEqual(salesOf(6666), [1]);
  // script antigo ainda em cache nas lojas manda "recs" com size "__tryon"
  await thankYou(7777, { recs: [{ productId: 1, size: '__tryon', token: tryToken(1) }, { productId: 1, size: 'M', token: 'x' }] });
  await hook('order/paid', 7777);
  await wait(150);
  assert.deepEqual(salesOf(7777), [1]);
  const sem = await fetch(`${base}/api/storefront/${STORE_ID}/conversion`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ orderId: 1, tried: [] }) });
  assert.equal(sem.status, 401, 'sem token da vitrine');
});

test('venda pelo app NubeSDK: provados gravados no pedido, com token válido', async () => {
  await hook('order/paid', 9001);
  await wait(150);
  assert.deepEqual(salesOf(9001), [1], 'só o Vestido estava no pedido; token falso ignorado');
  await hook('order/paid', 9002);
  await wait(150);
  assert.deepEqual(salesOf(9002), [1], 'pedido pago dias depois ainda conta: o vínculo está no próprio pedido');
  await hook('order/paid', 9003);
  await wait(150);
  assert.deepEqual(salesOf(9003), [], 'token forjado não vira venda');
});

test('LGPD: pedido de dados e exclusão do cliente pelo WhatsApp', async () => {
  const { getDb } = require('../src/db');
  getDb().prepare("INSERT INTO tryon_leads (store_id, phone, shopper_id) VALUES (?, '+5521975395040', 'shopper-lgpd-0000001')").run(STORE_ID);
  const q = await (await lgpd('customers-data-request', { store_id: STORE_ID, customer: { id: 1, phone: '(21) 97539-5040' } })).json();
  assert.equal(q.data.whatsapp, '+5521975395040');
  const d = await (await lgpd('customers-redact', { store_id: STORE_ID, customer: { id: 1, phone: '+55 21 97539-5040' } })).json();
  assert.equal(d.removed, 1);
  assert.equal(getDb().prepare('SELECT COUNT(*) AS n FROM tryon_leads WHERE store_id = ?').get(STORE_ID).n, 0);
  const none = await (await lgpd('customers-data-request', { store_id: STORE_ID, customer: { id: 2 } })).json();
  assert.equal(none.data, null);
});

test('desinstalar apaga o token e fecha o painel; reinstalar volta', async () => {
  uninstallAtNuvemshop();
  await hook('app/uninstalled', STORE_ID);
  await wait(100);
  const svc = require('../src/lib/store-service');
  const st = svc.getStore(STORE_ID);
  assert.ok(st.uninstalled_at);
  assert.equal(st.access_token, '', 'token apagado');
  assert.equal((await adminApi('GET', '/me')).status, 401, 'sessão antiga não abre o painel');
  assert.equal((await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).status, 404);
  const r = await fetch(base + '/auth/callback?code=good-code', { redirect: 'manual' });
  session = r.headers.get('location').split('session=')[1];
  await wait(150);
  assert.equal((await adminApi('GET', '/me')).status, 200, 'reinstalado');
  assert.equal(svc.getStore(STORE_ID).access_token, 'tok-123');
});

test('painel em /dashboard; /admin não existe mais', async () => {
  assert.equal((await fetch(base + '/admin/', { redirect: 'manual' })).status, 404);
  const d = await fetch(base + '/dashboard/');
  assert.equal(d.status, 200);
  assert.match(await d.text(), /Miaou · Dashboard/);
  assert.equal(d.headers.get('x-frame-options'), 'DENY');
});

test('aviso de desinstalação atrasado não derruba a loja já reinstalada', async () => {
  await hook('app/uninstalled', STORE_ID);
  await wait(100);
  const svc = require('../src/lib/store-service');
  assert.equal(svc.getStore(STORE_ID).uninstalled_at, null, 'continua instalada');
  assert.equal((await adminApi('GET', '/me')).status, 200);
  assert.equal((await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).status, 200);
});

test('reinstalar antes do aviso de desinstalação recria o script; abrir de novo não duplica', async () => {
  uninstallAtNuvemshop();                       // desinstalou, mas o aviso ainda não chegou
  const before = count(`POST /2025-03/${STORE_ID}/scripts`);
  let r = await fetch(base + '/auth/callback?code=good-code', { redirect: 'manual' });
  session = r.headers.get('location').split('session=')[1];
  await wait(150);
  assert.ok(scripts.has(555), 'script associado de novo');
  assert.equal(count(`POST /2025-03/${STORE_ID}/scripts`), before + 1);
  await hook('app/uninstalled', STORE_ID);      // o aviso chega atrasado
  await wait(100);
  assert.equal((await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).status, 200, 'botão continua na loja');
  r = await fetch(base + '/auth/callback?code=good-code', { redirect: 'manual' });   // lojista abre o app de novo
  await wait(150);
  assert.equal(count(`POST /2025-03/${STORE_ID}/scripts`), before + 1, 'não associa o script duas vezes');
});

test('LGPD store/redact apaga os dados da loja', async () => {
  const r = await lgpd('store-redact', { store_id: STORE_ID });
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).status, 404);
  const { getDb } = require('../src/db');
  for (const t of ['order_claims', 'events', 'products', 'tryon_sales', 'tryon_leads']) {
    assert.equal(getDb().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE store_id = ?`).get(STORE_ID).n, 0, `${t} apagado`);
  }
});
