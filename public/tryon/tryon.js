/* Provador virtual: tela dentro do iframe (card no celular, painel no desktop). */
(function () {
  'use strict';

  var params = new URLSearchParams(location.search);
  var STORE = params.get('store');
  var PRODUCT = params.get('product');
  var VISIT = params.get('visit') || '';
  var API = '/api/tryon/' + encodeURIComponent(STORE);
  var $ = function (id) { return document.getElementById(id); };
  var sheet = $('sheet');
  // painel lateral (desktop) ou card que sobe de baixo (celular): quem decide é a loja.
  // "modal": janela do NubeSDK no celular; a loja não arrasta o card, então sem alça,
  // e a altura vai para o SDK (autoresize) até MAXH
  var LAYOUT = params.get('layout');
  var DRAWER = LAYOUT === 'drawer';
  var MODAL = LAYOUT === 'modal';
  var MAXH = Math.max(320, Number(params.get('maxh')) || 0);
  // foto da variação escolhida na página (cor); o servidor confere se é deste produto
  var IMAGE_ID = /^\d{1,15}$/.test(params.get('imageId') || '') ? params.get('imageId') : '';
  document.documentElement.classList.toggle('drawer', DRAWER);
  document.documentElement.classList.toggle('modal', MODAL);

  // ---------- estado ----------
  var S = {
    session: null, token: null, parent: null, kind: 'garment', product: null,
    photoId: null, photoUrl: null, job: null, pendingAfterLead: null, historyItems: [],
    backTo: null,
  };

  // id aleatório do comprador (só deste navegador, sem dado pessoal)
  var SHOPPER = (function () {
    var key = 'mq_shopper';
    try {
      var v = localStorage.getItem(key);
      if (v && /^[a-z0-9-]{16,64}$/i.test(v)) return v;
      v = (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 10));
      localStorage.setItem(key, v);
      return v;
    } catch (e) { return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 16); }
  })();
  // foto guardada por tipo de prova: roupa usa corpo inteiro, óculos usa selfie do rosto
  var PHOTO_KEY = 'mq_photo_' + STORE;
  function photoKey() { return PHOTO_KEY + (S.kind === 'glasses' ? '_rosto' : ''); }
  var PHOTO_TTL = 23 * 3600 * 1000;   // o servidor apaga em 24 h

  function savedPhoto() {
    try {
      var v = JSON.parse(localStorage.getItem(photoKey()) || 'null');
      return v && v.id && Date.now() - v.t < PHOTO_TTL ? v.id : null;
    } catch (e) { return null; }
  }
  function rememberPhoto(id) { try { localStorage.setItem(photoKey(), JSON.stringify({ id: id, t: Date.now() })); } catch (e) { /* noop */ } }
  function forgetPhoto() { try { localStorage.removeItem(photoKey()); } catch (e) { /* noop */ } }

  // ---------- comunicação com a loja ----------
  function post(msg) {
    msg.source = 'mq';
    if (window.parent !== window && S.parent) window.parent.postMessage(msg, S.parent);
  }
  // NubeSDK (iframe com autoresize): a loja ajusta a altura com { type: 'resize', height }
  function postResize(h) {
    if (window.parent !== window && S.parent) window.parent.postMessage({ type: 'resize', height: h }, S.parent);
  }

  // ---------- API ----------
  function req(method, path, body, headers) {
    var h = { 'x-shopper': SHOPPER };
    if (S.token) h['x-szp-token'] = S.token;
    var init = { method: method, headers: h };
    if (body instanceof Blob) { init.body = body; h['Content-Type'] = body.type || 'image/jpeg'; }
    else if (body) { init.body = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    for (var k in headers || {}) h[k] = headers[k];
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || 'Erro'); e.status = r.status; e.code = j.code; throw e; }
        return j;
      });
    });
  }

  // ---------- telas ----------
  var BARE = { generating: 1, lead: 1, error: 1, off: 1, loading: 1 };
  function show(screen) {
    sheet.setAttribute('data-screen', screen);
    var head = $('head');
    head.classList.toggle('bare', !!BARE[screen]);
    var inResult = screen === 'result' || screen === 'history';
    $('btnBack').hidden = !inResult;
    $('headTitle').textContent = inResult ? 'Suas provas' : 'Provador virtual';
    $('headSub').textContent = screen === 'result' ? 'Resultado' : screen === 'history' ? 'Todas as provas' : 'Veja como fica em você';
    $('btnHistory').hidden = !((screen === 'start' || screen === 'saved') && S.historyItems.length);
    $('historyCount').textContent = String(S.historyItems.length);
    requestAnimationFrame(reportHeight);
  }

  // o card do celular cresce/encolhe conforme a tela (a loja ajusta o iframe)
  var FULL = { saved: 1, result: 1, history: 1 };
  function reportHeight() {
    var screen = sheet.getAttribute('data-screen');
    if (FULL[screen]) {
      if (MODAL) postResize(MAXH);
      return post({ type: 'height', value: 'full' });
    }
    var el = document.querySelector('.screen[data-for="' + screen + '"]');
    // a linha da marca (quando aparece) também entra na altura do card
    var h = ($('grab').offsetHeight || 0) + $('head').offsetHeight + (el ? el.scrollHeight : 300) + ($('brandline').offsetHeight || 0) + 8;
    if (MODAL) postResize(Math.min(MAXH, Math.max(320, Math.ceil(h))));
    post({ type: 'height', value: Math.ceil(h) });
  }
  window.addEventListener('resize', function () { requestAnimationFrame(reportHeight); });

  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function fmtPrice(p) {
    var n = Number(p);
    if (!isFinite(n) || n <= 0) return '';
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  // ---------- foto: reduz no navegador (envio mais rápido) ----------
  function loadBitmap(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return createImageBitmap(file); });
    }
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  function compress(file) {
    return loadBitmap(file).then(function (bmp) {
      var max = 1024;
      var w = bmp.width, h = bmp.height;
      var s = Math.min(1, max / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * s); c.height = Math.round(h * s);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      return new Promise(function (resolve) { c.toBlob(function (b) { resolve(b); }, 'image/jpeg', 0.86); });
    });
  }

  function onFile(input) {
    var f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type || 'image/')) return toast('Escolha uma foto');
    // a prova começa assim que a foto chega (sem passo de confirmar)
    var localUrl = URL.createObjectURL(f);
    S.photoUrl = localUrl;
    $('genPhoto').src = localUrl;
    if (S.session.needsLead) { S.pendingAfterLead = { file: f }; return showLead(); }
    startGenerating();
    compress(f).then(function (blob) {
      return req('POST', '/photo', blob);
    }).then(function (r) {
      S.photoId = r.photoId;
      rememberPhoto(r.photoId);
      return createJob();
    }).catch(fail);
  }

  // ---------- prova ----------
  function createJob() {
    return req('POST', '/jobs', { photoId: S.photoId, productId: S.product.id, imageId: IMAGE_ID || undefined, shopperId: SHOPPER, token: S.token, visitId: VISIT })
      .then(function (r) { S.job = r.job; poll(); })
      .catch(function (e) {
        if (e.code === 'lead') { S.pendingAfterLead = { retry: true }; return showLead(); }
        if (e.code === 'photo_expired') { forgetPhoto(); S.photoId = null; }
        throw e;
      });
  }

  function tryAgainWithSaved() {
    if (!S.photoId) return show('start');
    if (S.session.needsLead) { S.pendingAfterLead = { retry: true }; return showLead(); }
    startGenerating();
    createJob().catch(fail);
  }

  // Espera: progresso que corre rápido no começo e desacelera, frases por
  // etapa e dicas trocando. Quando a imagem chega, a barra fecha em 100%.
  var prog = { t0: 0, timer: null, tipTimer: null, done: false };
  var EXPECTED = 22;   // segundos típicos do modelo principal
  function phrases() {
    return S.kind === 'glasses'
      ? ['Analisando seu rosto…', 'Ajustando o óculos ao rosto…', 'Acertando reflexos e sombras…', 'Quase pronto…']
      : ['Analisando sua foto…', 'Vestindo a peça em você…', 'Ajustando caimento, luz e sombras…', 'Quase pronto…'];
  }
  function tips() {
    return S.kind === 'glasses'
      ? ['Selfie de frente, com o rosto todo, fica mais fiel', 'Se você já usa óculos, a gente troca pelo novo', 'Boa luz no rosto deixa a lente mais realista']
      : ['Foto de corpo inteiro e boa luz deixam a prova mais fiel', 'Selfie no espelho funciona muito bem', 'Roupa justa mostra melhor o caimento da peça', 'Você pode provar outras peças com a mesma foto'];
  }
  function startGenerating() {
    clearInterval(prog.timer); clearInterval(prog.tipTimer);
    prog.t0 = Date.now(); prog.done = false;
    var ph = phrases(), tp = tips(), ti = 0;
    $('genTip').textContent = tp[0];
    setProgress(0, ph[0]);
    show('generating');
    prog.timer = setInterval(function () {
      if (prog.done) return;
      var t = (Date.now() - prog.t0) / 1000;
      var p = 94 * (1 - Math.exp(-t / (EXPECTED / 2.4)));
      var phrase = p < 14 ? ph[0] : p < 50 ? ph[1] : p < 82 ? ph[2] : ph[3];
      setProgress(p, phrase);
    }, 250);
    prog.tipTimer = setInterval(function () {
      ti = (ti + 1) % tp.length;
      var el = $('genTip');
      el.style.opacity = '0';
      setTimeout(function () { el.textContent = tp[ti]; el.style.opacity = '1'; }, 300);
    }, 5500);
  }
  function setProgress(p, phrase) {
    var v = Math.max(0, Math.min(100, Math.floor(p)));
    $('genFill').style.width = v + '%';
    $('genPct').textContent = v + '%';
    $('genBar').setAttribute('aria-valuenow', String(v));
    if (phrase && $('genStatus').textContent !== phrase) $('genStatus').textContent = phrase;
  }
  function stopProgress() { prog.done = true; clearInterval(prog.timer); clearInterval(prog.tipTimer); }

  var pollTimer;
  function poll() {
    clearTimeout(pollTimer);
    if (!S.job) return;
    var elapsed = Date.now() - prog.t0;
    if (elapsed > 110000) return fail(new Error('timeout'));
    req('GET', '/jobs/' + S.job.id).then(function (r) {
      var job = r.job;
      if (job.status === 'done') return finish(job);
      if (job.status === 'error') return failJob(job.error);
      pollTimer = setTimeout(poll, elapsed < 8000 ? 1500 : 1000);
    }).catch(function () { pollTimer = setTimeout(poll, 2000); });
  }

  function imageUrl(job) { return job.image + '?shopper=' + encodeURIComponent(SHOPPER); }

  function finish(job) {
    S.job = job;
    var img = new Image();
    img.onload = function () {
      stopProgress();
      setProgress(100, 'Pronto!');
      if (job.saleToken) post({ type: 'tried', productId: job.productId, token: job.saleToken });
      setTimeout(function () {
        S.historyItems.unshift({ id: job.id, image: job.image, productId: job.productId, productName: S.product.name, productImage: S.product.image, productPrice: S.product.price, feedback: null });
        S.session.needsLead = S.session.leadCapture && !S.hasLead && countTries() >= (S.session.freeBeforeLead == null ? 1 : S.session.freeBeforeLead);
        showResult(job, S.product);
      }, 350);
    };
    img.onerror = function () { failJob('provider'); };
    img.src = imageUrl(job);
  }
  function countTries() { return S.historyItems.length; }

  function failJob(kind) {
    stopProgress();
    if (kind === 'blocked') {
      $('errTitle').textContent = 'Não conseguimos usar esta foto';
      $('errText').textContent = S.kind === 'glasses'
        ? 'Tente uma selfie de frente, só do rosto e dos ombros.'
        : 'Tente uma foto de corpo inteiro, de frente, com roupa do dia a dia.';
      $('btnRetry').hidden = true;
    } else if (kind === 'photo') {
      $('errTitle').textContent = 'Sua foto expirou';
      $('errText').textContent = 'Envie a foto de novo para provar.';
      $('btnRetry').hidden = true;
      forgetPhoto(); S.photoId = null;
    } else {
      $('errTitle').textContent = 'Não deu certo desta vez';
      $('errText').textContent = 'Tente de novo em instantes. Esta tentativa não conta.';
      $('btnRetry').hidden = !S.photoId;
    }
    show('error');
  }
  function fail(e) {
    stopProgress();
    if (e && e.code === 'lead') return;
    if (e && e.status === 403) { $('offText').textContent = 'O provador virtual não está disponível agora. Tente mais tarde.'; return show('off'); }
    if (e && (e.code === 'shopper_daily' || e.code === 'ip_daily')) {
      $('errTitle').textContent = 'Você chegou ao limite de provas de hoje';
      $('errText').textContent = 'Volte amanhã para provar mais peças.';
      $('btnRetry').hidden = true;
      return show('error');
    }
    if (e && e.status === 429) { $('errTitle').textContent = 'Muitas provas seguidas'; $('errText').textContent = 'Espere um pouco e tente de novo.'; $('btnRetry').hidden = !S.photoId; return show('error'); }
    if (e && (e.status === 413 || e.status === 415)) { $('errTitle').textContent = 'Não conseguimos ler esta foto'; $('errText').textContent = e.message; $('btnRetry').hidden = true; return show('error'); }
    failJob(e && e.code === 'photo_expired' ? 'photo' : 'provider');
  }

  // ---------- resultado ----------
  function showResult(job, product) {
    S.job = job;
    $('resultImg').src = imageUrl(job);
    $('resultImg').alt = 'Prova de ' + (product.name || 'produto');
    $('resultThumb').src = product.image || '';
    $('resultThumb').parentNode.classList.toggle('contain', S.kind === 'glasses');
    $('resultName').textContent = product.name || '';
    $('resultPrice').textContent = fmtPrice(product.price);
    paintRate(job.feedback);
    S.backTo = 'start';
    show('result');
  }
  function paintRate(v) {
    Array.prototype.forEach.call(document.querySelectorAll('.thumb-btn'), function (b) {
      b.setAttribute('aria-pressed', String(Number(b.getAttribute('data-rate')) === v));
    });
  }

  // ---------- WhatsApp ----------
  function showLead() {
    $('leadErr').hidden = true;
    show('lead');
    setTimeout(function () { $('leadPhone').focus(); }, 250);
  }
  function maskPhone(v) {
    var d = v.replace(/\D/g, '');
    if (d.length > 11 && d.indexOf('55') === 0) d = d.slice(2);   // colou com +55
    if (d.length > 11 && d.charAt(0) === '0') d = d.slice(1);      // 0 antes do DDD
    d = d.slice(0, 11);
    if (d.length <= 2) return d.length ? '(' + d : '';
    if (d.length <= 6) return '(' + d.slice(0, 2) + ') ' + d.slice(2);
    if (d.length <= 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  }
  $('leadPhone').addEventListener('input', function (e) { e.target.value = maskPhone(e.target.value); });
  $('leadForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var phone = $('leadPhone').value;
    var btn = $('leadBtn');
    btn.disabled = true;
    req('POST', '/lead', { phone: phone, productId: S.product.id, shopperId: SHOPPER, token: S.token }).then(function () {
      S.session.needsLead = false; S.hasLead = true;
      var next = S.pendingAfterLead; S.pendingAfterLead = null;
      if (next && next.file) { var fake = { files: [next.file], value: '' }; onFile(fake); }
      else tryAgainWithSaved();
    }).catch(function (err) {
      $('leadErr').textContent = err.message || 'Confira o número';
      $('leadErr').hidden = false;
      reportHeight();
    }).then(function () { btn.disabled = false; });
  });

  // ---------- ações ----------
  ['filePick', 'fileCamera', 'fileSwap', 'fileRetry'].forEach(function (id) {
    $(id).addEventListener('change', function (e) { onFile(e.target); });
  });
  $('btnTry').addEventListener('click', tryAgainWithSaved);
  $('btnRetry').addEventListener('click', tryAgainWithSaved);
  $('btnClose').addEventListener('click', function () { post({ type: 'close' }); });
  $('btnBack').addEventListener('click', function () {
    if (sheet.getAttribute('data-screen') === 'result' && S.backTo === 'history') return openHistory();
    enterStart();
  });
  $('btnHistory').addEventListener('click', openHistory);

  $('btnBuy').addEventListener('click', function () {
    req('POST', '/events', { type: 'tryon_buy', productId: S.job && S.job.productId, token: S.token, visitId: VISIT }).catch(function () {});
    post({ type: 'buy', productId: S.job && S.job.productId });
  });

  $('btnShare').addEventListener('click', function () {
    if (!S.job) return;
    var btn = $('btnShare');
    btn.disabled = true;
    req('POST', '/jobs/' + S.job.id + '/share', { shopperId: SHOPPER, token: S.token }).then(function (r) {
      var data = { title: S.product.name, text: 'Olha como ficou em mim:', url: r.url };
      if (navigator.share) {
        return navigator.share(data).catch(function (e) { if (e && e.name !== 'AbortError') return copyLink(r.url); });
      }
      return copyLink(r.url);
    }).catch(function () { toast('Não deu para compartilhar agora'); })
      .then(function () { btn.disabled = false; });
  });
  function copyLink(url) {
    var done = function () { toast('Link copiado'); };
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(url).then(done, function () { window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank', 'noopener'); });
    window.open('https://wa.me/?text=' + encodeURIComponent(url), '_blank', 'noopener');
  }

  Array.prototype.forEach.call(document.querySelectorAll('.thumb-btn'), function (b) {
    b.addEventListener('click', function () {
      if (!S.job) return;
      var v = Number(b.getAttribute('data-rate'));
      var next = S.job.feedback === v ? 0 : v;
      S.job.feedback = next || null;
      paintRate(S.job.feedback);
      req('POST', '/jobs/' + S.job.id + '/feedback', { value: next, shopperId: SHOPPER, token: S.token }).catch(function () {});
      if (next === 1) toast('Obrigado!');
    });
  });

  $('btnWipe').addEventListener('click', function () {
    req('DELETE', '/data').then(function () {
      forgetPhoto(); S.photoId = null; S.historyItems = []; S.job = null;
      try { localStorage.removeItem(PHOTO_KEY); localStorage.removeItem(PHOTO_KEY + '_rosto'); } catch (e) { /* noop */ }
      toast('Fotos apagadas');
      enterStart();
    }).catch(function () { toast('Não deu para apagar agora'); });
  });

  function openHistory() {
    var grid = $('historyGrid');
    grid.innerHTML = '';
    if (!S.historyItems.length) {
      var p = document.createElement('p'); p.className = 'empty'; p.textContent = 'Nenhuma prova ainda.'; grid.appendChild(p);
    }
    S.historyItems.forEach(function (it) {
      var b = document.createElement('button');
      b.type = 'button';
      var img = document.createElement('img'); img.alt = ''; img.src = imageUrl(it); img.loading = 'lazy';
      var s = document.createElement('span'); s.textContent = it.productName || '';
      b.appendChild(img); b.appendChild(s);
      b.addEventListener('click', function () {
        S.backTo = 'history';
        showResult(it, { id: it.productId, name: it.productName, image: it.productImage, price: it.productPrice });
        S.backTo = 'history';
      });
      grid.appendChild(b);
    });
    show('history');
  }

  // ---------- arrastar o card para baixo (celular) ----------
  (function () {
    var drag = null;
    function down(e) {
      if (DRAWER || MODAL || e.target.closest('button')) return;
      drag = { y: e.screenY, t: Date.now(), dy: 0 };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    }
    function move(e) {
      if (!drag) return;
      drag.dy = Math.max(0, e.screenY - drag.y);
      post({ type: 'drag', dy: drag.dy });
    }
    function up() {
      if (!drag) return;
      var v = drag.dy / Math.max(1, Date.now() - drag.t);
      post({ type: 'dragEnd', dy: drag.dy, v: v });
      drag = null;
    }
    [$('grab'), $('head')].forEach(function (el) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  })();

  // ---------- início ----------
  function enterStart() {
    S.photoId = savedPhoto();
    if (S.photoId) {
      $('savedImg').src = API + '/photo/' + S.photoId + '?shopper=' + encodeURIComponent(SHOPPER);
      $('savedImg').onerror = function () { forgetPhoto(); S.photoId = null; show('start'); };
      $('genPhoto').src = $('savedImg').src;
      show('saved');
    } else {
      show('start');
    }
  }

  function applyKind() {
    var glasses = S.kind === 'glasses';
    $('startSub').textContent = glasses ? 'Uma selfie de frente, com o rosto todo' : 'Envie sua foto e veja na hora';
    $('cameraLabel').textContent = glasses ? 'Tirar selfie' : 'Tirar foto';
    $('fileCamera').setAttribute('capture', glasses ? 'user' : 'environment');
    // "capture" só abre a câmera no celular; no computador os dois botões abririam
    // os arquivos, então lá fica só "Escolher foto"
    var canCapture = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    $('cameraBtn').style.display = canCapture ? '' : 'none';
    $('startThumb').classList.toggle('contain', glasses);
    document.querySelector('.cards .a').classList.toggle('contain', glasses);
  }

  function init() {
    var q = '?product=' + encodeURIComponent(PRODUCT) + '&origin=' + encodeURIComponent(params.get('origin') || '') + '&shopper=' + encodeURIComponent(SHOPPER) +
      (IMAGE_ID ? '&imageId=' + IMAGE_ID : '');
    Array.prototype.forEach.call(document.querySelectorAll('.privacy-link'), function (a) {
      a.href = '/privacidade/?store=' + encodeURIComponent(STORE);
    });
    req('GET', '/session' + q).then(function (s) {
      S.session = s; S.token = s.token; S.parent = s.parentOrigin; S.kind = s.kind === 'glasses' ? 'glasses' : 'garment';
      S.hasLead = Boolean(s.hasLead);
      S.product = s.product;
      if (s.brand && s.brand.url) { $('brandline').href = s.brand.url; $('brandline').hidden = false; }
      post({ type: 'ready' });
      applyKind();
      var img = s.product.image || params.get('image') || '';
      $('startThumbImg').src = img;
      $('genProduct').src = img;
      if (!s.available) {
        $('offText').textContent = s.reason === 'quota' ? 'O provador virtual está indisponível agora. Tente mais tarde.' : 'O provador virtual não está disponível para este produto.';
        return show('off');
      }
      return req('GET', '/history').then(function (h) { S.historyItems = h.items || []; }).catch(function () {})
        .then(enterStart);
    }).catch(function () {
      $('offText').textContent = 'Não foi possível abrir o provador agora.';
      show('off');
    });
  }
  init();
})();
