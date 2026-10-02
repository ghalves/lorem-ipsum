'use strict';
/**
 * Provador virtual: sobe uma Nuvemshop falsa e um OpenRouter falso e percorre
 * foto, prova, reserva (hedge), WhatsApp na 2ª prova, compartilhamento, cota,
 * venda e LGPD.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const sharp = require('sharp');

const SECRET = 'test-client-secret';
const STORE_ID = 515151;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
const PNG_OUT = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('saida-muse')]);
const GEM_OUT = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('saida-gemini')]);

// comportamento do "Muse" falso em cada teste: ok | slow | block
let museMode = 'ok';
const orCalls = [];
const imgCalls = [];   // fotos de produto que o servidor baixou (para a IA)

function mockNuvemshop(selfUrl) {
  const app = express();
  app.use(express.json());
  app.post('/apps/authorize/token', (req, res) => res.json({ access_token: 'tok', scope: 'read_products', user_id: STORE_ID }));
  const auth = (req, res, next) => (req.get('authorization') === 'Bearer tok' ? next() : res.status(401).json({}));
  app.get(`/2025-03/${STORE_ID}/store`, auth, (req, res) => res.json({ name: { pt: 'Loja IA' }, original_domain: 'ia.lojavirtualnuvem.com.br', domains: ['www.lojaia.com.br'] }));
  app.get(`/2025-03/${STORE_ID}/webhooks`, auth, (req, res) => res.json([]));
  app.post(`/2025-03/${STORE_ID}/webhooks`, auth, (req, res) => res.status(201).json({ id: 1 }));
  app.post(`/2025-03/${STORE_ID}/scripts`, auth, (req, res) => res.status(201).json({ id: 9 }));
  const product = (id) => ({
    id, name: { pt: id === 1 ? 'Vestido azulejo' : 'Óculos havana' }, handle: { pt: `p${id}` },
    canonical_url: `https://www.lojaia.com.br/produtos/p${id}/`,
    attributes: [{ pt: 'Tamanho' }],
    // vestido: a variação amarela tem foto própria (image_id 102)
    variants: [{ id: id * 10, values: [{ pt: 'M' }], price: '199.90', stock: 5, image_id: id * 100 + 1 }]
      .concat(id === 1 ? [{ id: 11, values: [{ pt: 'Amarelo' }], price: '199.90', stock: 5, image_id: 102 }] : []),
    categories: [{ id: 3, name: { pt: 'Moda' } }],
    images: [{ id: id * 100 + 1, src: `${selfUrl()}/img/${id}.jpg` }]
      .concat(id === 1 ? [{ id: 102, src: `${selfUrl()}/img/1-amarelo.jpg` }] : []),
  });
  app.get(`/2025-03/${STORE_ID}/products`, auth, (req, res) => res.json(req.query.page === '1' ? [product(1), product(2)] : []));
  app.get(`/2025-03/${STORE_ID}/products/:id`, auth, (req, res) => res.json(product(Number(req.params.id))));
  // pedido 4242: só o vestido (produto 1), tamanho M
  app.get(`/2025-03/${STORE_ID}/orders/:id`, auth, (req, res) => res.json({ id: Number(req.params.id), created_at: new Date().toISOString(),
    products: req.params.id === '4242' ? [{ product_id: 1, variant_values: ['M'] }] : [] }));
  app.get('/img/:id.jpg', (req, res) => { imgCalls.push(req.params.id); res.type('image/jpeg').send(JPEG); });
  return app;
}

function mockOpenRouter() {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.post('/images', async (req, res) => {
    orCalls.push({ path: 'images', model: req.body.model, prompt: req.body.prompt, refs: req.body.input_references?.length });
    if (req.get('authorization') !== 'Bearer or-key') return res.status(401).json({ error: { message: 'no key' } });
    const mode = museMode;   // o modo do teste em que o pedido chegou
    if (mode === 'block') return res.status(400).json({ error: { message: 'The response was filtered due to the prompt triggering our content management policy.' } });
    if (mode === 'slow') await new Promise((r) => setTimeout(r, 1500));
    if (mode === 'zoom') {
      // a IA "deu zoom": corta 20% das bordas e devolve no mesmo tamanho (pés e braços saem do quadro)
      const buf = Buffer.from(req.body.input_references[0].image_url.url.split(',')[1], 'base64');
      const { width: w, height: h } = await sharp(buf).metadata();
      const out = await sharp(buf).extract({ left: Math.round(w * 0.1), top: Math.round(h * 0.1), width: Math.round(w * 0.8), height: Math.round(h * 0.8) })
        .resize(w, h).png().toBuffer();
      return res.json({ data: [{ b64_json: out.toString('base64') }], usage: { cost: 0.01 } });
    }
    if (mode === 'edit') {
      try {
        return res.json({ data: [{ b64_json: (await fakeEdit(req.body.input_references[0].image_url.url)).toString('base64') }], usage: { cost: 0.01 } });
      } catch (e) { return res.status(500).json({ error: { message: e.message } }); }
    }
    res.json({ data: [{ b64_json: PNG_OUT.toString('base64') }], usage: { cost: 0.01 } });
  });
  app.post('/chat/completions', async (req, res) => {
    const model = req.body.model;
    orCalls.push({ path: 'chat', model });
    const text = req.body.messages?.[0]?.content?.[0]?.text || '';
    if (/lite/.test(model) && /Detect the main person/.test(text)) {
      orCalls.push({ path: 'analysis', model });
      return res.json({ choices: [{ message: { content: JSON.stringify(ANALYSIS) } }] });
    }
    if (/lite/.test(model)) {
      // descrição da peça
      return res.json({ choices: [{ message: { content: '```json\n{"type":"dress","description":"a white mini dress with a blue tile print"}\n```' } }] });
    }
    // Nano Banana 2 (reserva): no modo "edit" edita a foto de verdade
    if (museMode === 'edit') {
      const url = req.body.messages[0].content.find((c) => c.type === 'image_url').image_url.url;
      try {
        const out = await fakeEdit(url);
        return res.json({ choices: [{ message: { content: '', images: [{ image_url: { url: `data:image/png;base64,${out.toString('base64')}` } }] } }], usage: { cost: 0.068 } });
      } catch (e) { return res.status(500).json({ error: { message: e.message } }); }
    }
    res.json({ choices: [{ message: { content: '', images: [{ image_url: { url: `data:image/png;base64,${GEM_OUT.toString('base64')}` } }] } }], usage: { cost: 0.068 } });
  });
  return app;
}

// foto "de verdade" para testar recorte e colagem: textura com ruído (dá para alinhar)
const PHOTO_W = 600;
const PHOTO_H = 900;
const ANALYSIS = { face: [150, 380, 300, 620], eyes: [180, 420, 215, 580], person: [100, 200, 950, 800], people: 1 };
let realPhoto;
async function makePhoto() {
  // cenário com formas grandes (como móveis e paredes) + textura fina
  const shapes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PHOTO_W}" height="${PHOTO_H}">
    <rect x="30" y="40" width="160" height="300" fill="#8a5a3c" opacity=".55"/><rect x="420" y="80" width="150" height="220" fill="#3c6a8a" opacity=".55"/>
    <circle cx="120" cy="620" r="90" fill="#2f7d4f" opacity=".5"/><rect x="380" y="560" width="190" height="260" fill="#7a3c8a" opacity=".45"/>
    <rect x="0" y="780" width="600" height="120" fill="#555" opacity=".4"/></svg>`);
  realPhoto = await sharp({ create: { width: PHOTO_W, height: PHOTO_H, channels: 3, noise: { type: 'gaussian', mean: 128, sigma: 45 } } })
    .blur(4).normalise().composite([{ input: shapes }]).jpeg({ quality: 95 }).toBuffer();
}
/**
 * "Muse" que edita de verdade: pinta a peça (azul) e estraga o rosto (cinza) na
 * foto inteira; no recorte quadrado dos óculos pinta uma faixa preta nos olhos.
 * Também clareia tudo um pouco e devolve em outra resolução, como os modelos fazem.
 */
