'use strict';
/**
 * Recorte e colagem de volta.
 *
 * A IA de imagem sempre mexe um pouco no que não devia (rosto, pele, fundo).
 * Aqui a imagem gerada é alinhada com a foto original e só a área da troca
 * (a roupa ou a faixa dos óculos) vem da IA; o resto volta pixel a pixel da
 * foto do comprador, com borda suave para não aparecer emenda.
 *
 * Nos óculos a IA recebe só a região da cabeça (mais detalhe no rosto e menos
 * bloqueio por foto de praia/corpo inteiro).
 *
 * Caixas no formato do Gemini: [ymin, xmin, ymax, xmax] de 0 a 1000.
 */
const sharp = require('sharp');

sharp.cache(false);
sharp.concurrency(1);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

/** Caixa de 0 a 1000 → pixels. Devolve null se for inválida. */
function boxToPx(box, W, H) {
  if (!Array.isArray(box) || box.length !== 4 || !box.every(Number.isFinite)) return null;
  const [y0, x0, y1, x1] = box.map((v) => clamp(v, 0, 1000));
  if (y1 - y0 < 5 || x1 - x0 < 5) return null;
  return { x: (x0 / 1000) * W, y: (y0 / 1000) * H, w: ((x1 - x0) / 1000) * W, h: ((y1 - y0) / 1000) * H };
}

/** Foto na orientação certa, RGB, lado maior ≤ max. */
async function normalize(buffer, max = 1536) {
  const { data, info } = await sharp(buffer).rotate()
    .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
    .removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const jpeg = await sharp(data, { raw: info }).jpeg({ quality: 92 }).toBuffer();
  return { rgb: data, width: info.width, height: info.height, jpeg };
}

/**
 * Quadrado da cabeça para os óculos: ~2,2× o rosto, com cabelo e orelhas.
 * null quando o rosto já ocupa quase a foto toda (recortar não ajuda).
 */
function headCrop(face, W, H) {
  const side = Math.round(Math.min(Math.max(face.w, face.h) * 2.2, W, H));
  if (side * side > 0.6 * W * H) return null;
  const cx = face.x + face.w / 2;
  const cy = face.y + face.h * 0.45;
  const x = Math.round(clamp(cx - side / 2, 0, W - side));
  const y = Math.round(clamp(cy - side / 2, 0, H - side));
  return { x, y, w: side, h: side };
}

/** Recorte enviado à IA: entre 768 e 1024 px de lado. */
async function cropJpeg(norm, rect) {
  const side = Math.max(rect.w, rect.h);
  const target = clamp(side, 768, 1024);
  return sharp(norm.rgb, { raw: { width: norm.width, height: norm.height, channels: 3 } })
    .extract({ left: rect.x, top: rect.y, width: rect.w, height: rect.h })
    .resize(Math.round((rect.w * target) / side), Math.round((rect.h * target) / side), { kernel: 'lanczos3' })
    .jpeg({ quality: 92 }).toBuffer();
}

// ---------- máscaras (valor 0..1 por pixel, coordenadas da região) ----------

function ellipse(cx, cy, rx, ry, inner = 0.7) {
  return (x, y) => {
    const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
    return 1 - smooth(inner, 1, d);
  };
}
function rect(r, feather) {
  return (x, y) => {
    const d = Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
    return smooth(-feather / 2, feather / 2, d);
  };
}

/** Rosto (sem pescoço), para devolver o rosto original sobre a roupa nova. */
function faceMask(face, off) {
  return ellipse(face.x - off.x + face.w / 2, face.y - off.y + face.h * 0.5, face.w * 0.46, face.h * 0.5, 0.72);
}
/** Faixa dos olhos até as orelhas: onde os óculos entram. */
function glassesMask(face, eyes, off) {
  const cx = (eyes ? eyes.x + eyes.w / 2 : face.x + face.w / 2) - off.x;
  const cy = (eyes ? eyes.y + eyes.h / 2 : face.y + face.h * 0.42) - off.y;
  // óculos grandes de sol passam da sobrancelha e descem até a bochecha
  const ry = Math.max(face.h * 0.36, eyes ? eyes.h * 1.6 : 0);
  return ellipse(cx, cy, face.w * 0.86, ry, 0.6);
}


