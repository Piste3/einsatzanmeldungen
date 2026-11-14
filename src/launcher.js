'use strict';
// Starter: startet Backend und Browser-App als zwei getrennte Node-Prozesse und hält sie am Laufen.
// - Backend (src/server.js): Datenbank, Schnittstelle, Live, Hintergrundaufgaben. Port API_PORT (Standard PORT+1), nur 127.0.0.1.
// - Browser-App (frontend/server.cjs): Seiten, Skripte, Stylesheets; leitet Daten-Anfragen ans Backend. Port PORT.
// Exit-Code 75 des Backends (Update, Neustart in der Verwaltung): Backend neu starten. Die Browser-App läuft weiter
// (sie zeigt kurz «Server nicht erreichbar») und startet nur neu, wenn sich ihr eigener Code geändert hat.
// Endet die Browser-App unerwartet, startet der Starter nur sie neu. Das Backend läuft weiter.
// KKB_BETRIEB=einzeln: wie früher ein einziger Prozess (Backend liefert auch die Seiten).
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RESTART_CODE = 75;
const single = process.env.KKB_BETRIEB === 'einzeln';
const children = {};
let stopping = false;
let restarting = false;

const FRONTEND_FILE = path.join(__dirname, '..', 'frontend', 'server.cjs');
const stamp = () => { try { return fs.statSync(FRONTEND_FILE).mtimeMs; } catch { return 0; } };
let frontendStamp = 0;

const SPECS = {
  backend: () => [path.join(__dirname, 'server.js'), { KKB_ROLE: single ? '' : 'backend' }],
  frontend: () => [FRONTEND_FILE, {}],
};

function start(name) {
  const [file, env] = SPECS[name]();
  if (name === 'frontend') frontendStamp = stamp();
  const child = fork(file, process.argv.slice(2), { env: { ...process.env, KKB_LAUNCHER: '1', ...env }, stdio: 'inherit' });
  children[name] = child;
  child.on('exit', (code, signal) => {
    if (children[name] === child) delete children[name];
    if (stopping) return finish(code ?? (signal ? 1 : 0));
    if (name === 'backend' && code === RESTART_CODE) return restartAll();
    if (restarting) return undefined;
    if (name === 'frontend') {
      console.log(`Browser-App beendet (Code ${code ?? signal}) – Neustart …`);
      return setTimeout(() => !stopping && start('frontend'), 1000);
    }
    // Backend unerwartet beendet: alles beenden (die Autostart-Aufgabe bzw. der Dienst startet neu)
    return stopAll(code ?? (signal ? 1 : 0));
  });
}

function restartAll() {
  console.log('Neustart …');
  restarting = true;
  const front = children.frontend;
  const both = !single && (!front || stamp() !== frontendStamp);
  const go = () => { restarting = false; setTimeout(() => { start('backend'); if (both) start('frontend'); }, 500); };
  if (both && front && front.exitCode === null) { front.once('exit', go); front.kill('SIGTERM'); } else go();
}

let exitCode = 0;
function finish(code) {
  if (code && !exitCode) exitCode = code;
  if (!Object.keys(children).length) process.exit(exitCode);
}

function stopAll(code = 0) {
  stopping = true;
  exitCode = code;
  const list = Object.values(children).filter((c) => c.exitCode === null);
  if (!list.length) process.exit(code);
  for (const c of list) c.kill('SIGTERM');
  setTimeout(() => process.exit(exitCode), 8000).unref();
}
process.on('SIGTERM', () => stopAll(0));
process.on('SIGINT', () => stopAll(0));

start('backend');
if (!single) start('frontend');
