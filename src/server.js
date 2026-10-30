'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const config = require('./config');
const db = require('./db');
const live = require('./lib/live');
const auth = require('./auth');
const { createApp } = require('./app');
const seedDefaults = require('./db/defaults');
const jobs = require('./jobs');

db.open();
seedDefaults();

const app = createApp();
const server = http.createServer(app);
live.attach(server, auth.userFromRequest);

// Erster Start: noch kein Benutzer -> Einrichtungs-Link mit einmaligem Token ausgeben
const users = require('./services/users');
if (users.count() === 0) {
  app.locals.setupToken = crypto.randomBytes(16).toString('hex');
  console.log('\n================================================================');
  console.log(' Noch kein Benutzerkonto vorhanden. Ersten Admin anlegen unter:');
  console.log(` ${config.baseUrl}/setup?token=${app.locals.setupToken}`);
  console.log('================================================================\n');
}

server.listen(config.port, config.host, () => {
  console.log(`KKB-Einsatzplaner läuft auf ${config.baseUrl} (Port ${config.port})`);
  console.log(`Anmeldeformular: ${config.baseUrl}/forms/anmeldung (einbettbar auf: ${config.formFrameAncestors})`);
});
jobs.start();

function shutdown() {
  jobs.stop();
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