// ---------- alinhamento (escala + deslocamento) ----------
//
// A IA às vezes devolve a foto com outro enquadramento: o Muse costuma dar um
// "zoom" de 10% a 40% e recentralizar. Então a imagem gerada é registrada contra a
// original procurando escala s e deslocamento (tx, ty) tais que
//   gerada(s·x + tx, s·y + ty) ≈ original(x, y)
// nas áreas que não deviam mudar (âncora). A nota é a correlação normalizada
// (NCC, de -1 a 1): parede lisa não engana a busca, textura manda.

function grayOf(rgb, n) {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = 0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2];
  return g;
}

async function pyramidLevel(raw, rw, rh, long) {
  const k = long / Math.max(rw, rh);
  const w = Math.max(8, Math.round(rw * k));
  const h = Math.max(8, Math.round(rh * k));
  const buf = await sharp(raw, { raw: { width: rw, height: rh, channels: 3 } }).resize(w, h, { fit: 'fill' }).blur(0.8).raw().toBuffer();
  return { g: grayOf(buf, w * h), rgb: buf, w, h, k };
}

function sampleBilinear(img, w, h, x, y) {
  const x0 = Math.floor(x); const y0 = Math.floor(y);
  const fx = x - x0; const fy = y - y0;
  const i = y0 * w + x0;
  return img[i] * (1 - fx) * (1 - fy) + img[i + 1] * fx * (1 - fy) + img[i + w] * (1 - fx) * fy + img[i + w + 1] * fx * fy;
}

/** NCC ponderada entre original e gerada sob a transformação (s, tx, ty), na âncora. */
function ncc(O, G, A, w, h, s, tx, ty, totalA) {
  let sw = 0; let so = 0; let sg = 0; let soo = 0; let sgg = 0; let sog = 0;
  for (let y = 0; y < h; y++) {
    const gy = s * y + ty;
    if (gy < 0 || gy >= h - 1) continue;
    for (let x = 0; x < w; x++) {
      const a = A[y * w + x];
      if (a < 0.05) continue;
      const gx = s * x + tx;
      if (gx < 0 || gx >= w - 1) continue;
      const o = O[y * w + x];
      const g = sampleBilinear(G, w, h, gx, gy);
      sw += a; so += a * o; sg += a * g; soo += a * o * o; sgg += a * g * g; sog += a * o * g;
    }
  }
  // parte da âncora precisa estar dentro da imagem gerada (num zoom, as bordas somem)
  if (sw < totalA * 0.3 || sw < 10) return -1;
  const mo = so / sw; const mg = sg / sw;
  const vo = soo / sw - mo * mo; const vg = sgg / sw - mg * mg;
  if (vo < 4 || vg < 4) return -1;
  return (sog / sw - mo * mg) / Math.sqrt(vo * vg);
}

function searchLevel(L, anchor, cands) {
  const A = new Float32Array(L.w * L.h);
  let total = 0;
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) { const a = clamp(anchor(x / L.k, y / L.k), 0, 1); A[y * L.w + x] = a; total += a; }
  const out = [];
  for (const c of cands) {
    for (let s = c.s0; s <= c.s1 + 1e-9; s += c.ds) {
      for (let ty = c.ty0; ty <= c.ty1; ty += c.dt) {
        for (let tx = c.tx0; tx <= c.tx1; tx += c.dt) {
          const v = ncc(L.O, L.G, A, L.w, L.h, s, tx, ty, total);
          if (v > -1) out.push({ s, tx, ty, v });
        }
      }
    }
  }
  out.sort((a, b) => b.v - a.v);
  return { best: out, A, total };
}

/**
 * Registra a imagem gerada (já do tamanho da região) contra a original.
 * Devolve { s, tx, ty } em pixels da região e a nota NCC na âncora.
 */
