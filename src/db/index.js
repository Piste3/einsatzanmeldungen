'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let db = null;

function open(file) {
  const target = file || config.dbFile || path.join(config.dataDir, 'einsatzplaner.sqlite');
  if (target !== ':memory:') fs.mkdirSync(path.dirname(target), { recursive: true });
  db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  return db;
}

// Neue Spalten in bestehenden Datenbanken nachtragen (CREATE TABLE IF NOT EXISTS ändert alte Tabellen nicht)
const NEW_COLUMNS = {
  users: [
    ['totp_secret', 'TEXT'], ['totp_enabled_at', 'TEXT'], ['totp_last_step', 'INTEGER'], ['recovery_codes', 'JSON'],
    ['twofa_required', 'INTEGER NOT NULL DEFAULT 0'], ['twofa_remember_days', 'INTEGER NOT NULL DEFAULT 0'],
    ['theme', "TEXT NOT NULL DEFAULT 'system'"],
  ],
};

function migrate(d) {
  for (const [table, cols] of Object.entries(NEW_COLUMNS)) {
    const existing = d.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!existing.length) continue; // Tabelle gibt es noch nicht – entsteht gleich vollständig aus schema.sql
    for (const [name, def] of cols) if (!existing.includes(name)) d.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
  // Anfragestatus «unsicher» (meldet sich noch) erlauben: SQLite kann CHECK nicht ändern -> Tabelle neu aufbauen
  const inq = d.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'inquiries'").get();
  if (inq && !inq.sql.includes("'unsicher'")) {
    d.exec('PRAGMA foreign_keys = OFF');
    try {
      d.exec('BEGIN');
      d.exec(`CREATE TABLE inquiries_neu ${inq.sql.slice(inq.sql.indexOf('(')).replace("'nicht_erreicht','whatsapp')", "'nicht_erreicht','whatsapp','unsicher')")}`);
      d.exec('INSERT INTO inquiries_neu SELECT * FROM inquiries; DROP TABLE inquiries; ALTER TABLE inquiries_neu RENAME TO inquiries; COMMIT');
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    } finally {
      d.exec('PRAGMA foreign_keys = ON');
    }
  }
}

function get() {
  if (!db) open();
  return db;
}

function close() {
  if (db) db.close();
  db = null;
}

// Kurzformen für häufige Abfragen
const one = (sql, ...params) => get().prepare(sql).get(...params);
const all = (sql, ...params) => get().prepare(sql).all(...params);
const run = (sql, ...params) => get().prepare(sql).run(...params);

let depth = 0;
// Verschachtelbare Transaktion (Savepoints)
function tx(fn) {
  const d = get();
  const name = `sp${depth}`;
  d.exec(depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${name}`);
  depth++;
  try {
    const result = fn();
    depth--;
    d.exec(depth === 0 ? 'COMMIT' : `RELEASE ${name}`);
    return result;
  } catch (err) {
    depth--;
    d.exec(depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${name}; RELEASE ${name}`);
    throw err;
  }
}

module.exports = { open, get, close, one, all, run, tx };
