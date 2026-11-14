'use strict';
// Update und Neustart aus der Verwaltung (System): Sicherung, git pull, ggf. npm ci, Browser-App bauen, dann Neustart.
// Läuft im Serverprozess selbst; den Neustart übernimmt der Starter (src/launcher.js).
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const config = require('../config');
const backup = require('./backup');
const db = require('../db');
const audit = require('./audit');
const { localNow } = require('../lib/dates');

const APP_DIR = path.join(__dirname, '..', '..');
const LOG_FILE = path.join(config.dataDir, 'update.log');
const isWin = process.platform === 'win32';

// Zustand des laufenden bzw. letzten Updates (überlebt den Neustart über die Logdatei)
const state = { running: false, step: null, ok: null, lines: [], restarting: false };

function canRestart() {
  return process.env.KKB_LAUNCHER === '1';
}

function log(line) {
  const text = `[${localNow().slice(11)}] ${line}`;
  state.lines.push(text);
  if (state.lines.length > 400) state.lines.splice(0, state.lines.length - 400);
  try { fs.appendFileSync(LOG_FILE, `${text}\n`); } catch { /* Protokoll ist nur Hilfe */ }
}

// Befehl ausführen, Ausgabe ins Protokoll; gibt { code, out } zurück
function run(cmd, args, { quiet = false, cwd = APP_DIR, env = {} } = {}) {
  return new Promise((resolve) => {
    // git darf das Projekt auch unter einem anderen Windows-Konto (z. B. SYSTEM bei Autostart) benutzen
    const fullArgs = cmd === 'git' ? ['-c', `safe.directory=${APP_DIR.replace(/\\/g, '/')}`, ...args] : args;
    // npm ist unter Windows eine .cmd-Datei und braucht eine Shell (Argumente sind fest, keine Benutzereingaben)
    const child = spawn(cmd, fullArgs, { cwd, shell: isWin && cmd === 'npm', windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
    let out = '';
    const onData = (d) => {
      const s = d.toString();
      out += s;
      if (!quiet) for (const l of s.split(/\r?\n/)) if (l.trim()) log(`  ${l.trimEnd()}`);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => resolve({ code: -1, out: err.message }));
    child.on('close', (code) => resolve({ code, out: out.trim() }));
  });
}

async function currentVersion() {
  const r = await run('git', ['log', '-1', '--format=%h|%cI|%s'], { quiet: true });
  if (r.code !== 0) return null;
  const [hash, date, subject] = r.out.split('|');
  return { hash, date, subject };
}

// Nachsehen, ob es auf GitHub Neues gibt (ohne etwas zu ändern)
async function check() {
  const fetch = await run('git', ['fetch', '--quiet', 'origin', 'main'], { quiet: true });
  if (fetch.code !== 0) return { error: `Verbindung zu GitHub fehlgeschlagen: ${fetch.out || `Code ${fetch.code}`}` };
  const r = await run('git', ['log', '--format=%h|%cI|%s', 'HEAD..origin/main'], { quiet: true });
  const commits = r.out ? r.out.split('\n').map((l) => { const [hash, date, subject] = l.split('|'); return { hash, date, subject }; }) : [];
  return { commits };
}

async function status() {
  let lastLog = state.lines;
  if (!state.running && !lastLog.length && fs.existsSync(LOG_FILE)) {
    lastLog = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').slice(-60);
  }
  return { running: state.running, step: state.step, ok: state.ok, restarting: state.restarting, lines: lastLog, canRestart: canRestart() };
}

function restart(user, reason = 'Neustart') {
  if (!canRestart()) throw new Error('Der Server wurde nicht über den Starter gestartet – Neustart aus der Verwaltung ist nicht möglich.');
  state.restarting = true;
  log(`${reason}: Server wird neu gestartet …`);
  audit.log({ entity: 'settings', action: 'restart', summary: `${user.display_name} hat den Server neu gestartet`, user });
  // Der Starter (launcher.js) startet den Server nach Exit-Code 75 neu
  setTimeout(() => process.emit('kkb:restart'), 300);
}

async function update(user) {
  if (state.running) throw new Error('Es läuft bereits ein Update.');
  if (!canRestart()) throw new Error('Der Server wurde nicht über den Starter gestartet – bitte einmal update.cmd auf dem Server ausführen.');
  Object.assign(state, { running: true, ok: null, lines: [], restarting: false });
  try { fs.writeFileSync(LOG_FILE, ''); } catch { /* egal */ }
  log(`Update gestartet von ${user.display_name}`);
  audit.log({ entity: 'settings', action: 'update', summary: `${user.display_name} hat ein Update gestartet`, user });
  const fail = (msg) => { log(`FEHLER: ${msg}`); Object.assign(state, { running: false, ok: false, step: null }); return false; };
  try {
    state.step = 'Prüfen';
    const dirty = await run('git', ['status', '--porcelain', '--untracked-files=no'], { quiet: true });
    if (dirty.code !== 0) return fail(`git ist nicht verfügbar oder der Ordner ist kein git-Projekt (${dirty.out}).`);
    if (dirty.out) return fail(`Es gibt lokale Änderungen am Code, Update abgebrochen:\n${dirty.out}`);

    state.step = 'Sichern';
    log('1/5 Datenbank sichern …');
    const file = path.join(backup.backupDir(), `einsatzplaner-${localNow().replace('T', '-').replace(':', '')}-vor-update.sqlite`);
    fs.mkdirSync(backup.backupDir(), { recursive: true });
    db.get().exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    log(`  ${file}`);

    state.step = 'Herunterladen';
    log('2/5 Neueste Version holen …');
    const before = (await run('git', ['rev-parse', 'HEAD'], { quiet: true })).out;
    const lockBefore = (await run('git', ['rev-parse', 'HEAD:package-lock.json'], { quiet: true })).out;
    const frontLockBefore = (await run('git', ['rev-parse', 'HEAD:frontend/package-lock.json'], { quiet: true })).out;
    const pull = await run('git', ['pull', '--ff-only', 'origin', 'main']);
    if (pull.code !== 0) return fail('git pull fehlgeschlagen.');
    const after = (await run('git', ['rev-parse', 'HEAD'], { quiet: true })).out;
    if (before === after) {
      log('Bereits auf dem neuesten Stand – kein Neustart nötig.');
      Object.assign(state, { running: false, ok: true, step: null });
      return true;
    }
    await run('git', ['log', '--format=  %h %s', `${before}..${after}`]);

    state.step = 'Abhängigkeiten';
    const lockAfter = (await run('git', ['rev-parse', 'HEAD:package-lock.json'], { quiet: true })).out;
    const frontLockAfter = (await run('git', ['rev-parse', 'HEAD:frontend/package-lock.json'], { quiet: true })).out;
    const FRONT_DIR = path.join(APP_DIR, 'frontend');
    // Vite fehlt auch, wenn npm wegen NODE_ENV=production die Entwicklungs-Pakete weggelassen hat
    const frontMissing = !fs.existsSync(path.join(FRONT_DIR, 'node_modules', 'vite'));
    if (lockBefore !== lockAfter || frontLockBefore !== frontLockAfter || frontMissing) {
      log('3/5 Abhängigkeiten installieren …');
      if (lockBefore !== lockAfter) {
        const ci = await run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund']);
        if (ci.code !== 0) return fail('npm ci fehlgeschlagen. Bitte auf dem Server update.cmd ausführen.');
      }
      // Die Browser-App braucht zum Bauen auch die Entwicklungs-Pakete (Vite)
      if (frontLockBefore !== frontLockAfter || frontMissing) {
        const ci = await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: FRONT_DIR });
        if (ci.code !== 0) return fail('npm ci für die Browser-App fehlgeschlagen. Bitte auf dem Server update.cmd ausführen.');
      }
    } else log('3/5 Abhängigkeiten unverändert.');

    // Browser-App neu bauen, wenn sich ihr Code oder der geteilte Code (src/lib, public) geändert hat.
    // Der Build tauscht erst am Schluss: Schlägt er fehl, läuft die alte App weiter.
    state.step = 'Bauen';
    const changed = (await run('git', ['diff', '--name-only', before, after], { quiet: true })).out.split('\n');
    const needsBuild = !fs.existsSync(path.join(FRONT_DIR, 'dist', 'index.html')) || changed.some((f) => /^(frontend\/|src\/lib\/|public\/)/.test(f));
    if (needsBuild) {
      log('4/5 Browser-App bauen …');
      // CI=1: im Protokoll nur Warnungen und das Ergebnis, nicht jede Datei
      const b = await run('npm', ['run', 'build'], { cwd: FRONT_DIR, env: { CI: '1' } });
      if (b.code !== 0) return fail('Bauen der Browser-App fehlgeschlagen. Die bisherige Browser-App läuft weiter. Bitte auf dem Server update.cmd ausführen.');
    } else log('4/5 Browser-App unverändert.');

    state.step = 'Neustart';
    log('5/5 Neustart …');
    Object.assign(state, { running: false, ok: true });
    restart(user, 'Update fertig');
    return true;
  } catch (err) {
    return fail(err.message);
  }
}

// Nach einem Neustart im Protokoll vermerken, dass der Server wieder läuft
function markStarted() {
  try {
    if (fs.existsSync(LOG_FILE) && Date.now() - fs.statSync(LOG_FILE).mtimeMs < 5 * 60000) {
      fs.appendFileSync(LOG_FILE, `[${localNow().slice(11)}] Server läuft wieder.\n`);
    }
  } catch { /* egal */ }
}

module.exports = { markStarted, update, restart, check, status, currentVersion, canRestart };
