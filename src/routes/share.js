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
      + '<title>Link expirado</title><body style="font-family:system-ui;padding:40px 20px;text-align:center;color:#1e1d1c">'
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
<link rel="icon" href="/brand/miaou-mark.png">
<style>
:root{--ink:#1e1d1c;--muted:#78756f;--border:#dfdcd9;--soft:#f7f6f3}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font-family:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:440px;margin:0 auto;padding:28px 16px 24px;display:flex;flex-direction:column;align-items:center}
.card{position:relative;width:100%;aspect-ratio:3/4;border-radius:20px;overflow:hidden;background:var(--soft);box-shadow:0 8px 32px rgba(0,0,0,.08);margin-bottom:20px}
.card img{width:100%;height:100%;object-fit:cover;display:block}
.ai{position:absolute;right:12px;bottom:12px;height:22px;padding:0 8px;border-radius:9999px;background:rgba(30,29,28,.55);color:#fff;font-size:11px;font-weight:500;display:inline-flex;align-items:center}
h1{margin:0 0 4px;font-size:21px;font-weight:400;letter-spacing:-.02em;text-align:center}
.at{margin:0 0 22px;font-size:14px;color:var(--muted)}
.btn{width:100%;height:54px;border-radius:9999px;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;text-decoration:none;margin-bottom:10px}
.primary{background:var(--ink);color:#fff}
.secondary{height:50px;border:1px solid var(--border);color:var(--ink);font-size:15px}
.foot{margin-top:14px;font-size:12px;color:var(--muted);text-decoration:none}
.foot:hover{color:var(--ink)}
.foot img{height:14px;vertical-align:-3px;margin-left:2px}
</style></head>
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
