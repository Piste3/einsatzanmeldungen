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
// Server-Einstellungen aus der Verwaltung über die .env legen
require('./services/server-settings').applyStored();

const app = createApp();
const server = http.createServer(app);
live.attach(server, auth.userFromRequest, { topicFilter: require('./services/leaders').allowTopic });

// Erster Start: noch kein Benutzer -> Einrichtungs-Link mit einmaligem Token ausgeben
const users = require('./services/users');
if (users.count() === 0) {
  app.locals.setupToken = crypto.randomBytes(16).toString('hex');
  console.log('\n================================================================');
  console.log(' Noch kein Benutzerkonto vorhanden. Ersten Admin anlegen unter:');
  console.log(` ${config.baseUrl}/setup?token=${app.locals.setupToken}`);
  console.log('================================================================\n');
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${config.port} ist bereits belegt – läuft der Einsatzplaner schon? Mit stop.cmd / stop.sh beenden oder in der .env einen anderen PORT wählen.\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(config.port, config.host, () => {
  console.log(`KKB-Einsatzplaner läuft auf ${config.baseUrl} (Port ${config.port})`);
  require('./services/updater').markStarted();
  console.log(`Anmeldeformular: ${config.baseUrl}/forms/anmeldung (einbettbar auf: ${config.formFrameAncestors})`);
});
jobs.start();

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  jobs.stop();
  live.closeAll();
  server.close(() => {
    db.close();
    process.exit(code);
  });
  server.closeAllConnections?.();
  setTimeout(() => process.exit(code), 5000).unref();
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
// Über den Starter (launcher.js) gestartet: endet der Starter, endet auch der Server
if (process.send) process.on('disconnect', () => shutdown(0));
// Neustart (Verwaltung › System): Exit-Code 75, der Starter startet den Server danach neu
process.on('kkb:restart', () => shutdown(75));
