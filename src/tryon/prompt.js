'use strict';
/**
 * Prompts da prova virtual. Seguem o formato que funcionou nos testes de
 * 29/09/2026 (guia do Nano Banana): pedido afirmativo com a descrição da peça,
 * depois "Preserve everything else..." em inglês, sem instruções negativas.
 */

const TYPES = ['dress', 'full', 'top', 'bottom', 'glasses', 'other'];

// comparação sem acentos: \b do JavaScript não entende "ó" como letra
const GLASSES_RE = /\b(oculos|armacao|eyeglass(es)?|sunglass(es)?|glasses|lentes? de sol)\b/;
const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** Tipo pelo nome do produto, enquanto a descrição automática não existe. */
function guessType(name) {
  const n = plain(name);
  if (GLASSES_RE.test(n)) return 'glasses';
  if (/\b(vestido|macacao|macaquinho|conjunto|jumpsuit|dress)\b/.test(n)) return 'dress';
  if (/\b(calca|saia|short|shorts|bermuda|legging|jeans)\b/.test(n)) return 'bottom';
  if (/\b(blusa|camisa|camiseta|regata|cropped|top|body|jaqueta|casaco|blazer|sueter|moletom|tricot|colete|kimono)\b/.test(n)) return 'top';
  return 'other';
}

const kindOfType = (type) => (type === 'glasses' ? 'glasses' : 'garment');

const PRESERVE_BODY = 'their face and facial expression, their hair, their skin tone and skin marks, their body shape and proportions, '
  + 'their pose and the position of their arms and hands, the phone in their hand and the exact part of the face it covers';
const PRESERVE_SCENE = 'the mirror, the room and every object in the background, the lighting, the camera angle, the framing and the image dimensions';

function garmentPrompt(type, description) {
  const what = description ? `: ${description}` : '';
  if (type === 'glasses') {
    return 'Using the two provided images, put the glasses shown in the second image on the face of the person in the first image'
      + `${what}. If the person is already wearing glasses, the new glasses replace them completely. `
      + 'The glasses sit naturally on the bridge of the nose and rest on the ears, scaled realistically to the width of the face, '
      + 'and the lenses, frame color and shape look exactly like the product in the second image, '
      + 'with reflections and soft shadows that match the lighting of the first photo.\n\n'
      + 'Preserve everything else in the first image exactly as it is: their face and facial expression, their eyes and gaze, '
      + 'their eyebrows, their hair, their skin tone and skin marks, their makeup, the position and angle of the head, their pose, '
      + 'their hands, the phone in their hand, their clothing, their jewelry, the background, the lighting, the camera angle, '
      + 'the framing and the image dimensions. The only change in the image is the pair of glasses.';
  }
  let replaces;
  let keep;
  if (type === 'top') {
    replaces = 'The top replaces only the current top of the person and is worn the same way as in the product photo';
    keep = 'their own pants or skirt, their belt, their shoes';
  } else if (type === 'bottom') {
    replaces = 'The piece replaces only the current pants, skirt or shorts of the person';
    keep = 'their own top, their shoes';
  } else {
    replaces = 'The garment replaces the current outfit of the person';
    keep = 'their shoes';
  }
  return 'Using the two provided images, dress the person in the first image in the garment shown in the second image'
    + `${what}. ${replaces}, and it fits their own body naturally, with realistic fabric folds, shadows and lighting that match the first photo. `
    + 'Take only the garment from the second image.\n\n'
    + `Preserve everything else in the first image exactly as it is: ${PRESERVE_BODY}, ${keep}, their jewelry, ${PRESERVE_SCENE}. `
    + 'The only change in the image is the new garment.';
}

/** Pedido ao modelo que descreve a peça (uma vez por imagem de produto). */
const DESCRIBE_PROMPT = 'This is a product photo from an online store. Identify the main product being sold and answer with JSON only, '
  + 'no markdown: {"type":"dress|full|top|bottom|glasses|other","description":"..."}. '
  + '"full" is a jumpsuit or a matching set. The description is one English sentence for an image-editing instruction: '
  + 'color, print or pattern, fabric look, neckline, sleeves or straps, length and fit (for glasses: frame shape, frame color and material, '
  + 'lens color and whether the lenses are clear, tinted, gradient or mirrored). Describe only the product, never the model wearing it.';

function parseDescription(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const type = TYPES.includes(j.type) ? j.type : 'other';
    const description = typeof j.description === 'string' ? j.description.trim().replace(/\s+/g, ' ').slice(0, 400) : '';
    return { type, description };
  } catch { return null; }
}

/**
 * Onde está o comprador na foto (para recortar e colar de volta). Caixas no
 * formato que o Gemini foi treinado para devolver: [ymin, xmin, ymax, xmax] de 0 a 1000.
 */
const PERSON_PROMPT = 'Detect the main person in this photo (the one taking the selfie or closest to the camera). '
  + 'Answer with JSON only, no markdown: {"face":[ymin,xmin,ymax,xmax],"eyes":[ymin,xmin,ymax,xmax],"person":[ymin,xmin,ymax,xmax],"people":N}. '
  + 'Coordinates are integers normalized to 0-1000. "face" is the face from the hairline to the chin and from ear to ear. '
  + '"eyes" is a tight box around both eyes and eyebrows (including any glasses the person wears). '
  + '"person" is the whole visible body of the main person, including hair, hands and anything held in the hands. '
  + '"people" is how many people are clearly visible. Use null for a box that is not visible.';

function parseAnalysis(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const box = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(Number(v))) ? b.map(Number) : null);
    const out = { face: box(j.face), eyes: box(j.eyes), person: box(j.person), people: Number(j.people) || null };
    return out.face || out.person ? out : null;
  } catch { return null; }
}

module.exports = { TYPES, guessType, kindOfType, garmentPrompt, DESCRIBE_PROMPT, parseDescription, PERSON_PROMPT, parseAnalysis };
