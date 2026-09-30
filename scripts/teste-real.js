#!/usr/bin/env node
'use strict';
/**
 * Teste real do provador com as suas fotos (usa a OPENROUTER_API_KEY e custa no OpenRouter).
 *
 *   npm run teste-real -- --produto peca.jpg pessoa1.jpg pessoa2.jpg
 *   npm run teste-real -- --oculos --produto oculos.jpg rosto1.jpg rosto2.jpg
 *
 * Roda o mesmo caminho da loja: descrição da peça, análise da foto (rosto, olhos,
 * corpo), recorte da cabeça nos óculos, o modelo principal com a reserva e a
 * colagem de volta. Para cada foto grava em teste-real/ um quadro
 * "foto original · imagem da IA · resultado final" e mostra os tempos.
 */
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_PATH = ':memory:';
const config = require('../src/config');
const sharp = require('sharp');
const provider = require('../src/tryon/provider');
const prompts = require('../src/tryon/prompt');
const image = require('../src/tryon/image');

const args = process.argv.slice(2);
const glasses = args.includes('--oculos');
const pi = args.indexOf('--produto');
const productFile = pi >= 0 ? args[pi + 1] : null;
const people = args.filter((a, i) => !a.startsWith('--') && i !== pi + 1);

if (!config.tryon.openrouterKey) {
  console.error('Defina OPENROUTER_API_KEY (no .env ou na linha de comando).');
  process.exit(1);
}
if (!productFile || !people.length) {
  console.error('Uso: npm run teste-real -- [--oculos] --produto <foto do produto> <foto 1> [<foto 2> ...]');
  process.exit(1);
}

const OUT = path.join(process.cwd(), 'teste-real');
fs.mkdirSync(OUT, { recursive: true });
const dataUrl = (buf, type = 'image/jpeg') => `data:${type};base64,${buf.toString('base64')}`;
const secs = (ms) => `${(ms / 1000).toFixed(1).replace('.', ',')} s`;

const NAME = { 'meta/muse-image': 'Muse', 'google/gemini-3.1-flash-image': 'Nano Banana 2' };
async function produce(input) {
  // mesmos modelos da loja: óculos começam pelo Nano Banana 2, roupas pelo Muse
  const primary = glasses ? config.tryon.glassesPrimaryModel : config.tryon.primaryModel;
  const fallback = glasses ? config.tryon.glassesFallbackModel : config.tryon.fallbackModel;
  const t = Date.now();
  try {
    const r = await provider.generate(primary, input, AbortSignal.timeout(config.tryon.timeoutMs));
    return { ...r, model: NAME[primary] || primary, ms: Date.now() - t };
  } catch (e) {
    const failed = Date.now() - t;
    console.log(`   ${NAME[primary] || primary} recusou/falhou (${e.kind}) em ${secs(failed)}: ${e.message.slice(0, 120)}`);
    const r = await provider.generate(fallback, input, AbortSignal.timeout(config.tryon.timeoutMs));
    return { ...r, model: `${NAME[fallback] || fallback} (reserva)`, ms: Date.now() - t };
  }
}

async function board(files, dest) {
  const H = 720;
  const imgs = await Promise.all(files.map((f) => sharp(f).resize({ height: H }).toBuffer()));
  const ws = await Promise.all(imgs.map(async (b) => (await sharp(b).metadata()).width));
  const W = ws.reduce((a, b) => a + b, 0) + 12 * (imgs.length - 1);
  let x = 0;
  const layers = imgs.map((input, i) => { const l = { input, left: x, top: 0 }; x += ws[i] + 12; return l; });
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(layers).jpeg({ quality: 88 }).toFile(dest);
}

async function run(personFile, product, info) {
  const name = path.basename(personFile).replace(/\.[^.]+$/, '');
  const t0 = Date.now();
  console.log(`\n· ${name}`);
  const norm = await image.normalize(fs.readFileSync(personFile), 1024);
  let t = Date.now();
  const analysis = prompts.parseAnalysis(await provider.describe(dataUrl(norm.jpeg), prompts.PERSON_PROMPT, AbortSignal.timeout(15000)));
  console.log(`   análise da foto: ${secs(Date.now() - t)}${analysis ? '' : ' (não achou rosto/corpo: segue sem colagem)'}`);
  const kind = glasses ? 'glasses' : 'garment';
  const plan = analysis ? image.plan(kind, analysis, norm.width, norm.height) : { region: null };
  let person = dataUrl(norm.jpeg);
  if (glasses && plan.crop) {
    person = dataUrl(await image.cropJpeg(norm, plan.region));
    console.log(`   recorte da cabeça: ${plan.region.w}×${plan.region.h} px`);
  }
  const type = glasses ? 'glasses' : (info.type === 'glasses' ? 'other' : info.type);
  const out = await produce({ prompt: prompts.garmentPrompt(type, info.description), person, product });
  console.log(`   ${out.model}: ${secs(out.ms)}`);
  const iaFile = path.join(OUT, `${name}-ia.png`);
  fs.writeFileSync(iaFile, out.buffer);
  let final = out.buffer;
  if (plan.edit) {
    t = Date.now();
    const r = await image.composite({ norm, generated: out.buffer, ...plan });
    if (r.buffer) {
      final = r.buffer;
      const what = glasses ? 'faixa dos óculos colada na foto inteira'
        : (r.info.face?.restored === false ? 'fundo original; rosto da IA, a cabeça mudou de lugar' : 'rosto e fundo originais');
      console.log(`   colagem: ${secs(Date.now() - t)} (${what})`);
    } else console.log(`   colagem não aplicada (${r.skipped}): entregue a imagem da IA`);
  }
  const finalFile = path.join(OUT, `${name}-final.jpg`);
  fs.writeFileSync(finalFile, final);
  const origFile = path.join(OUT, `${name}-original.jpg`);
  fs.writeFileSync(origFile, norm.jpeg);
  await board([origFile, iaFile, finalFile], path.join(OUT, `${name}-quadro.jpg`));
  console.log(`   total: ${secs(Date.now() - t0)} → teste-real/${name}-quadro.jpg`);
}

(async () => {
  const productBuf = await sharp(fs.readFileSync(productFile)).rotate().jpeg({ quality: 92 }).toBuffer();
  const product = dataUrl(productBuf);
  const t = Date.now();
  const info = prompts.parseDescription(await provider.describe(product, prompts.DESCRIBE_PROMPT))
    || { type: glasses ? 'glasses' : 'other', description: '' };
  console.log(`Peça: ${info.type} · "${info.description}" (${secs(Date.now() - t)}, feito 1× por produto)`);
  for (const p of people) {
    try { await run(p, product, info); } catch (e) { console.log(`   erro: ${e.kind || ''} ${e.message}`); }
  }
  console.log(`\nPronto. Abra a pasta ${OUT}`);
})();
