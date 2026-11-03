'use strict';
// Notausgang: Server-Einstellungen aus der Verwaltung löschen, danach gilt wieder die .env.
//   npm run server:zuruecksetzen                 alle Werte
//   npm run server:zuruecksetzen -- AUTH_PROVIDERS SECURE_COOKIES   nur diese
// Danach den Einsatzplaner neu starten (neustart.cmd / neustart.sh), falls er läuft.
const db = require('../src/db');
const serverSettings = require('../src/services/server-settings');

db.open();
const keys = process.argv.slice(2).map((k) => k.trim().toUpperCase()).filter(Boolean);
const removed = serverSettings.reset(keys);
db.close();
console.log(removed.length
  ? `Zurück auf die .env gestellt: ${removed.join(', ')}\nBitte den Einsatzplaner neu starten, falls er läuft.`
  : 'In der Verwaltung waren keine (passenden) Server-Einstellungen gespeichert.');
