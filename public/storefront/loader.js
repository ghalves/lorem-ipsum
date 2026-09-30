/*!
 * Miaou: script da vitrine Nuvemshop.
 * Injetado pela Script API (location: store e página de obrigado). Na página de
 * produto mostra o botão "Provar virtualmente": o provador virtual abre num
 * iframe isolado do CSS do tema (card que sobe de baixo no celular, painel
 * lateral no desktop). Na página de obrigado, informa os produtos provados para
 * o painel contar a venda.
 */
(function () {
  'use strict';
  var API = '__APP_URL__';
  if (window.__szpLoaded) return;
  window.__szpLoaded = true;

  var API_ORIGIN;
  try { API_ORIGIN = new URL(API).origin; } catch (e) { return; }
  var scriptEl = document.currentScript;

  function qs(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }
  function qsa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }

  // ---------- contexto da loja ----------
  function getStoreId() {
    var fromSrc = null;
    var src = (scriptEl && scriptEl.src) || '';
    if (!src) {
      var s = qsa('script[src*="loader"]').filter(function (x) { return x.src.indexOf('store=') > -1; })[0];
      src = s ? s.src : '';
    }
    try { fromSrc = new URL(src, location.href).searchParams.get('store'); } catch (e) { /* noop */ }
    var LS = window.LS || {};
    return fromSrc || (LS.store && LS.store.id) || null;
  }

  function getProductId() {
    var LS = window.LS || {};
    if (LS.product && LS.product.id) return String(LS.product.id);
    var el = qs('[data-product-id]');
    if (el) return el.getAttribute('data-product-id');
    var form = qs('[data-store^="product-form-"]');
    if (form) return form.getAttribute('data-store').replace('product-form-', '');
    var hidden = qs('form input[name="add_to_cart"], form input[name="product_id"]');
    if (hidden && hidden.value) return hidden.value;
    return null;
  }

  function productRoot() {
    return qs('.js-product-form') || qs('[data-store^="product-form-"]') || qs('form[action*="/comprar"]') ||
      qs('#single-product') || qs('.js-product-container') || document.body;
  }

  function api(path, opts) {
    return fetch(API + path, opts).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }
  function beacon(url, body) {
    try {
      if (!(navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' })))) {
        fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (e) { /* noop */ }
  }

  // Id de visita aleatório (só desta aba, sem dado pessoal): faz os relatórios
  // contarem pessoas, e não cliques repetidos da mesma pessoa.
  var VISIT = (function () {
    try { var v = sessionStorage.getItem('szp_visit'); if (v) return v; } catch (e) { /* noop */ }
    var id = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    try { sessionStorage.setItem('szp_visit', id); } catch (e) { /* noop */ }
    return id;
  })();
  var state = { storeId: null, productId: null, cfg: null };

  function trackTryon(type) {
    if (!state.cfg || !state.cfg.token) return;
    beacon(API + '/api/tryon/' + state.storeId + '/events',
      JSON.stringify({ type: type, productId: state.productId, token: state.cfg.token, visitId: VISIT }));
  }

  // ---------- vendas: ligar o pedido ao provador ----------
  // Produtos provados (assinados pelo servidor) ficam no navegador, só desta
  // loja, por 7 dias. Na página de "obrigado" o número do pedido vai junto com
  // essa lista; o servidor só conta a venda quando a Nuvemshop confirma o
  // pedido como pago e o produto provado está nele (em qualquer tamanho).
  var TRIED_KEY = 'szp_tried', TOKEN_KEY = 'szp_tok', WEEK = 7 * 864e5;
  function readTried() {
    try {
      var list = JSON.parse(localStorage.getItem(TRIED_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (r) { return r && Date.now() - r.t < WEEK; }) : [];
    } catch (e) { return []; }
  }
  function rememberTried(productId, token) {
    if (!productId || !token) return;
    var list = readTried().filter(function (r) { return String(r.p) !== String(productId); });
    list.push({ p: String(productId), k: String(token), t: Date.now() });
    try { localStorage.setItem(TRIED_KEY, JSON.stringify(list.slice(-20))); } catch (e) { /* noop */ }
  }
  function thankYouPage() {
    var LS = window.LS || {};
    var order = LS.order;
    if (!order || !order.id) return false;
    var tried = readTried();
    var storeId = getStoreId();
    var tok = null;
    try { tok = JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); } catch (e) { /* noop */ }
    if (tried.length && storeId && tok && String(tok.s) === String(storeId)) {
      beacon(API + '/api/storefront/' + storeId + '/conversion', JSON.stringify({
        orderId: order.id, token: tok.t,
        tried: tried.map(function (r) { return { productId: r.p, token: r.k || '' }; }),
      }));
      try { localStorage.removeItem(TRIED_KEY); } catch (e) { /* noop */ }
    }
    return true;
  }

  // ---------- estilos ----------
  // O botão herda fonte e cor do texto do tema: contorno na cor do texto, para
  // não competir com o "Comprar" e ficar bem em tema claro ou escuro.
  function injectStyles() {
    if (qs('#szp-styles')) return;
    var css = '' +
      '.szp-card{all:initial;display:block;box-sizing:border-box;font-family:inherit;color:inherit;line-height:1.4;margin:16px 0}' +
      '.szp-card *{box-sizing:border-box;font-family:inherit;color:inherit}' +
      '.szp-main{all:unset;box-sizing:border-box;cursor:pointer;display:flex;width:100%;align-items:center;justify-content:center;gap:10px;' +
        'height:48px;padding:0 20px;border-radius:9999px;box-shadow:inset 0 0 0 1.5px currentColor;font-size:15px;font-weight:500;transition:150ms cubic-bezier(.4,0,.2,1)}' +
      '.szp-main:hover{background:rgba(0,0,0,.04);background:color-mix(in srgb,currentColor 6%,transparent)}' +
      '.szp-main:focus-visible{outline:2px solid currentColor;outline-offset:2px}' +
      '.szp-main svg{width:22px;height:22px;flex:none;fill:none;transform-origin:20% 85%}' +
      // animação da varinha (a mesma da espera da prova); o lojista desliga em Preferências
      '.szp-anim svg{animation:szp-wave 1.6s ease-in-out infinite}' +
      '.szp-anim .szp-tw1{animation:szp-tw 1.8s ease-in-out infinite}' +
      '.szp-anim .szp-tw2{animation:szp-tw 1.8s ease-in-out .6s infinite}' +
      '.szp-anim .szp-tw3{animation:szp-tw 1.8s ease-in-out 1.2s infinite}' +
      '@keyframes szp-wave{0%,100%{transform:rotate(-10deg)}50%{transform:rotate(12deg)}}' +
      '@keyframes szp-tw{0%,100%{opacity:.15}40%{opacity:1}}' +
      '@media (prefers-reduced-motion:reduce){.szp-anim svg,.szp-anim path{animation:none!important}}' +
      '.szp-tryon-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(30,29,28,.38);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);opacity:0;transition:opacity 220ms cubic-bezier(.4,0,.2,1)}' +
      '.szp-tryon-ov.szp-open{opacity:1}' +
      '.szp-sheet{position:fixed;z-index:2147483001;border:0;background:#fff;box-shadow:0 -8px 32px rgba(0,0,0,.12);transition:transform 280ms cubic-bezier(.2,.8,.2,1),height 240ms cubic-bezier(.4,0,.2,1)}' +
      '@media (max-width:640px){.szp-sheet{left:0;right:0;bottom:0;width:100vw;height:72vh;max-height:calc(100% - 24px);border-radius:24px 24px 0 0;transform:translateY(105%)}.szp-sheet.szp-open{transform:translateY(0)}}' +
      '@media (min-width:641px){.szp-sheet{right:16px;top:16px;bottom:16px;width:440px;height:calc(100% - 32px);max-width:calc(100vw - 32px);border-radius:20px;box-shadow:0 8px 40px rgba(0,0,0,.14);transform:translateX(calc(100% + 32px))}.szp-sheet.szp-open{transform:translateX(0)}}';
    var stEl = document.createElement('style');
    stEl.id = 'szp-styles';
    stEl.textContent = css;
    document.head.appendChild(stEl);
  }

  // Varinha: a mesma da espera da prova (Hugeicons Free AiBeautify, Stroke Rounded, MIT · Copyright (c) 2025 Hugeicons).
  var ICON_AI = '<path d="M14 12.6483L16.3708 10.2775C16.6636 9.98469 16.81 9.83827 16.8883 9.68032C17.0372 9.3798 17.0372 9.02696 16.8883 8.72644C16.81 8.56849 16.6636 8.42207 16.3708 8.12923C16.0779 7.83638 15.9315 7.68996 15.7736 7.61169C15.473 7.46277 15.1202 7.46277 14.8197 7.61169C14.6617 7.68996 14.5153 7.83638 14.2225 8.12923L11.8517 10.5M14 12.6483L5.77754 20.8708C5.4847 21.1636 5.33827 21.31 5.18032 21.3883C4.8798 21.5372 4.52696 21.5372 4.22644 21.3883C4.06849 21.31 3.92207 21.1636 3.62923 20.8708C3.33639 20.5779 3.18996 20.4315 3.11169 20.2736C2.96277 19.973 2.96277 19.6202 3.11169 19.3197C3.18996 19.1617 3.33639 19.0153 3.62923 18.7225L11.8517 10.5M14 12.6483L11.8517 10.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"/><path class="szp-tw1" d="M19.5 2.5L19.3895 2.79873C19.2445 3.19044 19.172 3.38629 19.0292 3.52917C18.8863 3.67204 18.6904 3.74452 18.2987 3.88946L18 4L18.2987 4.11054C18.6904 4.25548 18.8863 4.32796 19.0292 4.47083C19.172 4.61371 19.2445 4.80956 19.3895 5.20127L19.5 5.5L19.6105 5.20127C19.7555 4.80956 19.828 4.61371 19.9708 4.47083C20.1137 4.32796 20.3096 4.25548 20.7013 4.11054L21 4L20.7013 3.88946C20.3096 3.74452 20.1137 3.67204 19.9708 3.52917C19.828 3.38629 19.7555 3.19044 19.6105 2.79873L19.5 2.5Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/><path class="szp-tw2" d="M19.5 12.5L19.3895 12.7987C19.2445 13.1904 19.172 13.3863 19.0292 13.5292C18.8863 13.672 18.6904 13.7445 18.2987 13.8895L18 14L18.2987 14.1105C18.6904 14.2555 18.8863 14.328 19.0292 14.4708C19.172 14.6137 19.2445 14.8096 19.3895 15.2013L19.5 15.5L19.6105 15.2013C19.7555 14.8096 19.828 14.6137 19.9708 14.4708C20.1137 14.328 20.3096 14.2555 20.7013 14.1105L21 14L20.7013 13.8895C20.3096 13.7445 20.1137 13.672 19.9708 13.5292C19.828 13.3863 19.7555 13.1904 19.6105 12.7987L19.5 12.5Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/><path class="szp-tw3" d="M10.5 2.5L10.3895 2.79873C10.2445 3.19044 10.172 3.38629 10.0292 3.52917C9.88629 3.67204 9.69044 3.74452 9.29873 3.88946L9 4L9.29873 4.11054C9.69044 4.25548 9.88629 4.32796 10.0292 4.47083C10.172 4.61371 10.2445 4.80956 10.3895 5.20127L10.5 5.5L10.6105 5.20127C10.7555 4.80956 10.828 4.61371 10.9708 4.47083C11.1137 4.32796 11.3096 4.25548 11.7013 4.11054L12 4L11.7013 3.88946C11.3096 3.74452 11.1137 3.67204 10.9708 3.52917C10.828 3.38629 10.7555 3.19044 10.6105 2.79873L10.5 2.5Z" stroke="currentColor" stroke-linejoin="round" stroke-width="1.5"/>';

  // ---------- botão na página ----------
  function findAnchor(selectors) {
    if (selectors.anchor) {
      var custom = qs(selectors.anchor);
      if (custom) return { el: custom, where: 'after' };
    }
    var root = productRoot();
    var variants = qs('.js-product-variants', root) || qs('[data-variant-group]', root) || qs('.js-product-variants-group', root);
    if (variants) return { el: variants, where: 'after' };
    var buy = qs('.js-addtocart', root) || qs('[type="submit"]', root);
    if (buy) {
      var host = buy.closest('.form-row, .row, div') || buy;
      return { el: host, where: 'before' };
    }
    return { el: root, where: 'append' };
  }

  function renderButton() {
    var cfg = state.cfg;
    var box = document.createElement('div');
    box.className = 'szp-card';
    box.setAttribute('data-szp', '');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'szp-main szp-ai' + (cfg.tryon.animate === false ? '' : ' szp-anim');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' + ICON_AI + '</svg>';
    btn.appendChild(document.createTextNode(cfg.tryon.button || 'Provar virtualmente'));
    btn.addEventListener('click', openTryon);
    box.appendChild(btn);
    var a = findAnchor(cfg.selectors || {});
    if (a.where === 'after') a.el.parentNode.insertBefore(box, a.el.nextSibling);
    else if (a.where === 'before') a.el.parentNode.insertBefore(box, a.el);
    else a.el.appendChild(box);
  }

  function productImage() {
    var og = qs('meta[property="og:image"]');
    return (og && og.content) || (state.cfg.product && state.cfg.product.image) || '';
  }

  function addToCart() {
    var root = productRoot();
    var sel = state.cfg.selectors || {};
    var btn = (sel.addToCart && qs(sel.addToCart)) ||
      qs('.js-addtocart:not(.js-addtocart-placeholder):not([disabled])', root) ||
      qs('[name="add"]', root) || qs('button[type="submit"], input[type="submit"]', root);
    if (btn) { btn.click(); return true; }
    return false;
  }

  // ---------- provador (card no celular, painel no desktop) ----------
  var tryonOv = null;
  var tryonFrame = null;
  var lastFocus = null;
  function isPhone() { return window.matchMedia('(max-width: 640px)').matches; }
  function openTryon() {
    if (tryonOv) return;
    lastFocus = document.activeElement;
    tryonOv = document.createElement('div');
    tryonOv.className = 'szp-tryon-ov';
    tryonOv.addEventListener('click', closeTryon);
    var f = document.createElement('iframe');
    f.className = 'szp-sheet';
    f.title = 'Provador virtual';
    f.setAttribute('role', 'dialog');
    f.setAttribute('aria-modal', 'true');
    f.allow = 'clipboard-write; web-share';
    var q = new URLSearchParams({
      store: state.storeId, product: state.productId, visit: VISIT, origin: location.origin, image: productImage(),
      layout: isPhone() ? 'sheet' : 'drawer',
    });
    f.src = API + '/tryon/?' + q.toString();
    tryonFrame = f;
    document.body.appendChild(tryonOv);
    document.body.appendChild(f);
    state.bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onTryonKey);
    requestAnimationFrame(function () { requestAnimationFrame(function () {
      tryonOv.classList.add('szp-open'); f.classList.add('szp-open'); f.focus();
    }); });
  }
  function closeTryon() {
    if (!tryonOv) return;
    var ov = tryonOv, f = tryonFrame;
    tryonOv = null; tryonFrame = null;
    document.removeEventListener('keydown', onTryonKey);
    ov.classList.remove('szp-open');
    f.style.transform = '';
    f.classList.remove('szp-open');
    document.body.style.overflow = state.bodyOverflow || '';
    setTimeout(function () { ov.remove(); f.remove(); }, 300);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onTryonKey(e) { if (e.key === 'Escape') closeTryon(); }

  window.addEventListener('message', function (e) {
    if (e.origin !== API_ORIGIN || !e.data || e.data.source !== 'mq' || !tryonFrame) return;
    var d = e.data;
    if (d.type === 'close') closeTryon();
    else if (d.type === 'height' && isPhone()) {
      var max = window.innerHeight - 24;
      var h = d.value === 'full' ? max : Math.min(max, Math.max(280, Number(d.value) || 0));
      tryonFrame.style.height = h + 'px';
    } else if (d.type === 'drag' && isPhone()) {
      tryonFrame.style.transition = 'none';
      tryonFrame.style.transform = 'translateY(' + Math.max(0, Number(d.dy) || 0) + 'px)';
    } else if (d.type === 'dragEnd' && isPhone()) {
      tryonFrame.style.transition = '';
      if ((Number(d.dy) || 0) > 120 || (Number(d.v) || 0) > 0.8) closeTryon();
      else tryonFrame.style.transform = '';
    } else if (d.type === 'tried') {
      rememberTried(d.productId, d.token);
    } else if (d.type === 'buy') {
      closeTryon();
      setTimeout(function () {
        var root = productRoot();
        if (!addToCart() && root && root.scrollIntoView) root.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 320);
    }
  });

  // ---------- início ----------
  function init() {
    if (thankYouPage()) return;   // página de obrigado: só informa o pedido
    state.storeId = getStoreId();
    state.productId = getProductId();
    if (!state.storeId || !state.productId) return;
    api('/api/storefront/' + state.storeId + '/config?product=' + encodeURIComponent(state.productId)).then(function (cfg) {
      if (!cfg.enabled || !cfg.tryon || !cfg.tryon.enabled || qs('[data-szp]')) return;
      state.cfg = cfg;
      try { localStorage.setItem(TOKEN_KEY, JSON.stringify({ s: state.storeId, t: cfg.token })); } catch (e) { /* noop */ }
      injectStyles();
      renderButton();
      trackTryon('tryon_view');
      // veio do link compartilhado ("Provar em mim"): abre o provador direto
      try { if (new URLSearchParams(location.search).get('provar') === '1') setTimeout(openTryon, 400); } catch (e) { /* noop */ }
    }).catch(function (err) {
      if (window.console) console.warn('[provador] indisponível:', err.message);
    });
  }

  window.MiaouProvador = { open: function () { if (state.cfg) openTryon(); } };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