async function fakeEdit(dataUrl) {
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const { width: w, height: h } = await sharp(buf).metadata();
  const box = (x, y, bw, bh, color) => ({ input: { create: { width: Math.round(bw), height: Math.round(bh), channels: 3, background: color } }, left: Math.round(x), top: Math.round(y) });
  const layers = [];
  if (w === h) layers.push(box(w * 0.32, h * 0.415, w * 0.36, h * 0.06, '#000000'));
  else {
    // rosto "mexido": mesma estrutura, borrado e mais vermelho
    const fx = Math.round(w * 0.4);
    const fy = Math.round(h * 0.17);
    const face = await sharp(buf).extract({ left: fx, top: fy, width: Math.round(w * 0.2), height: Math.round(h * 0.11) })
      .blur(2.5).linear([1.1, 1, 1], [20, 0, 0]).toBuffer();
    layers.push(box(w * 0.3, h * 0.35, w * 0.4, h * 0.45, '#1e3cd2'), { input: face, left: fx, top: fy });
  }
  const edited = await sharp(buf).composite(layers).toBuffer();
  return sharp(edited).modulate({ brightness: 1.06 }).resize(Math.round(w * 1.5), Math.round(h * 1.5)).png().toBuffer();
}
async function patch(buf, x, y, r = 5) {
  const { data, info } = await sharp(buf).extract({ left: x - r, top: y - r, width: 2 * r + 1, height: 2 * r + 1 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = [0, 0, 0];
  for (let i = 0; i < data.length; i += 3) for (let c = 0; c < 3; c++) m[c] += data[i + c];
  return m.map((v) => v / (info.width * info.height));
}
const close = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Diferença média por pixel (de 0 a 255) entre duas imagens do mesmo tamanho, numa área. */
async function diff(a, b, r) {
  const get = (x) => sharp(x).extract({ left: r.x, top: r.y, width: r.w, height: r.h }).removeAlpha().raw().toBuffer();
  const [da, db] = await Promise.all([get(a), get(b)]);
  let t = 0;
  for (let i = 0; i < da.length; i++) t += Math.abs(da[i] - db[i]);
  return t / da.length;
}

function listen(app) { return new Promise((resolve) => { const s = http.createServer(app).listen(0, () => resolve(s)); }); }

let base;
let servers = [];
let session;
let storageDir;
test.before(async () => {
  let nsUrl = '';
  const ns = await listen(mockNuvemshop(() => nsUrl));
  nsUrl = `http://127.0.0.1:${ns.address().port}`;
  const or = await listen(mockOpenRouter());
  storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tryon-'));
  Object.assign(process.env, {
    DATABASE_PATH: ':memory:', SESSION_SECRET: 'sess', NUVEMSHOP_APP_ID: '1', NUVEMSHOP_CLIENT_SECRET: SECRET,
    NUVEMSHOP_API_BASE: nsUrl, NUVEMSHOP_AUTH_BASE: nsUrl, APP_URL: 'http://app.test',
    OPENROUTER_API_KEY: 'or-key', OPENROUTER_BASE: `http://127.0.0.1:${or.address().port}`,
    TRYON_HEDGE_AFTER_MS: '300', TRYON_STORAGE_DIR: storageDir, TRYON_ALLOW_SELF_PLAN: 'true',
    // a suíte cria muitas provas do mesmo IP no mesmo dia; os limites têm teste próprio
    TRYON_IP_DAILY_LIMIT: '1000',
  });
  await makePhoto();
  const { createApp } = require('../src/app');
  const app = await listen(createApp());
  base = `http://127.0.0.1:${app.address().port}`;
  servers = [ns, or, app];
});
test.after(() => { servers.forEach((s) => s.close()); fs.rmSync(storageDir, { recursive: true, force: true }); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function admin(method, p, body) {
  const r = await fetch(`${base}/api/admin${p}`, { method, headers: { authorization: `Bearer ${session}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch { /* csv */ }
  return { status: r.status, body: json, text };
}
const T = `${base}/api/tryon/${STORE_ID}`;
const api = (p) => `${base}/api/tryon/${STORE_ID}${p}`;

async function sessionFor(shopper, product = 1) {
  return (await fetch(api(`/session?product=${product}&shopper=${shopper}&origin=https://www.lojaia.com.br`))).json();
}
async function upload(shopper, token, body = JPEG) {
  const r = await fetch(api('/photo'), { method: 'POST', headers: { 'content-type': 'image/jpeg', 'x-shopper': shopper, 'x-szp-token': token }, body });
  return { status: r.status, body: await r.json() };
}
async function createJob(shopper, token, photoId, productId = 1, imageId, variantId) {
  const r = await fetch(api('/jobs'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopperId: shopper, token, photoId, productId, imageId, variantId }) });
  return { status: r.status, body: await r.json() };
}
async function waitJob(shopper, id, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    const j = (await (await fetch(api(`/jobs/${id}?shopper=${shopper}`))).json()).job;
    if (j.status === 'done' || j.status === 'error' || Date.now() - t0 > ms) return j;
    await wait(60);
  }
}
const newShopper = () => crypto.randomUUID();

test('instalação e catálogo', async () => {
  const r = await fetch(`${base}/auth/callback?code=x`, { redirect: 'manual' });
  session = r.headers.get('location').split('session=')[1];
  await wait(200);
  assert.equal((await admin('GET', '/me')).body.counts.products, 2);
});

test('sem plano o provador não aparece', async () => {
  const s = await sessionFor(newShopper());
  assert.equal(s.available, false);
  assert.equal(s.reason, 'quota');
  const cfg = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  assert.equal(cfg.tryon.enabled, false);
  assert.equal(cfg.sizeGuide, undefined, 'sem guia de medidas');
  const plan = await admin('PUT', '/tryon/plan', { plan: 'essencial' });
  assert.equal(plan.status, 200);
  assert.equal(plan.body.quota.plan.quota, 150);
  const cfg2 = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  assert.equal(cfg2.tryon.enabled, true);
  assert.equal(cfg2.tryon.kind, 'garment');
  const oc = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=2`)).json();
  assert.equal(oc.tryon.kind, 'glasses', 'nome com "Óculos" vira prova de óculos');
});

test('foto exige token e formato de imagem', async () => {
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  assert.equal((await upload(shopper, 'forjado.x')).status, 401);
  assert.equal((await upload(shopper, s.token, Buffer.from('não é imagem de verdade'))).status, 415);
  const ok = await upload(shopper, s.token);
  assert.equal(ok.status, 201);
  const img = await fetch(api(`/photo/${ok.body.photoId}?shopper=${shopper}`));
  assert.equal(img.status, 200);
  const other = await fetch(api(`/photo/${ok.body.photoId}?shopper=${newShopper()}`));
  assert.equal(other.status, 404, 'foto de outro comprador não abre');
});

test('prova com o Muse, prompt com a descrição da peça e WhatsApp na 2ª', async () => {
  museMode = 'ok';
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  assert.equal(s.needsLead, false);
  const { body: { photoId } } = await upload(shopper, s.token);
  const c = await createJob(shopper, s.token, photoId);
  assert.equal(c.status, 201);
  const job = await waitJob(shopper, c.body.job.id);
  assert.equal(job.status, 'done');
  assert.ok(job.saleToken);
  const muse = orCalls.filter((x) => x.path === 'images').pop();
  assert.equal(muse.model, 'meta/muse-image');
  assert.equal(muse.refs, 2);
  assert.match(muse.prompt, /white mini dress with a blue tile print/);
  assert.match(muse.prompt, /Preserve everything else/);
  const img = await fetch(`${base}${job.image}?shopper=${shopper}`);
  assert.equal(Buffer.compare(Buffer.from(await img.arrayBuffer()), PNG_OUT), 0);

  // mesma foto no mesmo produto (inclusive enviada de novo): devolve a mesma prova, sem gastar cota
  const quotaBefore = (await admin('GET', '/tryon')).body.quota.used;
  const repeat = await createJob(shopper, s.token, photoId);
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.reused, true);
  assert.equal(repeat.body.job.id, job.id);
  const reup = await upload(shopper, s.token);
  const repeat2 = await createJob(shopper, s.token, reup.body.photoId);
  assert.equal(repeat2.body.job.id, job.id, 'mesma foto enviada de novo também reaproveita');
  assert.equal((await admin('GET', '/tryon')).body.quota.used, quotaBefore, 'repetição não gasta a cota');

  // 2ª prova (outro produto): pede o WhatsApp
  const again = await createJob(shopper, s.token, photoId, 2);
  assert.equal(again.status, 402);
  assert.equal(again.body.code, 'lead');
  assert.equal((await sessionFor(shopper)).needsLead, true);
  const badLead = await fetch(api('/lead'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopperId: shopper, token: s.token, phone: '123' }) });
  assert.equal(badLead.status, 400);
  const lead = await fetch(api('/lead'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopperId: shopper, token: s.token, phone: '(21) 97539-5040', productId: 1 }) });
  assert.equal(lead.status, 200);
  const third = await createJob(shopper, s.token, photoId, 2);
  assert.equal(third.status, 201);
  assert.equal((await waitJob(shopper, third.body.job.id)).status, 'done');
  const history = await (await fetch(api(`/history?shopper=${shopper}`))).json();
  assert.equal(history.items.length, 2);
  const leads = await admin('GET', '/tryon/leads');
  assert.equal(leads.body.leads[0].phone, '+5521975395040');
  const csv = await admin('GET', '/tryon/leads.csv');
  assert.match(csv.text, /\+5521975395040/);
});

test('variação com foto própria: a prova usa a foto da cor escolhida, conferida no servidor', async () => {
  museMode = 'ok';
  const shopper = newShopper();
  imgCalls.length = 0;
  const amarelo = await (await fetch(api(`/session?product=1&shopper=${shopper}&imageId=102&origin=https://www.lojaia.com.br`))).json();
  assert.match(amarelo.product.image, /1-amarelo\.jpg$/, 'a sessão mostra a foto da variação');
  const fora = await (await fetch(api(`/session?product=1&shopper=${shopper}&imageId=999&origin=https://www.lojaia.com.br`))).json();
  assert.match(fora.product.image, /\/img\/1\.jpg$/, 'foto que não é do produto: vale a principal');
  assert.ok(imgCalls.includes('1-amarelo'), 'abrir na cor amarela já prepara a foto dela');
  const { body: { photoId } } = await upload(shopper, amarelo.token);
  const c = await createJob(shopper, amarelo.token, photoId, 1, 102);
  assert.equal(c.status, 201);
  assert.equal((await waitJob(shopper, c.body.job.id)).status, 'done');
  const used = require('../src/db').getDb().prepare('SELECT product_image FROM tryon_jobs WHERE id = ?').get(c.body.job.id);
  assert.match(used.product_image, /1-amarelo\.jpg$/, 'a prova foi gerada com a foto da variação amarela');
  const same = await createJob(shopper, amarelo.token, photoId, 1, 102);
  assert.equal(same.body.reused, true, 'mesma foto e mesma cor: reaproveita');
  const other = await createJob(shopper, amarelo.token, photoId, 1);
  assert.notEqual(other.body.reused, true, 'outra cor do mesmo produto é outra prova');
  const hist = await (await fetch(api(`/history?shopper=${shopper}`))).json();
  assert.match(hist.items[0].productImage, /1-amarelo\.jpg$/, 'o histórico mostra a peça provada');
  // na loja real o app só sabe o id da variação: o servidor acha a foto pelo image_id da API
  const porVariacao = await (await fetch(api(`/session?product=1&shopper=${shopper}&variantId=11&origin=https://www.lojaia.com.br`))).json();
  assert.match(porVariacao.product.image, /1-amarelo\.jpg$/, 'variação amarela (11) aponta para a foto 102');
  const v = await createJob(shopper, amarelo.token, photoId, 1, undefined, 11);
  assert.equal(v.body.reused, true, 'mesma cor pelo id da variação: é a mesma prova');
});

test('Muse recusa a foto: a reserva (Nano Banana 2) entra na hora', async () => {
  museMode = 'block';
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token);
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id);
  assert.equal(job.status, 'done');
  const img = await fetch(`${base}${job.image}?shopper=${shopper}`);
  assert.equal(Buffer.compare(Buffer.from(await img.arrayBuffer()), GEM_OUT), 0);
});

test('Muse demorando: a reserva começa depois do tempo limite e vale a primeira', async () => {
  museMode = 'slow';
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token);
  const t0 = Date.now();
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id);
  assert.equal(job.status, 'done');
  assert.ok(Date.now() - t0 < 1400, 'não esperou o Muse lento');
  const img = await fetch(`${base}${job.image}?shopper=${shopper}`);
  assert.equal(Buffer.compare(Buffer.from(await img.arrayBuffer()), GEM_OUT), 0);
  const st = await admin('GET', '/tryon');
  assert.ok(st.body.stats.hedgedRate > 0);
  museMode = 'ok';
});

