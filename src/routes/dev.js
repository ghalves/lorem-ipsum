'use strict';
/**
 * Só em DEV_MODE=true: cria uma loja fictícia e uma página de produto que
 * imita um tema Nuvemshop, para testar o fluxo inteiro sem conta de parceiro.
 */
const express = require('express');
const config = require('../config');
const svc = require('../lib/store-service');
const { createSession } = require('../lib/session');

const router = express.Router();
const DEMO_STORE = 999001;

const DEMO_PRODUCTS = [
  { id: 5001, name: { pt: 'Regata básica de poliamida' }, handle: { pt: 'regata-basica' }, cat: 101,
    img: '/dev/img/5001.svg',
    attributes: [{ pt: 'Cor' }, { pt: 'Tamanho' }], colors: ['Marrom'], sizes: ['PP', 'P', 'M', 'G', 'GG'], price: '59.90' },
  { id: 5002, name: { pt: 'Calça wide leg de alfaiataria' }, handle: { pt: 'calca-wide-leg' }, cat: 102,
    img: '/dev/img/5002.svg',
    attributes: [{ pt: 'Tamanho' }], colors: null, sizes: ['36', '38', '40', '42', '44', '46'], price: '189.90' },
  { id: 5003, name: { pt: 'Camiseta masculina algodão' }, handle: { pt: 'camiseta-masculina' }, cat: 103,
    img: '/dev/img/5003.svg',
    attributes: [{ pt: 'Tamanho' }], colors: null, sizes: ['P', 'M', 'G', 'GG', 'XG'], price: '79.90' },
  { id: 5004, name: { pt: 'Óculos de sol havana' }, handle: { pt: 'oculos-havana' }, cat: 104,
    img: '/dev/img/5004.svg',
    attributes: [{ pt: 'Cor' }], colors: null, sizes: ['Único'], price: '249.90' },
];
const CATEGORY_NAMES = { 101: 'Blusas', 102: 'Calças', 103: 'Masculino', 104: 'Óculos' };

// Ilustrações locais das peças (sem depender de imagens externas).
const IMG = {
  5001: { bg: '#efe7df', fill: '#6b4a36', d: 'M130 60c10 40 30 60 70 60s60-20 70-60l20 8c-6 40-4 70 10 100 10 30 10 150 0 250H100c-10-100-10-220 0-250 14-30 16-60 10-100z' },
  5002: { bg: '#e7ebef', fill: '#2d3a4a', d: 'M120 60h160l30 400h-90l-20-300-20 300H90z' },
  5003: { bg: '#eef0e6', fill: '#4d6b3c', d: 'M150 60c10 20 30 30 50 30s40-10 50-30l90 40-30 70-40-20v290H130V150l-40 20-30-70z' },
  5004: { bg: '#f4f1ec', fill: '#7a4a22', d: 'M60 230h120c10 0 16 8 14 18l-10 50c-4 20-20 32-40 32h-40c-20 0-36-12-40-32l-8-50c-2-10 4-18 14-18zm160 0h120c10 0 16 8 14 18l-8 50c-4 20-20 32-40 32h-40c-20 0-36-12-40-32l-10-50c-2-10 4-18 14-18zm-40 10h40v16h-40z' },
};
function absoluteImg(p) { return config.appUrl + p.img; }

function toApiProduct(p) {
  let vid = p.id * 10;
  const variants = [];
  for (const color of p.colors || [null]) {
    for (const size of p.sizes) {
      variants.push({ id: vid++, values: color ? [{ pt: color }, { pt: size }] : [{ pt: size }], price: p.price, stock: size === 'GG' ? 0 : 10 });
    }
  }
  return {
    id: p.id, name: p.name, handle: p.handle, attributes: p.attributes, variants,
    images: [{ src: absoluteImg(p) }], categories: [{ id: p.cat, name: { pt: CATEGORY_NAMES[p.cat] } }],
  };
}

function seed() {
  if (!svc.getStore(DEMO_STORE)) {
    svc.upsertStore({ id: DEMO_STORE, accessToken: 'dev-token', scope: 'read_products,write_scripts', name: 'Loja Demo', domain: 'demo.lojavirtualnuvem.com.br' });
  }
  DEMO_PRODUCTS.forEach((p) => svc.upsertProduct(DEMO_STORE, toApiProduct(p)));
  svc.setStoreField(DEMO_STORE, 'last_sync_at', new Date().toISOString());
  // provador virtual: a loja demo já vem com plano (gerador simulado sem chave do OpenRouter)
  if (!svc.getStore(DEMO_STORE).settings.tryon.plan) svc.updateSettings(DEMO_STORE, { tryon: { plan: 'crescer' } });
}

