'use strict';
/**
 * Página pública de uma prova compartilhada (/s/:id). É o que a amiga vê ao
 * abrir o link no WhatsApp ou no Instagram: a prova, o produto e dois botões
 * que levam para a loja ("Provar em mim" já abre o provador no produto).
 * O link expira em TRYON_SHARE_TTL_DAYS e não aparece em buscadores.
 */
const express = require('express');
const fs = require('node:fs');
const config = require('../config');
const tryon = require('../tryon/service');
const svc = require('../lib/store-service');
const storeStyle = require('../lib/store-style');

const router = express.Router();

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function storeHost(store) {
  const list = String(store.domain || '').split(',').map((d) => d.trim()).filter(Boolean);
  // domínio próprio da loja primeiro; o da Nuvemshop só se não houver outro
  return list.find((d) => !/(lojavirtualnuvem|nuvemshop|tiendanube|mitiendanube)\./.test(d)) || list[0] || null;
}

function productUrl(store, product) {
  if (product?.url && /^https?:\/\//.test(product.url)) return product.url;
  const host = storeHost(store);
  if (!host) return null;
  return product?.handle ? `https://${host}/produtos/${encodeURIComponent(product.handle)}/` : `https://${host}/`;
}

function withParam(url, key, value) {
  try { const u = new URL(url); u.searchParams.set(key, value); return u.toString(); } catch { return url; }
}

router.use((req, res, next) => {
  res.set('X-Robots-Tag', 'noindex, nofollow');
  next();
});

router.get('/:id/image', (req, res) => {
  const s = tryon.getShare(req.params.id);
  if (!s) return res.status(404).end();
  res.set('Cache-Control', 'public, max-age=3600').type(s.job.output_type || 'image/jpeg');
  fs.createReadStream(s.job.output_path).pipe(res);
});

// Clique em um dos botões: conta e leva para a loja.
router.get('/:id/go', (req, res) => {
  const s = tryon.getShare(req.params.id);
  if (!s) return res.status(404).send('Link expirado.');
  const url = productUrl(s.store, s.product);
  if (!url) return res.status(404).send('Produto indisponível.');
  tryon.countShare(s.share.id, 'clicks');
  svc.logEvent(s.store.id, { type: 'share_click', productId: s.share.product_id, meta: { share: s.share.id } });
  res.redirect(req.query.provar === '1' ? withParam(url, 'provar', '1') : url);
});

router.get('/:id', (req, res) => {
  const s = tryon.getShare(req.params.id);
  res.set('Cache-Control', 'no-store');
  if (!s) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Link expirado</title><body style="font-family:system-ui,sans-serif;padding:40px 20px;text-align:center;color:#030712;background:#f4f4f5">'
      + '<p>Este link de prova virtual expirou.</p></body>');
  }
  tryon.countShare(s.share.id, 'views');
  svc.logEvent(s.store.id, { type: 'share_view', productId: s.share.product_id, meta: { share: s.share.id } });
  const name = s.product?.name || 'Produto';
  const storeName = s.store.name || storeHost(s.store) || 'a loja';
  const img = `${config.appUrl}/s/${s.share.id}/image`;
  const self = `${config.appUrl}/s/${s.share.id}`;
  const canGo = Boolean(productUrl(s.store, s.product));
  const brand = tryon.brandFor(s.store);
  // "Estilo da loja": cores, cantos e fonte do tema da loja (valores já validados)
  const look = storeStyle.publicStyle(s.store);
  res.type('html').send(`<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(name)} · prova virtual</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(name)}">
<meta property="og:description" content="Olha como ficou em mim. Disponível em ${esc(storeName)}.">
<meta property="og:image" content="${esc(img)}">
<meta property="og:url" content="${esc(self)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/brand/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<style>
@font-face { font-family: "Rethink Sans"; font-style: normal; font-display: swap; font-weight: 400 800; src: url(/fonts/rethink-sans-latin-ext-wght-normal.woff2) format('woff2-variations'); unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; } @font-face { font-family: "Rethink Sans"; font-style: normal; font-display: swap; font-weight: 400 800; src: url(/fonts/rethink-sans-latin-wght-normal.woff2) format('woff2-variations'); unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
/* Página do link compartilhado (/s/:id) · Estilo Miaou, monocromático (o comprador pode ser de qualquer loja): Rethink Sans, cinzas neutros, botões pretos em pílula */
:root{--ink:#030712;--text:#030712;--muted:#6b7280;--border:#d4d4d8;--soft:#f4f4f5}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;font-family:var(--font-body,"Rethink Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif);background:#f4f4f5;color:var(--text);letter-spacing:-.15px;-webkit-font-smoothing:antialiased}
main{max-width:440px;margin:0 auto;padding:28px 16px 24px;display:flex;flex-direction:column;align-items:center}
.card{position:relative;width:100%;aspect-ratio:3/4;border-radius:var(--card-radius,28px);overflow:hidden;background:var(--soft);border:4px solid #fff;box-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.1);margin-bottom:22px}
.card img{width:100%;height:100%;object-fit:cover;display:block}
.ai{position:absolute;right:12px;bottom:12px;height:22px;padding:0 8px;border-radius:9999px;background:rgba(0,0,0,.5);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);color:#fff;font-size:11px;font-weight:600;display:inline-flex;align-items:center}
h1{margin:0 0 4px;font-family:var(--font-heading,inherit);font-size:24px;font-weight:700;letter-spacing:-.3px;text-align:center;color:var(--ink)}
.at{margin:0 0 22px;font-size:15px;color:var(--muted)}
.btn{width:100%;height:54px;border-radius:var(--btn-radius,9999px);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;text-decoration:none;margin-bottom:10px}
.primary{background:var(--btn-bg,#030712);color:var(--btn-fg,#fff);border:1px solid var(--btn-border,#030712)}
.primary:hover{filter:brightness(1.15)}
.secondary{height:50px;background:#fff;border:1px solid var(--border);color:var(--ink);font-size:15px}
.secondary:hover{border-color:var(--ink)}
.foot{margin-top:14px;font-size:12px;color:var(--muted);text-decoration:none}
.foot:hover{color:var(--ink)}
.foot img{height:14px;vertical-align:-3px;margin-left:2px}
</style>${look ? `${look.fontHref ? `<link rel="stylesheet" href="${esc(look.fontHref)}">` : ''}<style>:root{${storeStyle.styleVars(look)}}body{background:#fff}</style>` : ''}</head>
<body><main>
  <div class="card"><img src="/s/${esc(s.share.id)}/image" alt="Prova virtual de ${esc(name)}"><span class="ai">Gerado por IA</span></div>
  <h1>${esc(name)}</h1>
  <p class="at">Disponível em ${esc(storeName)}</p>
  ${canGo ? `<a class="btn primary" href="/s/${esc(s.share.id)}/go?provar=1">Provar em mim</a>
  <a class="btn secondary" href="/s/${esc(s.share.id)}/go">Ver produto na loja</a>` : ''}
  ${brand ? `<a class="foot" href="${esc(brand.url)}" target="_blank" rel="noopener">Provador virtual por <img src="/brand/miaou.png" alt="Miaou"></a>` : ''}
</main></body></html>`);
});

module.exports = router;
module.exports.productUrl = productUrl;