test('compartilhar: página pública com prévia e botões para a loja', async () => {
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token);
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id);
  const sh = await (await fetch(api(`/jobs/${job.id}/share`), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopperId: shopper, token: s.token }) })).json();
  assert.match(sh.url, /^http:\/\/app\.test\/s\//);
  const id = sh.url.split('/s/')[1];
  const page = await (await fetch(`${base}/s/${id}`)).text();
  assert.match(page, /og:image" content="http:\/\/app\.test\/s\//);
  assert.match(page, /Vestido azulejo/);
  assert.match(page, /Provar em mim/);
  const go = await fetch(`${base}/s/${id}/go?provar=1`, { redirect: 'manual' });
  assert.equal(go.status, 302);
  assert.equal(go.headers.get('location'), 'https://www.lojaia.com.br/produtos/p1/?provar=1');
  const img = await fetch(`${base}/s/${id}/image`);
  assert.equal(img.status, 200);
  const st = await admin('GET', '/tryon');
  assert.equal(st.body.stats.shares, 1);
  assert.equal(st.body.stats.shareClicks, 1);
});

test('colagem: só a roupa vem da IA; rosto e fundo voltam da foto original', async () => {
  museMode = 'edit';
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token, realPhoto);
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id, 8000);
  assert.equal(job.status, 'done');
  assert.ok(orCalls.some((x) => x.path === 'analysis'), 'analisou a foto');
  const out = Buffer.from(await (await fetch(`${base}${job.image}?shopper=${shopper}`)).arrayBuffer());
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [PHOTO_W, PHOTO_H], 'volta no tamanho da foto original');
  const blue = await patch(out, 300, 500);
  assert.ok(blue[2] > 150 && blue[0] < 90, `peça nova no corpo (${blue})`);
  const faceArea = { x: 280, y: 185, w: 40, h: 35 };
  const gen = await sharp(await fakeEdit(`data:image/jpeg;base64,${realPhoto.toString('base64')}`)).resize(PHOTO_W, PHOTO_H).toBuffer();
  const faceGen = await diff(gen, realPhoto, faceArea);
  const faceOut = await diff(out, realPhoto, faceArea);
  const { getDb } = require('../src/db');
  const post = JSON.parse(getDb().prepare('SELECT post FROM tryon_jobs WHERE id = ?').get(job.id).post);
  assert.ok(faceOut < 4 && faceGen > 8, `rosto original, não o da IA (${faceOut.toFixed(1)} vs ${faceGen.toFixed(1)}) ${JSON.stringify(post)}`);
  assert.ok((await diff(out, realPhoto, { x: 5, y: 5, w: 90, h: 90 })) < 6, 'fundo original');
  assert.equal(post.composite.face.restored, true);
  museMode = 'ok';
});