async function register(regionRaw, genRaw, rw, rh, anchor) {
  const lv = async (long) => {
    const [o, g] = await Promise.all([pyramidLevel(regionRaw, rw, rh, long), pyramidLevel(genRaw, rw, rh, long)]);
    return { w: o.w, h: o.h, k: o.k, O: o.g, G: g.g, Orgb: o.rgb, Grgb: g.rgb };
  };
  // 1) caminho rápido: quase sempre a IA mantém o enquadramento (escala ~1)
  const L2 = await lv(128);
  const mx2 = Math.round(0.04 * L2.w); const my2 = Math.round(0.04 * L2.h);
  const quick = searchLevel(L2, anchor, [{ s0: 0.97, s1: 1.03, ds: 0.0075, dt: 1, tx0: -mx2 - 2, tx1: mx2 + 2, ty0: -my2 - 2, ty1: my2 + 2 }]);
  let b2 = quick.best[0];
  // só confia no caminho rápido com encaixe muito bom e longe da borda da busca
  const onEdge = b2 && (Math.abs(b2.s - 1) > 0.025 || b2.tx <= -mx2 - 1 || b2.tx >= mx2 + 1 || b2.ty <= -my2 - 1 || b2.ty >= my2 + 1);
  if (!b2 || b2.v < 0.96 || onEdge) {
    // 2) busca larga (64 px, escala de 0,8 a 1,6) e refino em 128 px
    const L1 = await lv(64);
    const cands = [];
    for (let sc = 0.8; sc <= 1.6 + 1e-9; sc += 0.025) {
      const spanX = (1 - sc) * L1.w; const spanY = (1 - sc) * L1.h;
      const mx = 0.2 * L1.w; const my = 0.2 * L1.h;
      cands.push({ s0: sc, s1: sc, ds: 1, dt: 1,
        tx0: Math.floor(Math.min(0, spanX) - mx), tx1: Math.ceil(Math.max(0, spanX) + mx),
        ty0: Math.floor(Math.min(0, spanY) - my), ty1: Math.ceil(Math.max(0, spanY) + my) });
    }
    const r1 = searchLevel(L1, anchor, cands);
    if (!r1.best.length && !b2) return null;
    const seeds = [];
    for (const b of r1.best) {
      if (seeds.every((x) => Math.abs(x.s - b.s) > 0.05 || Math.hypot(x.tx - b.tx, x.ty - b.ty) > 3)) seeds.push(b);
      if (seeds.length >= 4) break;
    }
    const f12 = L2.k / L1.k;
    const r2 = searchLevel(L2, anchor, seeds.map((b) => ({
      s0: b.s - 0.03, s1: b.s + 0.03, ds: 0.0075, dt: 1,
      tx0: Math.round(b.tx * f12) - 2, tx1: Math.round(b.tx * f12) + 2, ty0: Math.round(b.ty * f12) - 2, ty1: Math.round(b.ty * f12) + 2,
    })));
    if (r2.best[0] && (!b2 || r2.best[0].v > b2.v)) b2 = r2.best[0];
  }
  if (!b2) return null;
  // 3) fino: 256 px, passo de meio pixel
  const L3 = await lv(256);
  const f23 = L3.k / L2.k;
  const r3 = searchLevel(L3, anchor, [{
    s0: b2.s - 0.004, s1: b2.s + 0.004, ds: 0.002, dt: 0.5,
    tx0: b2.tx * f23 - 1, tx1: b2.tx * f23 + 1, ty0: b2.ty * f23 - 1, ty1: b2.ty * f23 + 1,
  }]);
  const b3 = r3.best[0] || { ...b2, tx: b2.tx * f23, ty: b2.ty * f23 };
  return { s: b3.s, tx: b3.tx / L3.k, ty: b3.ty / L3.k, score: b3.v, L: L3, A: r3.A };
}

/** Ganho e deslocamento de cor por canal (imagem gerada → original) na âncora, sob a transformação. */
function colorMatch(L, A, s, tx, ty) {
  const acc = [0, 1, 2].map(() => ({ so: 0, sg: 0, so2: 0, sg2: 0 }));
  let n = 0;
  const k = L.k;
  for (let y = 0; y < L.h; y++) {
    const gy = Math.round(s * y + ty * k);
    if (gy < 0 || gy >= L.h) continue;
    for (let x = 0; x < L.w; x++) {
      if (A[y * L.w + x] < 0.5) continue;
      const gx = Math.round(s * x + tx * k);
      if (gx < 0 || gx >= L.w) continue;
      const io = (y * L.w + x) * 3; const ig = (gy * L.w + gx) * 3;
      for (let c = 0; c < 3; c++) {
        const o = L.Orgb[io + c]; const g = L.Grgb[ig + c];
        acc[c].so += o; acc[c].sg += g; acc[c].so2 += o * o; acc[c].sg2 += g * g;
      }
      n++;
    }
  }
  if (n < 50) return [0, 1, 2].map(() => ({ gain: 1, bias: 0 }));
  return acc.map((c) => {
    const mo = c.so / n; const mg = c.sg / n;
    const so = Math.sqrt(Math.max(1, c.so2 / n - mo * mo)); const sg = Math.sqrt(Math.max(1, c.sg2 / n - mg * mg));
    const gain = clamp(so / sg, 0.85, 1.18);
    return { gain, bias: clamp(mo - gain * mg, -25, 25) };
  });
}

