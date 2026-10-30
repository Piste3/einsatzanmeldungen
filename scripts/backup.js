'use strict';
// Sofortige Sicherung der Datenbank (zusätzlich zur täglichen automatischen):
//   npm run backup
// Funktioniert auch, während der Server läuft.
const fs = require('node:fs');
const path = require('node:path');
const db = require('../src/db');
const backup = require('../src/services/backup');
const { localNow } = require('../src/lib/dates');

db.open();
const dir = backup.backupDir();
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `einsatzplaner-${localNow().replace('T', '-').replace(':', '')}-manuell.sqlite`);
db.get().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
db.close();
console.log(`Sicherung erstellt: ${file}`);