test('IA mudou o enquadramento (zoom): não cola, entrega a imagem da IA', async () => {
  museMode = 'zoom';
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token, realPhoto);
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id, 8000);
  assert.equal(job.status, 'done');
  const { getDb } = require('../src/db');
  const post = JSON.parse(getDb().prepare('SELECT post FROM tryon_jobs WHERE id = ?').get(job.id).post);
  // o importante é não colar uma imagem com outro enquadramento por cima da foto
  assert.ok(['enquadramento', 'alinhamento'].includes(post.composite.skipped), JSON.stringify(post));
  const out = Buffer.from(await (await fetch(`${base}${job.image}?shopper=${shopper}`)).arrayBuffer());
  assert.equal((await sharp(out).metadata()).format, 'png', 'entregou a imagem da IA como veio');
  museMode = 'ok';
});

test('óculos: Muse recebe só a cabeça e o resultado volta para a foto inteira', async () => {
  museMode = 'edit';
  const shopper = newShopper();
  const s = await sessionFor(shopper, 2);
  const { body: { photoId } } = await upload(shopper, s.token, realPhoto);
  const n = orCalls.length;
  const c = await createJob(shopper, s.token, photoId, 2);
  const job = await waitJob(shopper, c.body.job.id, 8000);
  assert.equal(job.status, 'done');
  const gen = orCalls.slice(n).filter((x) => x.path === 'images' || (x.path === 'chat' && !/lite/.test(x.model)));
  assert.equal(gen[0].model, 'meta/muse-image', 'óculos começam pelo Muse');
  const { getDb } = require('../src/db');
  const post = JSON.parse(getDb().prepare('SELECT post FROM tryon_jobs WHERE id = ?').get(job.id).post);
  assert.ok(post.crop && post.crop.w === post.crop.h && post.crop.w < PHOTO_W, `recorte quadrado da cabeça (${JSON.stringify(post.crop)})`);
  const out = Buffer.from(await (await fetch(`${base}${job.image}?shopper=${shopper}`)).arrayBuffer());
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [PHOTO_W, PHOTO_H]);
  const eyes = await patch(out, 300, 178, 3);
  assert.ok(Math.max(...eyes) < 60, `óculos na altura dos olhos (${eyes})`);
  assert.ok((await diff(out, realPhoto, { x: 270, y: 240, w: 60, h: 25 })) < 6, 'boca e queixo originais');
  assert.ok((await diff(out, realPhoto, { x: 200, y: 450, w: 200, h: 200 })) < 4, 'corpo intacto');
  museMode = 'ok';
});

