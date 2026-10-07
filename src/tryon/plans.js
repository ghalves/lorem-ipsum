'use strict';
/**
 * Planos do provador virtual. Sem teste grátis: quem quer experimentar entra no
 * plano de entrada. A cota vale por mês (horário de Brasília); acabou, o botão
 * some da vitrine até renovar, no dia do mês em que o plano foi ativado. Não há provas extras.
 *
 * Três planos e, acima do maior, o Volume: uma barra com degraus fixos (cada
 * degrau é um plano próprio, o que facilita cadastrar a cobrança depois).
 * As cotas saem de uma regra: a IA pode consumir 25%, 30% e 35% da receita
 * líquida (depois de taxas e imposto), e o preço por prova cai a cada degrau.
 */
const PLANS = [
  {
    key: 'essencial', name: 'Essencial', price: 97, quota: 150, tagline: 'Para quem está começando com o provador.',
    features: ['Provador em todas as páginas de produto', 'Qualquer tipo de peça', 'Compra direto pelo provador', 'Rastreamento de conversões', 'Captura de leads', 'Suporte por e-mail'],
  },
  {
    key: 'crescer', name: 'Crescer', price: 197, quota: 400, tagline: 'Para quem já vende e quer vender mais.', featured: true, storeLook: true,
    features: ['Tudo do Essencial', 'Quase o triplo de provas do Essencial', 'Provador com o visual da sua loja', 'Suporte prioritário'],
  },
  {
    key: 'escalar', name: 'Escalar', price: 497, quota: 1200, tagline: 'Para lojas com muitas visitas por dia.', removeBrand: true, storeLook: true,
    features: ['Tudo do Crescer', 'O triplo de provas do Crescer', 'Remover a marca Miaou', 'Suporte por WhatsApp'],
  },
];

/**
 * Degraus do Volume (barra). O preço por prova sempre cai de um degrau para o
 * outro (por isso não há degrau de 2.000: a R$ 797 ele sairia mais barato por
 * prova que o de 2.500).
 */
const VOLUME_FEATURES = ['Tudo do Escalar', 'Provas sob medida para campanhas', 'Atendimento direto com o time Miaou'];
const VOLUME = [
  { quota: 2500, price: 997 },
  { quota: 4000, price: 1497 },
  { quota: 6000, price: 1997 },
  { quota: 10000, price: 2997 },
].map((v) => ({ key: `volume-${v.quota}`, name: 'Volume', volume: true, removeBrand: true, storeLook: true, features: VOLUME_FEATURES, ...v }));

const ALL = PLANS.concat(VOLUME);

// planos de versões anteriores continuam valendo (a loja não perde o provador)
const LEGACY = { pro: 'volume-2500' };

const NONE = { key: 'none', name: 'Sem plano', price: 0, quota: 0 };

function getPlan(key) {
  const k = LEGACY[key] || key;
  return ALL.find((p) => p.key === k) || NONE;
}

function isPlan(key) { return ALL.some((p) => p.key === key); }

/** A marca Miaou aparece no provador, salvo quando o plano permite e o lojista desligou. */
function showBrand(planKey, tryonSettings) {
  return !(getPlan(planKey).removeBrand && tryonSettings && tryonSettings.showBrand === false);
}

/** "Estilo da loja" (provador com as cores, cantos e fonte do tema): do Crescer para cima. */
function storeLookAllowed(planKey) { return Boolean(getPlan(planKey).storeLook); }

/** Aviso ao lojista quando a cota do mês passa deste ponto. */
const ALERT_AT = 0.8;

module.exports = { PLANS, VOLUME, ALL, NONE, getPlan, isPlan, showBrand, storeLookAllowed, ALERT_AT };
