#!/usr/bin/env node
'use strict';
/**
 * Copia o banco para uma pasta, com a data no nome, e apaga cópias com mais
 * de 14 dias. Pode rodar com o servidor no ar (VACUUM INTO gera uma cópia
 * consistente).
 *
 *   node scripts/backup.js /var/www/miaou.com.br/backup
 */
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../src/config');

const KEEP_DAYS = 14;
const dir = process.argv[2];
if (!dir) { console.error('Uso: node scripts/backup.js <pasta>'); process.exit(1); }
if (!fs.existsSync(config.dbPath)) { console.error(`Banco não encontrado: ${config.dbPath}`); process.exit(1); }

fs.mkdirSync(dir, { recursive: true });
const dest = path.join(dir, `provador-${new Date().toISOString().slice(0, 10)}.db`);
fs.rmSync(dest, { force: true });
const db = new DatabaseSync(config.dbPath);
db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
db.close();

const limit = Date.now() - KEEP_DAYS * 86400000;
for (const f of fs.readdirSync(dir)) {
  const file = path.join(dir, f);
  if (/^provador-\d{4}-\d{2}-\d{2}\.db$/.test(f) && fs.statSync(file).mtimeMs < limit) fs.rmSync(file);
}
console.log(`Backup: ${dest}`);