test('cota do mês: acabou, o botão some da vitrine (sem provas extras); subir de plano volta', async () => {
  const { getDb } = require('../src/db');
  const db = getDb();
  const st = db.prepare("INSERT INTO tryon_jobs (id, store_id, shopper_id, product_id, status) VALUES (?, ?, 'x', 1, 'done')");
  const before = (await admin('GET', '/tryon')).body.quota.used;
  for (let i = 0; i < 150 - before; i++) st.run(crypto.randomUUID(), STORE_ID);
  const q = await admin('GET', '/tryon');
  assert.equal(q.body.quota.available, false);
  assert.equal(q.body.quota.alert, true);
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  assert.equal(s.available, false);
  const cfg = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  assert.equal(cfg.tryon.enabled, false, 'botão some da loja');
  assert.equal(q.body.quota.exhausted, true);
  assert.equal(q.body.quota.credits, undefined, 'não existem provas extras');
  // créditos antigos gravados na loja não liberam nada
  require('../src/lib/store-service').updateSettings(STORE_ID, { tryon: { credits: 50 } });
  assert.equal((await sessionFor(shopper)).available, false);
  // subir de plano libera na hora
  await admin('PUT', '/tryon/plan', { plan: 'crescer' });
  assert.equal((await sessionFor(shopper)).available, true);
  await admin('PUT', '/tryon/plan', { plan: 'essencial' });
  db.prepare("DELETE FROM tryon_jobs WHERE shopper_id = 'x'").run();
});

