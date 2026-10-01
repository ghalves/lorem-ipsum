'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Carrega .env simples (sem dependência externa).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const env = process.env;

const DEFAULT_SECRET = 'dev-only-secret-change-me';

const config = {
  port: Number(env.PORT || 3000),
  appUrl: (env.APP_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  appName: env.APP_NAME || 'Miaou',
  // site da Miaou (link da marca no provador) e e-mail de suporte mostrado ao lojista
  siteUrl: (env.MIAOU_SITE_URL || 'https://miaou.com.br').replace(/\/$/, ''),
  supportEmail: env.MIAOU_SUPPORT_EMAIL || 'suporte@miaou.com.br',
  devMode: env.DEV_MODE === 'true',
  dbPath: env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'provador.db'),
  sessionSecret: env.SESSION_SECRET || DEFAULT_SECRET,
  nuvemshop: {
    appId: env.NUVEMSHOP_APP_ID || '',
    clientSecret: env.NUVEMSHOP_CLIENT_SECRET || '',
    apiVersion: env.NUVEMSHOP_API_VERSION || '2025-03',
    apiBase: (env.NUVEMSHOP_API_BASE || 'https://api.tiendanube.com').replace(/\/$/, ''),
    authBase: (env.NUVEMSHOP_AUTH_BASE || 'https://www.tiendanube.com').replace(/\/$/, ''),
    /** id do script cadastrado no Portal de Parceiros (não auto-instalável) */
    scriptId: env.NUVEMSHOP_SCRIPT_ID ? Number(env.NUVEMSHOP_SCRIPT_ID) : null,
    // segundo script (mesmo arquivo): no app NubeSDK é o do checkout, que grava os
    // provados no pedido; no loader.js antigo era o da página de obrigado
    thankYouScriptId: Number(env.NUVEMSHOP_SCRIPT_ID_CHECKOUT || env.NUVEMSHOP_SCRIPT_ID_THANKYOU) || null,
    contactEmail: env.NUVEMSHOP_CONTACT_EMAIL || 'contato@example.com',
  },
  /**
   * Provador virtual (prova da peça na foto do cliente).
   * Sem chave do OpenRouter o gerador fica em modo simulado: devolve a própria
   * foto depois de alguns segundos (serve para desenvolver e testar o fluxo).
   */
  tryon: {
    openrouterKey: env.OPENROUTER_API_KEY || '',
    openrouterBase: (env.OPENROUTER_BASE || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    primaryModel: env.TRYON_PRIMARY_MODEL || 'meta/muse-image',
    fallbackModel: env.TRYON_FALLBACK_MODEL || 'google/gemini-3.1-flash-image',
    // óculos: mesma ordem das roupas (Muse primeiro, Nano Banana 2 de reserva)
    glassesPrimaryModel: env.TRYON_GLASSES_PRIMARY_MODEL || 'meta/muse-image',
    glassesFallbackModel: env.TRYON_GLASSES_FALLBACK_MODEL || 'google/gemini-3.1-flash-image',
    // modelo barato que descreve a peça uma vez por produto (vai no prompt)
    describeModel: env.TRYON_DESCRIBE_MODEL || 'google/gemini-3.1-flash-lite',
    // passou deste tempo sem resposta do principal: a reserva começa em paralelo
    hedgeAfterMs: Number(env.TRYON_HEDGE_AFTER_MS || 30000),
    timeoutMs: Number(env.TRYON_TIMEOUT_MS || 75000),
    // cola a prova de volta na foto original: só a peça (ou a faixa dos óculos)
    // vem da IA; rosto, corpo e fundo ficam da foto do comprador
    composite: env.TRYON_COMPOSITE !== 'false',
    // óculos: a IA recebe só a cabeça. Espera no máximo isso pela análise da foto
    glassesCrop: env.TRYON_GLASSES_CROP !== 'false',
    analysisWaitMs: Number(env.TRYON_ANALYSIS_WAIT_MS || 5000),
    concurrency: Number(env.TRYON_CONCURRENCY || 6),
    // diagnóstico: a vitrine e o provador mandam o que acontece na loja para o log
    debug: env.TRYON_DEBUG === 'true',
    // proteção da cota do lojista: provas por IP por dia em cada loja
    ipDailyLimit: Number(env.TRYON_IP_DAILY_LIMIT || 20),
    photoTtlHours: Number(env.TRYON_PHOTO_TTL_HOURS || 24),
    shareTtlDays: Number(env.TRYON_SHARE_TTL_DAYS || 7),
    storageDir: env.TRYON_STORAGE_DIR || path.join(__dirname, '..', 'data', 'tryon'),
    mock: env.TRYON_MOCK === 'true' || !env.OPENROUTER_API_KEY,
    mockDelayMs: Number(env.TRYON_MOCK_DELAY_MS || 4000),
    // plano das lojas novas até a cobrança da Nuvemshop estar ligada
    defaultPlan: env.TRYON_DEFAULT_PLAN || 'none',
    // o lojista pode escolher o plano pelo painel (só dev/testes: sem cobrança real)
    allowSelfPlan: env.TRYON_ALLOW_SELF_PLAN === 'true' || env.DEV_MODE === 'true',
  },
};

/**
 * Chamado pelo servidor ao subir: em produção o app não inicia sem segredo
 * próprio: com o padrão, qualquer um forjaria um token e entraria no painel
 * de qualquer loja.
 */
function assertProductionConfig() {
  if (config.devMode) return;
  const missing = [];
  if (!env.SESSION_SECRET || config.sessionSecret === DEFAULT_SECRET) missing.push('SESSION_SECRET');
  if (!config.nuvemshop.clientSecret) missing.push('NUVEMSHOP_CLIENT_SECRET');
  if (!env.NUVEMSHOP_CONTACT_EMAIL) missing.push('NUVEMSHOP_CONTACT_EMAIL');
  if (!missing.length) return;
  console.error(`[config] Defina ${missing.join(', ')} no .env antes de subir em produção.`);
  console.error('  Gere o segredo com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

config.assertProductionConfig = assertProductionConfig;

module.exports = config;
