'use strict';
// Starter: startet Backend und Browser-App als zwei getrennte Node-Prozesse und hält sie am Laufen.
// - Backend (src/server.js): Datenbank, Schnittstelle, Live, Hintergrundaufgaben. Port API_PORT (Standard PORT+1), nur 127.0.0.1.
// - Browser-App (frontend/server.cjs): Seiten, Skripte, Stylesheets; leitet Daten-Anfragen ans Backend. Port PORT.
// Exit-Code 75 des Backends (Update, Neustart in der Verwaltung): Backend neu starten. Die Browser-App läuft weiter
// (sie zeigt kurz «Server nicht erreichbar») und startet nur neu, wenn sich ihr eigener Code geändert hat.
// Endet die Browser-App unerwartet, startet der Starter nur sie neu. Das Backend läuft weiter.
// KKB_BETRIEB=einzeln: wie früher ein einziger Prozess (Backend liefert auch die Seiten).
//
// Einzeln steuern (Skripte frontend-*.cmd, backend-*.cmd bzw. betrieb/linux/teil.sh):
// Die Skripte legen eine Datei «<teil>-<aktion>» in DATA_DIR/steuerung ab (aktion: start, stop, neustart).
// Der Starter führt sie aus und schreibt den Stand nach DATA_DIR/status.json.
// KKB_NUR=frontend|backend: beim Start nur diesen Teil starten.
const { fork } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const RESTART_CODE = 75;
const single = process.env.KKB_BETRIEB === 'einzeln';
const PARTS = single ? ['backend'] : ['backend', 'frontend'];
const LABEL = { backend: 'Backend', frontend: 'Browser-App' };
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const CTL_DIR = path.join(DATA_DIR, 'steuerung');
const STATUS_FILE = path.join(DATA_DIR, 'status.json');

const children = {};
// Soll der Teil laufen? «stop» aus einem Skript setzt ihn auf false, dann startet der Starter ihn nicht mehr von selbst neu.
const wanted = Object.fromEntries(PARTS.map((p) => [p, !process.env.KKB_NUR || process.env.KKB_NUR === p]));
const since = {};
let stopping = false;
let restarting = false;

const FRONTEND_FILE = path.join(__dirname, '..', 'frontend', 'server.cjs');
const stamp = () => { try { return fs.statSync(FRONTEND_FILE).mtimeMs; } catch { return 0; } };
let frontendStamp = 0;

const SPECS = {
  backend: () => [path.join(__dirname, 'server.js'), { KKB_ROLE: single ? '' : 'backend' }],
  frontend: () => [FRONTEND_FILE, {}],
};

function writeStatus() {
  const parts = {};
  for (const p of PARTS) {
    const c = children[p];
    parts[p] = { label: LABEL[p], wanted: wanted[p], running: Boolean(c && c.exitCode === null), pid: c?.pid || null, since: c ? since[p] : null };
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ launcherPid: process.pid, single, updated: new Date().toISOString(), parts }, null, 2));
  } catch { /* Status ist nur Hilfe für die Skripte */ }
}

function start(name) {
  if (children[name] || !wanted[name]) return;
  const [file, env] = SPECS[name]();
  if (name === 'frontend') frontendStamp = stamp();
  const child = fork(file, process.argv.slice(2), { env: { ...process.env, KKB_LAUNCHER: '1', ...env }, stdio: 'inherit' });
  children[name] = child;
  since[name] = new Date().toISOString();
  writeStatus();
  child.on('exit', (code, signal) => {
    if (children[name] === child) delete children[name];
    writeStatus();
    if (stopping) return finish(code ?? (signal ? 1 : 0));
    if (child.kkbAfter) return child.kkbAfter();
    if (name === 'backend' && code === RESTART_CODE) return restartAll();
    if (restarting || !wanted[name]) return undefined;
    if (name === 'frontend') {
      console.log(`Browser-App beendet (Code ${code ?? signal}) – Neustart …`);
      return setTimeout(() => !stopping && start('frontend'), 1000);
    }
    // Backend unerwartet beendet: alles beenden (die Autostart-Aufgabe bzw. der Dienst startet neu)
    return stopAll(code ?? (signal ? 1 : 0));
  });
}

// Teil sauber beenden: zuerst bitten (Datenbank schliessen), nach 8 Sekunden hart
function stopChild(name, after) {
  const c = children[name];
  if (!c || c.exitCode !== null) { if (after) after(); return; }
  c.kkbAfter = after || (() => {});
  try { c.send('kkb:stop'); } catch { c.kill('SIGTERM'); }
  setTimeout(() => { if (c.exitCode === null) c.kill('SIGKILL'); }, 8000).unref();
}

function restartAll() {
  console.log('Neustart …');
  restarting = true;
  const front = children.frontend;
  const both = !single && wanted.frontend && (!front || stamp() !== frontendStamp);
  const go = () => { restarting = false; setTimeout(() => { start('backend'); if (both) start('frontend'); }, 500); };
  if (both && front && front.exitCode === null) stopChild('frontend', go); else go();
}

// Auftrag aus einem Skript
function command(name, action) {
  if (!PARTS.includes(name)) return console.log(`${name}: gibt es in dieser Betriebsart nicht (KKB_BETRIEB=einzeln).`);
  console.log(`${LABEL[name]}: ${action} (Skript)`);
  if (action === 'stop') {
    wanted[name] = false;
    stopChild(name, () => writeStatus());
  } else if (action === 'start') {
    wanted[name] = true;
    start(name);
  } else if (action === 'neustart') {
    wanted[name] = true;
    if (children[name]) stopChild(name, () => setTimeout(() => start(name), 300)); else start(name);
  }
  writeStatus();
}

function poll() {
  let files = [];
  try { files = fs.readdirSync(CTL_DIR); } catch { return; }
  for (const f of files) {
    const m = f.match(/^(frontend|backend)-(start|stop|neustart)$/);
    try { fs.unlinkSync(path.join(CTL_DIR, f)); } catch { /* schon weg */ }
    if (m) command(m[1], m[2]);
  }
}

let exitCode = 0;
function finish(code) {
  if (code && !exitCode) exitCode = code;
  if (!Object.keys(children).length) { try { fs.unlinkSync(STATUS_FILE); } catch { /* egal */ } process.exit(exitCode); }
}

function stopAll(code = 0) {
  stopping = true;
  exitCode = code;
  const list = Object.values(children).filter((c) => c.exitCode === null);
  if (!list.length) return finish(code);
  for (const c of list) { try { c.send('kkb:stop'); } catch { c.kill('SIGTERM'); } }
  setTimeout(() => { for (const c of list) if (c.exitCode === null) c.kill('SIGKILL'); process.exit(exitCode); }, 8000).unref();
  return undefined;
}
process.on('SIGTERM', () => stopAll(0));
process.on('SIGINT', () => stopAll(0));

// Alte Aufträge vom letzten Lauf nicht ausführen
try { for (const f of fs.readdirSync(CTL_DIR)) fs.unlinkSync(path.join(CTL_DIR, f)); } catch { /* Ordner fehlt */ }
fs.mkdirSync(CTL_DIR, { recursive: true });
setInterval(poll, 700);
for (const p of PARTS) start(p);
writeStatus();