test('venda: produto provado no pedido pago conta, com qualquer tamanho; provado e não comprado não conta', async () => {
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token);
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id);
  const cfg = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  const conv = await (await fetch(`${base}/api/storefront/${STORE_ID}/conversion`, {
    method: 'POST', headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ orderId: 4242, token: cfg.token, recs: [
      { productId: 1, size: '__tryon', token: job.saleToken }, { productId: 1, size: '__tryon', token: 'falso' },
      // provou os óculos também, mas não comprou
      { productId: 2, size: '__tryon', token: require('../src/lib/session').createRecToken(STORE_ID, 2, '__tryon') },
    ] }),
  })).json();
  assert.equal(conv.saved, 2);
  const payload = JSON.stringify({ store_id: STORE_ID, event: 'order/paid', id: 4242 });
  const hmac = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
  await fetch(`${base}/webhooks/nuvemshop`, { method: 'POST', headers: { 'x-linkedstore-hmac-sha256': hmac, 'content-type': 'application/json' }, body: payload });
  await wait(150);
  const st = await admin('GET', '/tryon');
  assert.equal(st.body.stats.sales, 1);
  const { getDb } = require('../src/db');
  assert.deepEqual(getDb().prepare('SELECT product_id FROM tryon_sales WHERE order_id = 4242').all().map((r) => r.product_id), [1], 'só o produto que estava no pedido');
});

test('"Apagar agora" some com fotos e provas do comprador; limpeza apaga fotos velhas', async () => {
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const { body: { photoId } } = await upload(shopper, s.token);
  const c = await createJob(shopper, s.token, photoId);
  const job = await waitJob(shopper, c.body.job.id);
  const del = await (await fetch(api(`/data?shopper=${shopper}`), { method: 'DELETE' })).json();
  assert.equal(del.deleted.photos, 1);
  assert.equal((await fetch(`${base}${job.image}?shopper=${shopper}`)).status, 404);
  assert.equal((await (await fetch(api(`/history?shopper=${shopper}`))).json()).items.length, 0);

  // foto com mais de 24 h
  const s2 = newShopper();
  const up = await upload(s2, s.token);
  const { getDb } = require('../src/db');
  getDb().prepare("UPDATE tryon_photos SET created_at = datetime('now', '-2 days') WHERE id = ?").run(up.body.photoId);
  const r = require('../src/tryon/service').purge();
  assert.ok(r.photos >= 1);
  assert.equal((await fetch(api(`/photo/${up.body.photoId}?shopper=${s2}`))).status, 404);
});

