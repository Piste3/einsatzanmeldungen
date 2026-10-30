'use strict';
// Tägliche Datensicherung der SQLite-Datenbank (VACUUM INTO), ältere Sicherungen werden aufgeräumt
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const config = require('../config');
const { today } = require('../lib/dates');

function backupDir() {
  return config.backupDir || path.join(config.dataDir, 'backups');
}

function runBackup() {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `einsatzplaner-${today()}.sqlite`);
  if (fs.existsSync(file)) return { file, skipped: true };
  db.get().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const cutoff = Date.now() - config.backupKeepDays * 86400000;
  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);
    if (/^einsatzplaner-\d{4}-\d{2}-\d{2}\.sqlite$/.test(f) && fs.statSync(full).mtimeMs < cutoff) fs.unlinkSync(full);
  }
  return { file, skipped: false };
}

function list() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse()
    .map((f) => ({ name: f, size: fs.statSync(path.join(dir, f)).size }));
}

module.exports = { runBackup, list, backupDir };
