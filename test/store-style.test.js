'use strict';
/** "Estilo da loja": leitura do tema, validação do que vem de fora e contraste do botão. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const s = require('../src/lib/store-style');

const ipanema = fs.readFileSync(path.join(__dirname, 'fixtures', 'tema-ipanema.html'), 'utf8');

test('lê botão, cantos, cores e fontes do tema Ipanema (amostra real)', () => {
  const d = s.parseThemeStyle(ipanema);
  assert.equal(d.found, true);
  assert.equal(d.buttonBg, '#000000');
  assert.equal(d.buttonFg, '#ffffff');
  assert.equal(d.buttonRadius, 0);
  assert.equal(d.radius, 8);
  assert.equal(d.accent, '#49539e');
  assert.equal(d.font, 'Zalando Sans');
  assert.equal(d.fontHeading, 'Zalando Sans Expanded');
  // a página cita a fonte sem "https:" (//fonts...) e com &amp;
  assert.equal(d.fontHref, 'https://fonts.googleapis.com/css?family=Zalando+Sans+Expanded:400,700|Zalando+Sans:400,700&display=swap');
  assert.equal(d.theme, 'ipanema');
  assert.equal(s.lookFromDetected(d).detected.buttonRadius, 0);
  assert.equal(s.lookFromDetected(d).detected.found, undefined);
});

test('tema sem botão próprio usa a cor de destaque; página sem tema não é aceita', () => {
  const d = s.parseThemeStyle('<style>:root{--accent-color:#ff6600;--border-radius:14px;--body-font:Roboto, sans-serif}</style>');
  assert.equal(d.buttonBg, '#ff6600');
  assert.equal(d.font, 'Roboto');
  assert.equal(d.radius, 14);
  assert.equal(s.parseThemeStyle('<html><body>oi</body></html>').found, false);
});

test('nada perigoso passa da loja para o CSS do provador', () => {
  assert.equal(s.color('red;} body{display:none'), null);
  assert.equal(s.color('url(javascript:1)'), null);
  assert.equal(s.color('rgb(300,0,0)'), null);
  assert.equal(s.color('rgb(10, 20, 30)'), '#0a141e');
  assert.equal(s.color('#ABC'), '#aabbcc');
  assert.equal(s.fontName('Arial;}</style><script>'), null);
  assert.equal(s.fontName('"Zalando Sans", sans-serif'), 'Zalando Sans');
  assert.equal(s.fontHref('https://evil.example/css?family=X'), null);
  assert.equal(s.fontHref('https://fonts.googleapis.com/css?family=X"><script>'), null);
  const d = s.parseThemeStyle('<style>:root{--button-primary-background:expression(alert(1));--body-font:"a</style>"}</style>');
  assert.equal(d.buttonBg, null);
  assert.equal(d.font, null);
});

test('painel só muda modo, cores, cantos e uso da fonte; fonte e endereço vêm só da leitura', () => {
  assert.deepEqual(s.sanitizeLook({ mode: 'loja', buttonBg: '#FF0000', buttonRadius: 30, cardRadius: 0, useStoreFont: false, font: 'Evil', fontHref: 'https://x', detected: { buttonBg: '#000' } }).look,
    { mode: 'loja', buttonBg: '#ff0000', buttonRadius: 30, cardRadius: 0, useStoreFont: false });
  assert.deepEqual(s.sanitizeLook({ buttonBg: null, cardRadius: null }).look, { buttonBg: null, cardRadius: null }, 'null = voltar ao da loja');
  for (const bad of [{ mode: 'outro' }, { buttonBg: 'vermelho' }, { buttonRadius: 31 }, { cardRadius: -1 }, { cardRadius: 2.5 }, 'x']) {
    assert.ok(s.sanitizeLook(bad).errors, JSON.stringify(bad));
  }
});

const detected = s.lookFromDetected(s.parseThemeStyle(ipanema));
const storeWith = (look, plan = 'crescer') => ({ settings: { tryon: { plan, look: { mode: 'loja', ...detected, ...look } } } });

test('ajuste do lojista vale sobre o tema; sem ajuste, segue a loja', () => {
  const e = s.effectiveLook({ ...detected, buttonBg: '#1e3a8a', cardRadius: 16 });
  assert.equal(e.buttonBg, '#1e3a8a');
  assert.equal(e.adjusted.buttonBg, true);
  assert.equal(e.buttonFg, '#ffffff', 'da loja');
  assert.equal(e.buttonRadius, 0, 'da loja');
  assert.equal(e.cardRadius, 16);
  assert.equal(e.adjusted.buttonRadius, false);
  const st = s.publicStyle(storeWith({}));
  assert.equal(st.buttonRadius, 0);
  assert.equal(st.cardRadius, 8, 'cantos das fotos vêm do --border-radius do tema');
  assert.equal(st.font, 'Zalando Sans');
});

test('releitura: só no Estilo da loja, na primeira vez ou depois de 12 h', () => {
  assert.equal(s.needsRefresh({ mode: 'miaou' }), false);
  assert.equal(s.needsRefresh({ mode: 'loja' }), true);
  assert.equal(s.needsRefresh({ mode: 'loja', detectedAt: new Date().toISOString() }), false);
  assert.equal(s.needsRefresh({ mode: 'loja', detectedAt: new Date(Date.now() - 13 * 3600e3).toISOString() }), true);
});

test('botão sempre legível; botão branco ganha contorno; pílula; plano abaixo do Crescer não recebe estilo', () => {
  assert.equal(s.publicStyle(storeWith({ buttonBg: '#ffff00', buttonFg: '#ffffff' })).buttonFg, '#000000', 'amarelo com texto branco vira preto');
  assert.equal(s.publicStyle(storeWith({ buttonBg: '#1e3a8a', buttonFg: '#ffffff' })).buttonFg, '#ffffff');
  const white = s.publicStyle(storeWith({ buttonBg: '#ffffff', buttonFg: '#000000', buttonRadius: 30 }));
  assert.equal(white.buttonBorder, '#d1d5db');
  assert.equal(white.buttonRadius, 9999);
  assert.equal(s.publicStyle(storeWith({ useStoreFont: false })).font, null);
  assert.equal(s.publicStyle(storeWith({}, 'essencial')), null, 'Essencial: Estilo Miaou');
  assert.ok(s.publicStyle(storeWith({}, 'escalar')));
  assert.ok(s.publicStyle(storeWith({}, 'volume-4000')));
  assert.equal(s.publicStyle({ settings: { tryon: { plan: 'escalar', look: { mode: 'miaou' } } } }), null);
  assert.ok(s.contrast('#000000', '#ffffff') > 20);
});