test('painel: preferências do provador e tipo de prova por produto', async () => {
  const bad = await admin('PUT', '/settings', { tryon: { freeBeforeLead: 9 } });
  assert.equal(bad.status, 400);
  const ok = await admin('PUT', '/settings', { tryon: { leadCapture: false, button: 'Provar em mim', plan: 'pro', credits: 999 }, sizeGuide: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.settings.tryon.leadCapture, false);
  assert.equal(ok.body.settings.tryon.plan, 'essencial', 'plano não muda por aqui');
  assert.equal(ok.body.settings.tryon.credits, 50, 'créditos (legado) não mudam por aqui');
  assert.equal(ok.body.settings.sizeGuide, undefined, 'guia de medidas não existe mais');
  const off = await admin('PUT', '/products/1/tryon', { kind: 'off' });
  assert.equal(off.status, 200);
  const cfg = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  assert.equal(cfg.tryon.enabled, false);
  await admin('PUT', '/products/1/tryon', { kind: null });
});

test('limite por comprador: 10 por dia por padrão, ajustável; erro e repetição não contam', async () => {
  museMode = 'ok';
  const store = require('../src/lib/store-service');
  assert.equal(store.getStore(STORE_ID).settings.tryon.dailyPerShopper, 10, 'padrão 10');
  assert.equal((await admin('PUT', '/settings', { tryon: { dailyPerShopper: 0 } })).status, 400);
  assert.equal((await admin('PUT', '/settings', { tryon: { dailyPerShopper: 51 } })).status, 400);
  assert.equal((await admin('PUT', '/settings', { tryon: { dailyPerShopper: 2, leadCapture: false } })).status, 200);
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const photo = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
  const p1 = (await upload(shopper, s.token, photo())).body.photoId;
  assert.equal((await waitJob(shopper, (await createJob(shopper, s.token, p1, 1)).body.job.id)).status, 'done');
  assert.equal((await waitJob(shopper, (await createJob(shopper, s.token, p1, 2)).body.job.id)).status, 'done');
  // repetir uma prova já feita continua liberado
  assert.equal((await createJob(shopper, s.token, p1, 1)).status, 200);
  // foto nova: limite do dia
  const up = await upload(shopper, s.token, photo());
  assert.equal(up.status, 429, 'nem aceita a foto');
  assert.equal(up.body.code, 'shopper_daily');
  const { getDb } = require('../src/db');
  getDb().prepare("UPDATE tryon_jobs SET created_at = datetime('now', '-25 hours') WHERE shopper_id = ?").run(shopper);
  assert.equal((await upload(shopper, s.token, photo())).status, 201, 'no dia seguinte libera');
  await admin('PUT', '/settings', { tryon: { dailyPerShopper: 10, leadCapture: true } });
});

test('limite por IP em cada loja: trocar o id do navegador não adianta', async () => {
  const cfg = require('../src/config').tryon;
  const saved = cfg.ipDailyLimit;
  const { getDb } = require('../src/db');
  const fromIp = getDb().prepare("SELECT COUNT(*) AS n FROM tryon_jobs WHERE store_id = ? AND ip IS NOT NULL AND status = 'done' AND created_at >= datetime('now', '-24 hours')").get(STORE_ID).n;
  assert.ok(fromIp > 0, 'IP guardado (em hash)');
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM tryon_jobs WHERE ip LIKE '%127.0.0.1%'").get().n, 0, 'IP nunca em texto puro');
  cfg.ipDailyLimit = fromIp;
  try {
    const shopper = newShopper();   // "outra pessoa", mesmo IP
    const s = await sessionFor(shopper);
    const up = await upload(shopper, s.token, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]));
    assert.equal(up.status, 429, 'nem aceita a foto');
    assert.equal(up.body.code, 'ip_daily');
    // foto enviada antes de chegar ao limite também não vira prova
    cfg.ipDailyLimit = 1000;
    const p = (await upload(shopper, s.token, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]))).body.photoId;
    cfg.ipDailyLimit = fromIp;
    const c = await createJob(shopper, s.token, p);
    assert.equal(c.status, 429);
    assert.equal(c.body.code, 'ip_daily');
  } finally { cfg.ipDailyLimit = saved; }
});

test('WhatsApp: só celular de verdade, sem número inventado, e um número não libera muitos aparelhos', async () => {
  const { validateWhatsapp } = require('../src/tryon/service');
  const ok = (n) => validateWhatsapp(n).phone;
  const code = (n) => validateWhatsapp(n).code;
  assert.equal(ok('(21) 97539-5040'), '+5521975395040');
  assert.equal(ok('+55 21 97539-5040'), '+5521975395040');
  assert.equal(ok('021 97539-5040'), '+5521975395040');
  assert.equal(ok('47 98823-4410'), '+5547988234410');
  for (const fake of ['11 99999-9999', '11 91234-5678', '11 98765-4321', '11 91234-1234', '11 96121-2121', '11 99999-1234', '21 90000-0000']) {
    assert.equal(code(fake), 'phone_fake', fake);
  }
  assert.equal(code('20 97539-5040'), 'phone_ddd', 'DDD 20 não existe');
  assert.equal(code('21 3753-9504'), 'phone_landline', 'fixo');
  assert.equal(code('21 87539-5040'), 'phone_landline', 'celular sem o 9');
  assert.equal(code('11 9123'), 'phone');

  // 4 aparelhos com o mesmo número: o 4º é recusado
  const phone = '(31) 98474-2211';
  const post = async (shopper, token) => fetch(api('/lead'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopperId: shopper, token, phone }) });
  for (let i = 0; i < 3; i++) {
    const sh = newShopper();
    assert.equal((await post(sh, (await sessionFor(sh)).token)).status, 200);
    assert.equal((await sessionFor(sh)).hasLead, true, 'cada aparelho fica liberado');
  }
  const fourth = newShopper();
  const r = await post(fourth, (await sessionFor(fourth)).token);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).code, 'phone_reused');
  const inv = await fetch(api('/lead'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shopperId: fourth, token: (await sessionFor(fourth)).token, phone: '11 99999-9999' }) });
  assert.equal(inv.status, 400);
  assert.match((await inv.json()).error, /inventado/);
});

