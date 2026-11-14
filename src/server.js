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

// Browser-App fehlt (z. B. erstes Update mit dem alten Updater, der noch nicht baut): einmal installieren und bauen
function ensureFrontendBuilt() {
  const fs = require('node:fs');
  const path = require('node:path');
  const { spawnSync } = require('node:child_process');
  const dir = path.join(__dirname, '..', 'frontend');
  if (fs.existsSync(path.join(dir, 'dist', 'index.html'))) return;
  // --include=dev: Vite ist ein Entwicklungs-Paket; mit NODE_ENV=production liesse npm es sonst weg
  const npm = (args) => spawnSync('npm', args, { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32', windowsHide: true }).status === 0;
  console.log('Browser-App fehlt – wird jetzt installiert und gebaut (einmalig, ca. 1 Minute) …');
  if (!fs.existsSync(path.join(dir, 'node_modules', 'vite')) && !npm(['ci', '--include=dev', '--no-audit', '--no-fund'])) return console.error('npm ci für die Browser-App fehlgeschlagen.');
  if (!npm(['run', 'build'])) console.error('Bauen der Browser-App fehlgeschlagen. Bitte update.cmd ausführen.');
}
ensureFrontendBuilt();

db.open();
seedDefaults();
// Server-Einstellungen aus der Verwaltung über die .env legen
require('./services/server-settings').applyStored();

// Getrennter Betrieb (Starter, «npm start»): dieser Prozess ist nur das Backend auf API_PORT, nur für diesen Rechner erreichbar.
// Die Browser-App liefert frontend/server.cjs auf PORT aus und leitet Daten-Anfragen hierher weiter.
const split = process.env.KKB_ROLE === 'backend';
const port = split ? Number(process.env.API_PORT || config.port + 1) : config.port;
const host = split ? (process.env.API_HOST || '127.0.0.1') : config.host;
const app = createApp({ split });
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
    console.error(`\nPort ${port} ist bereits belegt – läuft der Einsatzplaner schon? Mit stop.cmd / stop.sh beenden oder in der .env einen anderen PORT wählen.\n`);
    process.exit(1);
  }
  throw err;
});
server.listen(port, host, () => {
  console.log(split ? `Backend läuft auf ${host}:${port} (Browser-App: ${config.baseUrl})` : `KKB-Einsatzplaner läuft auf ${config.baseUrl} (Port ${port})`);
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
// Starter bittet um sauberes Beenden (Skript backend-stop / -neustart)
process.on('message', (m) => { if (m === 'kkb:stop') shutdown(0); });
// Neustart (Verwaltung › System): Exit-Code 75, der Starter startet den Server danach neu
process.on('kkb:restart', () => shutdown(75));
