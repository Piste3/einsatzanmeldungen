'use strict';
// Gemeinsame Testumgebung: frische In-Memory-Datenbank pro Testdatei
process.env.DB_FILE = ':memory:';
process.env.AUTH_PROVIDERS = 'local';
const db = require('../src/db');

function freshDb() {
  db.close();
  db.open(':memory:');
  require('../src/db/defaults')();
  return db;
}

const system = { id: null, display_name: 'Test', role: 'admin' };

module.exports = { freshDb, system };