test('varinha do botão: animada por padrão, o lojista desliga', async () => {
  const on = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  assert.equal(on.tryon.animate, true);
  assert.equal((await admin('PUT', '/settings', { tryon: { buttonAnimation: 'sim' } })).status, 400);
  assert.equal((await admin('PUT', '/settings', { tryon: { buttonAnimation: false } })).status, 200);
  const off = await (await fetch(`${base}/api/storefront/${STORE_ID}/config?product=1`)).json();
  assert.equal(off.tryon.animate, false);
  await admin('PUT', '/settings', { tryon: { buttonAnimation: true } });
  const loader = await (await fetch(`${base}/storefront/loader.js`)).text();
  assert.match(loader, /szp-tw3/, 'a mesma varinha da espera, com as três estrelas');
});

test('marca Miaou: aparece com link; só o Escalar e o Volume podem remover', async () => {
  const plan = (await admin('GET', '/me')).body.tryon.plan.key;
  const s1 = await sessionFor(newShopper());
  assert.match(s1.brand.url, /^https:\/\/miaou\.com\.br\/\?utm_source=provador/);
  // plano de entrada: desligar não tem efeito
  await admin('PUT', '/settings', { tryon: { showBrand: false } });
  assert.ok((await sessionFor(newShopper())).brand, 'Essencial não remove a marca');
  assert.equal((await admin('GET', '/me')).body.brandRemovable, false);
  await admin('PUT', '/tryon/plan', { plan: 'escalar' });
  assert.equal((await admin('GET', '/me')).body.brandRemovable, true);
  assert.equal((await sessionFor(newShopper())).brand, null, 'Escalar com a marca desligada');
  await admin('PUT', '/tryon/plan', { plan: 'volume-4000' });
  assert.equal((await sessionFor(newShopper())).brand, null, 'Volume também remove');
  await admin('PUT', '/settings', { tryon: { showBrand: true } });
  assert.ok((await sessionFor(newShopper())).brand);
  assert.equal((await admin('GET', '/me')).body.supportEmail, 'suporte@miaou.com.br');
  await admin('PUT', '/tryon/plan', { plan });
});

test('relatório: hoje e ontem por hora, 7/30/90 dias por dia, comparando com a janela anterior', async () => {
  const today = (await admin('GET', '/tryon?period=today')).body.stats;
  assert.equal(today.period, 'today');
  assert.equal(today.hourly, true);
  assert.ok(today.daily.length >= 1 && today.daily.length <= 24 && today.daily[0].hour === 0);
  assert.ok(today.tryons > 0, 'as provas feitas nos testes são de hoje');
  const yesterday = (await admin('GET', '/tryon?period=yesterday')).body.stats;
  assert.equal(yesterday.daily.length, 24);
  assert.equal(yesterday.hourly, true);
  const week = (await admin('GET', '/tryon?period=7')).body.stats;
  assert.equal(week.daily.length, 7);
  assert.ok(week.daily[6].day);
  assert.equal((await admin('GET', '/tryon?days=90')).body.stats.daily.length, 90, 'parâmetro antigo continua valendo');
  const { statsWindow } = require('../src/tryon/service');
  const w = statsWindow('today', Date.parse('2026-09-29T15:00:00Z'));   // 12h em Brasília
  assert.equal(new Date(w.start).toISOString(), '2026-09-29T03:00:00.000Z');
  assert.equal(new Date(w.prevStart).toISOString(), '2026-09-28T03:00:00.000Z');
  assert.equal(w.prevEnd, w.end - 864e5, 'hoje até agora contra ontem até a mesma hora');
});

test('funil: abrir, provar (nova ou reaproveitada) e comprar contam visitas', async () => {
  museMode = 'ok';
  const before = (await admin('GET', '/tryon?period=today')).body.stats;
  const shopper = newShopper();
  const s = await sessionFor(shopper);
  const ev = (type, visitId) => fetch(api('/events'), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type, token: s.token, productId: 1, visitId }) });
  assert.equal((await ev('tryon_open', 'visitafunil1')).status, 200);
  assert.equal((await ev('tryon_open', 'visitafunil2')).status, 200);
  const { body: { photoId } } = await upload(shopper, s.token);
  const job = async (visitId) => (await fetch(api('/jobs'), { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ shopperId: shopper, token: s.token, photoId, productId: 1, visitId }) })).json();
  const first = await job('visitafunil1');
  assert.equal((await waitJob(shopper, first.job.id)).status, 'done');
  const again = await job('visitafunil2');
  assert.equal(again.reused, true, 'outra visita, mesma foto: prova reaproveitada');
  const after = (await admin('GET', '/tryon?period=today')).body.stats;
  assert.equal(after.opened - before.opened, 2, 'duas visitas abriram o provador');
  assert.equal(after.triedVisits - before.triedVisits, 2, 'a prova reaproveitada também conta como provou');
});

test('normalização do WhatsApp', () => {
  const { normalizePhone } = require('../src/tryon/service');
  assert.equal(normalizePhone('21 97539-5040'), '+5521975395040');
  assert.equal(normalizePhone('+55 (11) 3333-4444'), '+551133334444');
  assert.equal(normalizePhone('11111111111'), null);
  assert.equal(normalizePhone('21 87539-5040'), null, 'celular sem o 9');
  assert.equal(normalizePhone('abc'), null);
});