router.get('/img/:id.svg', (req, res) => {
  const i = IMG[req.params.id];
  if (!i) return res.status(404).end();
  res.type('image/svg+xml').send(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 533"><rect width="400" height="533" fill="${i.bg}"/><path d="${i.d}" fill="${i.fill}"/></svg>`);
});

router.get('/', (req, res) => {
  seed();
  const links = DEMO_PRODUCTS.map((p) => `<li><a href="/dev/store/produtos/${p.id}">${p.name.pt}</a></li>`).join('');
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Demo · Miaou</title>
  <link rel="icon" href="data:,">
  <body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px;line-height:1.6">
  <h1>Miaou · ambiente de teste</h1>
  <p>Loja fictícia <b>#${DEMO_STORE}</b> com 4 produtos (3 roupas e 1 óculos). Abra um produto e clique em <b>Provar virtualmente</b>.</p>
  <h2>Vitrine (simula um tema Nuvemshop)</h2><ul>${links}</ul>
  <h2>Painel do lojista</h2><p><a href="/dev/login">Abrir painel da Loja Demo</a></p></body>`);
});

// o painel usa para saber se está num ambiente de teste (volta sozinho para a loja demo)
router.get('/ping', (req, res) => res.json({ ok: true }));

router.get('/login', (req, res) => {
  seed();
  res.redirect(`/admin/#session=${createSession(DEMO_STORE)}`);
});

// Página de produto no formato dos temas Nuvemshop (LS global, .js-product-form,
// select .js-variation-option, botões .js-insta-variant, .js-addtocart).
router.get('/store/produtos/:id', (req, res) => {
  seed();
  const p = DEMO_PRODUCTS.find((x) => String(x.id) === req.params.id);
  if (!p) return res.status(404).send('produto não encontrado');
  const api = toApiProduct(p);
  const sizeIdx = p.attributes.findIndex((a) => a.pt === 'Tamanho');
  const LS = {
    store: { id: DEMO_STORE },
    product: { id: p.id, name: p.name.pt },
    variants: api.variants.map((v) => ({ id: v.id, option0: v.values[0].pt, option1: v.values[1]?.pt || null, available: v.stock > 0 })),
  };
  const sizeButtons = p.sizes.map((s) => `<a href="#" class="js-insta-variant btn-variant" data-option="${s}">${s}</a>`).join('');
  const sizeOptions = p.sizes.map((s) => `<option value="${s}">${s}</option>`).join('');
  const colorBlock = p.colors ? `<div class="form-group"><label>Cor: <b>${p.colors[0]}</b></label>
    <select class="js-variation-option" name="variation[0]" hidden><option value="${p.colors[0]}">${p.colors[0]}</option></select></div>` : '';
  res.type('html').send(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.name.pt} · Loja Demo</title>
<link rel="icon" href="data:,"><meta property="og:type" content="product"><meta property="og:image" content="${absoluteImg(p)}">
<style>
  body{margin:0;font-family:Georgia,serif;color:#222;background:#fff}
  header{border-bottom:1px solid #eee;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
  header b{letter-spacing:.2em}.cart{font-family:system-ui;font-size:14px}
  .wrap{max-width:1080px;margin:32px auto;padding:0 24px;display:grid;grid-template-columns:1.1fr 1fr;gap:48px}
  .wrap img{width:100%;aspect-ratio:3/4;object-fit:cover;background:#f3f3f3}
  h1{font-weight:400;font-size:28px;margin:0 0 8px}.price{font-size:22px;margin:0 0 24px;font-family:system-ui}
  .form-group{margin-bottom:16px;font-family:system-ui;font-size:14px}
  .js-product-variants{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
  .btn-variant{display:inline-flex;min-width:44px;height:40px;align-items:center;justify-content:center;border:1px solid #bbb;border-radius:20px;color:#222;text-decoration:none;font-family:system-ui}
  .btn-variant.selected{background:#222;color:#fff;border-color:#222}
  .js-addtocart{width:100%;height:52px;background:#4b2bd6;color:#fff;border:0;border-radius:26px;font-size:16px;cursor:pointer;font-family:system-ui}
  .toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:12px 18px;border-radius:8px;font-family:system-ui;display:none}
  @media(max-width:760px){.wrap{grid-template-columns:1fr;gap:20px}}
</style>
<script>window.LS = ${JSON.stringify(LS)};</script>
</head><body>
<header><b>LOJA DEMO</b><span class="cart">Sacola (<span id="cartCount">0</span>)</span></header>
<div class="wrap js-product-container" id="single-product" data-product-id="${p.id}">
  <img src="${p.img}" alt="${p.name.pt}">
  <div>
    <h1>${p.name.pt}</h1><p class="price">R$ ${p.price.replace('.', ',')}</p>
    <form class="js-product-form" action="/comprar/" method="post" data-store="product-form-${p.id}">
      ${colorBlock}
      <div class="form-group"><label>Tamanho: <b id="sizeLabel">escolha</b></label>
        <select class="js-variation-option" name="variation[${sizeIdx}]" id="sizeSelect" hidden><option value="">Escolha</option>${sizeOptions}</select>
        <div class="js-product-variants">${sizeButtons}</div>
      </div>
      <input type="submit" class="js-addtocart" value="Adicionar à sacola">
    </form>
  </div>
</div>
<div class="toast" id="toast"></div>
<script>
  // Comportamento mínimo do tema: escolher variação e adicionar à sacola.
  var sel = document.getElementById('sizeSelect');
  function pick(v){ sel.value = v; document.getElementById('sizeLabel').textContent = v || 'escolha';
    document.querySelectorAll('.btn-variant').forEach(function(b){ b.classList.toggle('selected', b.dataset.option === v); }); }
  document.querySelectorAll('.btn-variant').forEach(function(b){ b.addEventListener('click', function(e){ e.preventDefault(); pick(b.dataset.option); }); });
  sel.addEventListener('change', function(){ pick(sel.value); });
  document.querySelector('.js-product-form').addEventListener('submit', function(e){ e.preventDefault();
    var t = document.getElementById('toast');
    if(!sel.value){ t.textContent = 'Escolha um tamanho'; } else {
      var c = document.getElementById('cartCount'); c.textContent = Number(c.textContent) + 1;
      t.textContent = 'Adicionado à sacola: tamanho ' + sel.value; }
    t.style.display = 'block'; setTimeout(function(){ t.style.display = 'none'; }, 2500); });
</script>
<script src="${config.appUrl}/storefront/loader.js?store=${DEMO_STORE}" async></script>
</body></html>`);
});

module.exports = router;
module.exports.DEMO_STORE = DEMO_STORE;
module.exports.seed = seed;
