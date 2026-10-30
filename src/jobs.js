'use strict';
// Hintergrundaufgaben: Formular-Worker, Aufräumen, tägliche Sicherung
const submissions = require('./services/submissions');
const sessions = require('./auth/sessions');
const throttle = require('./auth/throttle');
const backup = require('./services/backup');
const live = require('./lib/live');

const timers = [];

function safe(name, fn) {
  return () => {
    try { fn(); } catch (err) { console.error(`Hintergrundaufgabe «${name}» fehlgeschlagen:`, err); }
  };
}

function start() {
  // Liegengebliebene Eingänge (z. B. nach Neustart) verarbeiten
  safe('worker', () => submissions.processPending())();
  timers.push(setInterval(safe('worker', () => submissions.processPending()), 30 * 1000));
  // Formular-Sichtbarkeit ändert sich mit der Zeit (Schichtende) -> Seiten aktualisieren
  timers.push(setInterval(() => live.notify('form', 'cockpit'), 5 * 60 * 1000));
  timers.push(setInterval(safe('cleanup', () => {
    sessions.purgeExpired();
    require('./auth/twofa').purgeExpired();
    throttle.purgeOld();
    submissions.purgeTokens();
  }), 60 * 60 * 1000));
  safe('backup', () => backup.runBackup())();
  timers.push(setInterval(safe('backup', () => backup.runBackup()), 60 * 60 * 1000));
  for (const t of timers) t.unref();
}

function stop() {
  while (timers.length) clearInterval(timers.pop());
}

module.exports = { start, stop };