/** Deslocamento local (só translação, em px da região) que encaixa melhor uma área (rosto) sob a escala global. */
function localShift(L, mask, s, tx, ty, radiusPx) {
  const A = new Float32Array(L.w * L.h);
  let total = 0;
  for (let y = 0; y < L.h; y++) for (let x = 0; x < L.w; x++) { const a = clamp(mask(x / L.k, y / L.k), 0, 1); A[y * L.w + x] = a; total += a; }
  const r = Math.max(2, Math.round(radiusPx * L.k));
  let best = { dx: 0, dy: 0, v: ncc(L.O, L.G, A, L.w, L.h, s, tx * L.k, ty * L.k, total) };
  const atGlobal = best.v;
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      const v = ncc(L.O, L.G, A, L.w, L.h, s, tx * L.k + dx, ty * L.k + dy, total);
      if (v > best.v) best = { dx, dy, v };
    }
  }
  return { dx: best.dx / L.k, dy: best.dy / L.k, v: best.v, atGlobal };
}

/**
 * Cola a imagem gerada de volta na foto original.
 * @param {object} p
 * @param {{rgb:Buffer,width:number,height:number}} p.norm  foto original normalizada
 * @param {Buffer} p.generated  imagem que a IA devolveu
 * @param {{x,y,w,h}} p.region  área da foto que a IA recebeu
 * @param {(x,y)=>number} p.edit  máscara da troca (coordenadas da região)
 * @param {(x,y)=>number} p.anchor  onde a imagem gerada devia ser igual à original
 * @param {(x,y)=>number} [p.face]  rosto a devolver (roupas), conferido à parte
 * @param {number} [p.minScore]  nota mínima do alinhamento (NCC)
 * @param {number} [p.minCover]  fração mínima da área da troca que a imagem gerada cobre
 * @returns {Promise<{buffer,type,info}|{skipped:string}>}
 */
async function composite({ norm, generated, region, edit, anchor, face, minScore = 0.6, minCover = 0.97 }) {
  const { width: W, height: H } = norm;
  const meta = await sharp(generated).metadata();
  const arGen = meta.width / meta.height;
  const arReg = region.w / region.h;
  // proporção muito diferente: a IA recortou de outro jeito
  if (Math.abs(arGen / arReg - 1) > 0.06) return { skipped: 'proporção', arGen, arReg };

  const regionRaw = await sharp(norm.rgb, { raw: { width: W, height: H, channels: 3 } })
    .extract({ left: region.x, top: region.y, width: region.w, height: region.h }).raw().toBuffer();
  const genRaw = await sharp(generated).rotate().removeAlpha().toColourspace('srgb')
    .resize(region.w, region.h, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();

  const reg = await register(regionRaw, genRaw, region.w, region.h, anchor);
  if (!reg) return { skipped: 'alinhamento' };
  const { s, tx, ty } = reg;
  const info = { scale: Math.round(s * 1000) / 1000, shift: [Math.round(tx), Math.round(ty)], score: Math.round(reg.score * 100) / 100 };
  if (!(reg.score >= minScore)) return { skipped: 'alinhamento', ...info };

  // a área da troca precisa estar toda dentro da imagem gerada (zoom corta pés, braços...)
  let inE = 0; let totE = 0;
  const st = Math.max(1, Math.round(Math.max(region.w, region.h) / 200));
  for (let y = 0; y < region.h; y += st) {
    for (let x = 0; x < region.w; x += st) {
      const m = edit(x, y);
      if (m < 0.5) continue;
      totE++;
      const gx = s * x + tx; const gy = s * y + ty;
      if (gx >= 0 && gy >= 0 && gx <= region.w - 1 && gy <= region.h - 1) inE++;
    }
  }
  info.cover = totE ? Math.round((inE / totE) * 100) / 100 : 1;
  if (info.cover < minCover) return { skipped: 'enquadramento', ...info };

  // o rosto só volta se ele estiver no mesmo lugar (a IA pode ter mexido a cabeça)
  let faceOk = false;
  let fdx = 0; let fdy = 0;
  if (face) {
    const loc = localShift(reg.L, face, s, tx, ty, Math.max(region.w, region.h) * 0.03);
    // outro deslocamento só vale se encaixar bem melhor que o do resto da foto
    const use = loc.v > loc.atGlobal + 0.05 ? loc : { dx: 0, dy: 0, v: loc.atGlobal };
    faceOk = use.v >= 0.5;
    fdx = use.dx / s; fdy = use.dy / s;
    info.face = { shift: [Math.round(fdx), Math.round(fdy)], score: Math.round(use.v * 100) / 100, restored: faceOk };
  }
  const color = colorMatch(reg.L, reg.A, s, tx, ty);
  info.color = color.map((c) => [Math.round(c.gain * 100) / 100, Math.round(c.bias)]);

  // mistura em resolução cheia (amostragem bilinear da imagem gerada)
  const out = Buffer.from(norm.rgb);
  const lut = color.map(({ gain, bias }) => {
    const t = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) t[v] = v * gain + bias;
    return t;
  });
  const rw = region.w;
  for (let y = 0; y < region.h; y++) {
    for (let x = 0; x < rw; x++) {
      let m = edit(x, y);
      if (m <= 0.002) continue;
      const gx = s * x + tx; const gy = s * y + ty;
      if (gx < 0 || gy < 0 || gx > rw - 1.001 || gy > region.h - 1.001) continue;
      const x0 = Math.floor(gx); const y0 = Math.floor(gy); const ax = gx - x0; const ay = gy - y0;
      const i00 = (y0 * rw + x0) * 3; const i10 = i00 + 3; const i01 = i00 + rw * 3; const i11 = i01 + 3;
      const io = ((region.y + y) * W + region.x + x) * 3;
      const mf = faceOk ? face(x - fdx, y - fdy) : 0;
      let io2 = io;
      if (mf > 0.002) {
        const ox = clamp(Math.round(x - fdx), 0, rw - 1); const oy = clamp(Math.round(y - fdy), 0, region.h - 1);
        io2 = ((region.y + oy) * W + region.x + ox) * 3;
      }
      for (let c = 0; c < 3; c++) {
        const g = genRaw[i00 + c] * (1 - ax) * (1 - ay) + genRaw[i10 + c] * ax * (1 - ay) + genRaw[i01 + c] * (1 - ax) * ay + genRaw[i11 + c] * ax * ay;
        const v = norm.rgb[io + c] * (1 - m) + lut[c][Math.round(g)] * m;
        out[io + c] = Math.round(v * (1 - mf) + norm.rgb[io2 + c] * mf);
      }
    }
  }
  const buffer = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buffer, type: 'image/jpeg', info };
}

