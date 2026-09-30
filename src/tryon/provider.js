'use strict';
/**
 * Chamadas ao OpenRouter. Dois formatos:
 *  - modelos Gemini ("Nano Banana"): /chat/completions com modalities image+text;
 *  - demais (Muse, FLUX...): /images com input_references.
 * Cada chamada devolve { buffer, type, cost } ou lança um erro com .kind:
 *  'blocked'  = o modelo recusou a imagem (filtro de conteúdo);
 *  'provider' = qualquer outra falha (rede, limite, resposta sem imagem).
 */
const config = require('../config');

class ProviderError extends Error {
  constructor(message, kind = 'provider', status) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

const isChatModel = (model) => /^google\//.test(model);
const BLOCK_RE = /content (management )?policy|safety|blocked|moderation|prohibited|sexual|filtered/i;

function headers() {
  return {
    Authorization: `Bearer ${config.tryon.openrouterKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': config.appUrl,
    'X-Title': config.appName,
  };
}

async function post(path, body, signal) {
  let res;
  try {
    res = await fetch(`${config.tryon.openrouterBase}${path}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(body), signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new ProviderError('cancelado', 'aborted');
    throw new ProviderError(`rede: ${e.message}`);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* texto cru */ }
  if (!res.ok) {
    const msg = json?.error?.message || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new ProviderError(msg, BLOCK_RE.test(msg) ? 'blocked' : 'provider', res.status);
  }
  return json || {};
}

function dataUrlToBuffer(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  return { type: m[1], buffer: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3])) };
}

async function fetchImage(url, signal) {
  const inline = dataUrlToBuffer(url);
  if (inline) return inline;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ProviderError(`imagem gerada indisponível (${res.status})`);
  return { type: res.headers.get('content-type') || 'image/png', buffer: Buffer.from(await res.arrayBuffer()) };
}

/**
 * Gera a prova com um modelo.
 * @param {string} model id no OpenRouter
 * @param {{prompt:string, person:string, product:string}} input  imagens em data URL
 */
async function generate(model, { prompt, person, product }, signal) {
  if (isChatModel(model)) {
    const j = await post('/chat/completions', {
      model,
      modalities: ['image', 'text'],
      usage: { include: true },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: person } },
          { type: 'image_url', image_url: { url: product } },
        ],
      }],
    }, signal);
    const msg = j.choices?.[0]?.message || {};
    const url = msg.images?.[0]?.image_url?.url;
    if (!url) {
      const why = String(msg.content || j.choices?.[0]?.finish_reason || 'sem imagem na resposta');
      throw new ProviderError(why.slice(0, 300), BLOCK_RE.test(why) ? 'blocked' : 'provider');
    }
    const img = await fetchImage(url, signal);
    return { ...img, cost: j.usage?.cost ?? null };
  }
  const j = await post('/images', {
    model,
    prompt,
    input_references: [
      { type: 'image_url', image_url: { url: person } },
      { type: 'image_url', image_url: { url: product } },
    ],
  }, signal);
  const d = j.data?.[0];
  if (!d) throw new ProviderError('sem imagem na resposta');
  const img = d.b64_json ? { type: 'image/png', buffer: Buffer.from(d.b64_json, 'base64') } : await fetchImage(d.url, signal);
  return { ...img, cost: j.usage?.cost ?? null };
}

/** Descreve a peça da foto do produto (texto curto em JSON). */
async function describe(imageUrl, prompt, signal) {
  const j = await post('/chat/completions', {
    model: config.tryon.describeModel,
    max_tokens: 300,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: imageUrl } }] }],
  }, signal);
  const c = j.choices?.[0]?.message?.content;
  return Array.isArray(c) ? c.map((x) => x.text || '').join('') : String(c || '');
}

module.exports = { generate, describe, ProviderError, isChatModel, dataUrlToBuffer };
