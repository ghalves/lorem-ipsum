'use strict';
const config = require('./config');
const { createApp } = require('./app');

config.assertProductionConfig();

createApp({ schedulePurge: true }).listen(config.port, () => {
  console.log(`${config.appName} rodando em ${config.appUrl} (porta ${config.port})${config.devMode ? ' [DEV]' : ''}`);
  if (config.devMode) console.log(`  Loja de demonstração: ${config.appUrl}/dev/`);
});