/**
 * Plano de recorte/colagem para uma prova, a partir da análise da foto.
 * @param {'garment'|'glasses'} kind
 * @param {{face?:number[], eyes?:number[], person?:number[]}|null} analysis
 */
function plan(kind, analysis, W, H) {
  const face = analysis ? boxToPx(analysis.face, W, H) : null;
  const person = analysis ? boxToPx(analysis.person, W, H) : null;
  const eyesRaw = analysis ? boxToPx(analysis.eyes, W, H) : null;
  // olhos fora do rosto = caixa errada
  const eyes = eyesRaw && face && eyesRaw.x >= face.x - face.w * 0.2 && eyesRaw.x + eyesRaw.w <= face.x + face.w * 1.2
    && eyesRaw.y >= face.y - face.h * 0.2 && eyesRaw.y + eyesRaw.h <= face.y + face.h * 0.9 ? eyesRaw : null;
  const full = { x: 0, y: 0, w: W, h: H };
  if (kind === 'glasses') {
    if (!face) return { region: full, crop: false };
    const crop = headCrop(face, W, H);
    const region = crop || full;
    const g = glassesMask(face, eyes, region);
    return {
      region, crop: Boolean(crop),
      edit: g,
      // âncora: tudo fora da faixa dos óculos devia continuar igual
      anchor: (x, y) => 1 - g(x, y),
    };
  }
  if (!face && !person) return { region: full, crop: false };
  const faceFn = face ? faceMask(face, full) : null;
  let edit = () => 1;
  let bg = () => 0;
  if (person) {
    const padX = W * 0.07;
    const padY = H * 0.04;
    const r = { x: person.x - padX, y: person.y - padY, w: person.w + 2 * padX, h: person.h + 2 * padY };
    edit = rect(r, Math.min(W, H) * 0.06);
    bg = (x, y) => 1 - rect({ x: r.x - W * 0.03, y: r.y - H * 0.03, w: r.w + W * 0.06, h: r.h + H * 0.06 }, 2)(x, y);
  }
  return {
    region: full, crop: false,
    edit, face: faceFn,
    anchor: (x, y) => Math.max(bg(x, y), faceFn ? faceFn(x, y) : 0),
  };
}

module.exports = { normalize, cropJpeg, composite, plan, boxToPx, headCrop };
