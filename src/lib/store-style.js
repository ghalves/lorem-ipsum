'use strict';
/**
 * Estilo da loja para o provador ("Estilo da loja" em Preferências).
 *
 * Os temas da Nuvemshop escrevem as cores, os cantos e as fontes num bloco
 * <style> do próprio HTML, com nomes padronizados (--accent-color,
 * --button-primary-background, --body-font...). O app NubeSDK não enxerga
 * esses valores (recebe só var(--...)), então o servidor lê a página inicial
 * da loja uma vez, guarda o resultado nas preferências e o lojista ajusta.
 *
 * Tudo que vem da loja passa por validação antes de ir para um CSS: cor só em
 * hexadecimal ou rgb(), canto só em px, fonte só com letras/números/espaço e
 * folha de fontes só do Google Fonts.
 */
const config = require('../config');

const MODES = ['miaou', 'loja'];
const MAX_HTML = 1.5 * 1024 * 1024;

// ---------- validação ----------

function color(v) {
  const s = String(v ?? '').trim();
  if (/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return hexNormalize(s);
  const m = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*[\d.]+)?\s*\)$/i);
  if (m && [m[1], m[2], m[3]].every((n) => Number(n) <= 255)) {
    return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
  }
  return null;
}
// #abc e #aabbccdd viram #aabbcc (a transparência do tema não vale para o botão)
function hexNormalize(s) {
  let h = s.slice(1).toLowerCase();
  if (h.length <= 4) h = h.split('').map((c) => c + c).join('');
  return '#' + h.slice(0, 6);
}
function px(v, max) {
  const m = String(v ?? '').trim().match(/^(\d+(?:\.\d+)?)(px)?$/);
  if (!m) return null;
  return Math.min(max, Math.round(Number(m[1])));
}
// nome de fonte de tema: "Zalando Sans", Roboto... (sem aspas, sem url, sem ponto e vírgula)
function fontName(v) {
  const first = String(v ?? '').split(',')[0].replace(/["']/g, '').trim();
  return /^[A-Za-z0-9 \-]{2,60}$/.test(first) ? first : null;
}
function fontHref(v) {
  const s = String(v ?? '').trim().replace(/&amp;/g, '&');
  if (!/^https:\/\/fonts\.googleapis\.com\/css2?\?[A-Za-z0-9 _+:;,|=&@.%\-]+$/.test(s)) return null;
  return s.length <= 500 ? s : null;
}

// ---------- contraste (WCAG) ----------

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** Texto legível sobre o fundo: o pedido, se tiver contraste; senão preto ou branco. */
function readableOn(bg, wanted) {
  if (wanted && contrast(bg, wanted) >= 4.5) return wanted;
  return contrast(bg, '#000000') >= contrast(bg, '#ffffff') ? '#000000' : '#ffffff';
}

// ---------- leitura do HTML da loja ----------

function cssVar(html, name) {
  const m = html.match(new RegExp(`--${name}\\s*:\\s*([^;}{]+)[;}]`));
  return m ? m[1].trim() : null;
}

/** Lê o estilo do tema a partir do HTML da página da loja. */
function parseThemeStyle(html) {
  const h = String(html || '');
  const buttonBg = color(cssVar(h, 'button-primary-background') || cssVar(h, 'button-primary-background-color'))
    || color(cssVar(h, 'accent-color'));
  // os temas citam a fonte com ou sem "https:" (//fonts...), em <link href> ou em @import url(...)
  const fontRaw = (h.match(/(?:href=|@import\s+url\()\s*["']?((?:https:)?\/\/fonts\.googleapis\.com\/css2?\?[^"')\s]+)/) || [])[1];
  const fontLink = fontRaw ? fontRaw.replace(/^\/\//, 'https://') : null;
  const out = {
    buttonBg,
    buttonFg: color(cssVar(h, 'button-primary-color') || cssVar(h, 'button-primary-foreground-color')),
    buttonRadius: px(cssVar(h, 'button-primary-border-radius'), 9999),
    radius: px(cssVar(h, 'border-radius'), 32),
    accent: color(cssVar(h, 'accent-color')),
    text: color(cssVar(h, 'main-foreground')),
    background: color(cssVar(h, 'main-background')),
    font: fontName(cssVar(h, 'body-font')),
    fontHeading: fontName(cssVar(h, 'heading-font')),
    fontHref: fontHref(fontLink),
    theme: (h.match(/\/themes?\/([a-z0-9_-]{2,40})\//i) || [])[1] || null,
  };
  out.found = Boolean(out.buttonBg || out.font || out.radius != null);
  return out;
}

/** Endereço da página da loja que o servidor lê. */
function styleSourceUrl(store) {
  if (process.env.STORE_STYLE_URL) return process.env.STORE_STYLE_URL;
  if (config.devMode && Number(store.id) === 999001) return `${config.appUrl}/dev/tema/`;
  const list = String(store.domain || '').split(',').map((d) => d.trim()).filter(Boolean);
  const host = list.find((d) => !/(lojavirtualnuvem|nuvemshop|tiendanube|mitiendanube)\./.test(d)) || list[0];
  if (!host || !/^[a-z0-9.-]+$/i.test(host)) return null;
  return `https://${host}/`;
}

/** Busca a página da loja e lê o estilo. Erros viram mensagens para o lojista. */
async function detectStoreStyle(store, { timeoutMs = 8000 } = {}) {
  const url = styleSourceUrl(store);
  if (!url) throw new Error('A loja ainda não tem um endereço cadastrado.');
  let res;
  try {
    res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'MiaouBot/1.0 (+estilo do provador virtual)', Accept: 'text/html' },
    });
  } catch {
    throw new Error('Não conseguimos abrir a página da loja agora. Tente de novo em instantes.');
  }
  if (!res.ok) throw new Error(`A página da loja respondeu com erro (${res.status}).`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_HTML) throw new Error('A página da loja é grande demais para ler.');
  const html = (await res.text()).slice(0, MAX_HTML);
  const style = parseThemeStyle(html);
  if (!style.found) throw new Error('Não encontramos as cores do tema nesta loja. Ajuste à mão abaixo.');
  return style;
}

// ---------- preferências ----------
//
// settings.tryon.look guarda duas coisas separadas:
//   detected / detectedAt  o que o Miaou leu do tema (relido sozinho, sem botão)
//   buttonBg, buttonFg, buttonRadius, cardRadius, useStoreFont
//                          ajustes do lojista; null = seguir a loja
// Assim reler o tema nunca apaga um ajuste feito à mão.

const PILL = 30;          // no painel, o fim da barra dos botões é "pílula"
const MAX_CARD = 28;
const REFRESH_MS = 12 * 3600 * 1000;

const DEFAULT_LOOK = { mode: 'miaou' };
const FALLBACK = { buttonBg: '#000000', buttonFg: '#ffffff', buttonRadius: 8, radius: 12 };

function planAllows(store) {
  const t = store?.settings?.tryon || {};
  return require('../tryon/plans').storeLookAllowed(t.plan || config.tryon.defaultPlan);
}

/** O que guardar depois de ler o tema (não mexe no modo nem nos ajustes). */
function lookFromDetected(d) {
  const { found, ...detected } = d;
  return { detected, detectedAt: new Date().toISOString() };
}

/** Releitura automática: ligou o Estilo da loja e nunca leu, ou a leitura tem mais de 12 h. */
function needsRefresh(look, now = Date.now()) {
  if (!look || look.mode !== 'loja') return false;
  return !look.detectedAt || now - Date.parse(look.detectedAt) > REFRESH_MS;
}

function intIn(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
}

/** Valida o que o painel envia; devolve { look } ou { errors }. */
function sanitizeLook(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: ['"look" inválido'] };
  const out = {};
  const errors = [];
  if ('mode' in input) {
    if (!MODES.includes(input.mode)) errors.push('Aparência: escolha Estilo Miaou ou Estilo da loja');
    else out.mode = input.mode;
  }
  for (const k of ['buttonBg', 'buttonFg']) {
    if (!(k in input)) continue;
    if (input[k] === null) { out[k] = null; continue; }
    const c = color(input[k]);
    if (!c) errors.push('Cor do botão inválida');
    else out[k] = c;
  }
  for (const [k, max, label] of [['buttonRadius', PILL, 'Border-radius dos botões'], ['cardRadius', MAX_CARD, 'Border-radius das fotos e cartões']]) {
    if (!(k in input)) continue;
    if (input[k] === null) { out[k] = null; continue; }
    const n = intIn(input[k], 0, max);
    if (n === undefined) errors.push(`${label}: de 0 a ${max}`);
    else out[k] = n;
  }
  if ('useStoreFont' in input) {
    if (typeof input.useStoreFont !== 'boolean') errors.push('"useStoreFont" deve ser verdadeiro ou falso');
    else out.useStoreFont = input.useStoreFont;
  }
  return errors.length ? { errors } : { look: out };
}

/** Valores efetivos (ajuste do lojista ou, sem ajuste, o que veio da loja). */
function effectiveLook(look) {
  const l = { ...DEFAULT_LOOK, ...(look || {}) };
  const d = l.detected || {};
  const pick = (own, fromStore, fb) => (own != null ? own : (fromStore != null ? fromStore : fb));
  const btnR = d.buttonRadius != null ? Math.min(PILL, d.buttonRadius) : null;
  return {
    mode: l.mode,
    buttonBg: color(pick(l.buttonBg, d.buttonBg, FALLBACK.buttonBg)) || FALLBACK.buttonBg,
    buttonFg: color(pick(l.buttonFg, d.buttonFg, FALLBACK.buttonFg)) || FALLBACK.buttonFg,
    buttonRadius: pick(l.buttonRadius, btnR, FALLBACK.buttonRadius),
    cardRadius: pick(l.cardRadius, d.radius != null ? Math.min(MAX_CARD, d.radius) : null, FALLBACK.radius),
    useStoreFont: l.useStoreFont !== false,
    font: fontName(d.font), fontHeading: fontName(d.fontHeading), fontHref: fontHref(d.fontHref),
    theme: d.theme || null, detectedAt: l.detectedAt || null,
    adjusted: { buttonBg: l.buttonBg != null, buttonFg: l.buttonFg != null, buttonRadius: l.buttonRadius != null, cardRadius: l.cardRadius != null },
  };
}

/**
 * Estilo que o provador e o link compartilhado aplicam. null = Estilo Miaou
 * (modo Miaou, ou plano sem o recurso). Garante contraste no botão.
 */
function publicStyle(store, { ignorePlan = false } = {}) {
  const look = store?.settings?.tryon?.look;
  if (!look || look.mode !== 'loja') return null;
  if (!ignorePlan && !planAllows(store)) return null;
  const e = effectiveLook(look);
  const font = e.useStoreFont ? e.font : null;
  return {
    buttonBg: e.buttonBg,
    buttonFg: readableOn(e.buttonBg, e.buttonFg),
    // botão muito claro some no fundo branco do provador: ganha contorno
    buttonBorder: contrast(e.buttonBg, '#ffffff') < 1.4 ? '#d1d5db' : e.buttonBg,
    buttonRadius: e.buttonRadius >= PILL ? 9999 : e.buttonRadius,
    cardRadius: e.cardRadius,
    font,
    fontHeading: font ? (e.fontHeading || font) : null,
    fontHref: font ? e.fontHref : null,
  };
}

/** Declarações CSS (variáveis) para o estilo; '' no Estilo Miaou. */
function styleVars(st) {
  if (!st) return '';
  const fam = (f) => `"${f}", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  return [
    `--btn-bg:${st.buttonBg}`, `--btn-fg:${st.buttonFg}`, `--btn-border:${st.buttonBorder}`,
    `--btn-radius:${st.buttonRadius}px`, `--card-radius:${st.cardRadius}px`,
    st.font ? `--font-body:${fam(st.font)}` : null,
    st.fontHeading ? `--font-heading:${fam(st.fontHeading)}` : null,
  ].filter(Boolean).join(';');
}

module.exports = {
  parseThemeStyle, detectStoreStyle, styleSourceUrl, sanitizeLook, publicStyle, styleVars, lookFromDetected,
  effectiveLook, needsRefresh, planAllows, contrast, readableOn, color, fontName, fontHref, PILL, MAX_CARD, DEFAULT_LOOK,
};
