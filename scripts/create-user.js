'use strict';
// Benutzerkonto auf der Kommandozeile anlegen:
//   npm run user:create -- <benutzername> "<Anzeigename>" <admin|aufgebotsstelle> [passwort]
const db = require('../src/db');
const users = require('../src/services/users');

(async () => {
  const [username, displayName, role = 'aufgebotsstelle', password] = process.argv.slice(2);
  if (!username || !displayName) {
    console.log('Aufruf: npm run user:create -- <benutzername> "<Anzeigename>" <admin|aufgebotsstelle> [passwort]');
    process.exit(1);
  }
  db.open();
  require('../src/db/defaults')();
  try {
    const r = await users.create({ username, display_name: displayName, role, password, must_change_password: !password }, null);
    console.log(`Benutzer «${username}» angelegt (${role}).`);
    if (!password) console.log(`Startpasswort: ${r.password} (muss beim ersten Login geändert werden)`);
  } catch (err) {
    console.error(err.messages ? err.messages.join('\n') : err.message);
    process.exitCode = 1;
  } finally {
    db.close();
  }
})();
