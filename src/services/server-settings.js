'use strict';
// Server-Einstellungen (Werte aus der .env) in der Verwaltung ändern.
// Geänderte Werte liegen in der Datenbank (settings.env) und gehen der .env vor. Ohne Eintrag gilt die .env,
// ohne .env-Eintrag der Standardwert. «Zurück auf .env» löscht den Eintrag in der Datenbank wieder.
const path = require('node:path');
const config = require('../config');
const settings = require('./settings');
const audit = require('./audit');
const db = require('../db');
const { ValidationError } = require('./errors');

const STORE_KEY = 'env';

const bool = (v) => (v ? 'true' : 'false');
// Liste (Leerzeichen oder Komma getrennt) einheitlich mit Leerzeichen schreiben
const splitJoin = (v) => String(v || '').split(/[\s,]+/).filter(Boolean).join(' ');

// Änderbare Werte. current(): aktueller Wert in der Form, wie er im Formular steht und gespeichert wird.
const FIELDS = [
  { group: 'Adresse und Sicherheit', key: 'BASE_URL', label: 'Öffentliche Adresse', type: 'url',
    current: () => config.baseUrl, placeholder: 'https://einsatz.holmium.ch',
    help: 'So ist der Einsatzplaner von aussen erreichbar. Wird für Links in Mails und im Kalender und für die Microsoft-Anmeldung gebraucht.',
    parse: (v) => {
      const s = v.trim().replace(/\/+$/, '');
      if (!/^https?:\/\/[^\s/]+(\/\S*)?$/.test(s)) throw new Error('Die öffentliche Adresse muss mit http:// oder https:// beginnen.');
      return s;
    } },
  { group: 'Adresse und Sicherheit', key: 'TRUST_PROXY', label: 'Hinter Reverse-Proxy', type: 'bool',
    current: () => bool(config.trustProxy),
    help: 'Ja, wenn ein Reverse-Proxy (Nginx Proxy Manager) davor steht. Dann stimmen Absender-Adresse und HTTPS-Erkennung.' },
  { group: 'Adresse und Sicherheit', key: 'SECURE_COOKIES', label: 'Anmeldung nur über HTTPS', type: 'bool',
    current: () => bool(config.secureCookies),
    help: 'Anmelde-Cookies werden nur über HTTPS geschickt. Nur ausschalten, wenn der Einsatzplaner ohne HTTPS läuft.' },
  { group: 'Adresse und Sicherheit', key: 'SESSION_HOURS', label: 'Anmeldung gilt höchstens', type: 'number', unit: 'Stunden', min: 1, max: 720,
    current: () => String(config.sessionHours), help: 'Danach muss man sich neu anmelden. Gilt für neue Anmeldungen.' },
  { group: 'Adresse und Sicherheit', key: 'SESSION_IDLE_MINUTES', label: 'Abmelden nach Inaktivität', type: 'number', unit: 'Minuten', min: 5, max: 10080,
    current: () => String(config.sessionIdleMinutes), help: 'Wer so lange nichts tut, wird abgemeldet.' },
  { group: 'Adresse und Sicherheit', key: 'FORM_FRAME_ANCESTORS', label: 'Formular einbetten erlaubt auf', type: 'text', wide: true,
    current: () => splitJoin(raw('FORM_FRAME_ANCESTORS') || config.DEFAULT_FRAME_ANCESTORS),
    help: 'Webseiten, die das Anmeldeformular im iFrame zeigen dürfen, mit Leerzeichen getrennt (z. B. https://web.kkb.ch https://*.web.kkb.ch).',
    parse: (v) => {
      const s = splitJoin(v);
      if (!s) throw new Error('Mindestens eine Webseite angeben, die das Formular einbetten darf.');
      return s;
    } },

  { group: 'Anmeldung', key: 'AUTH_PROVIDERS', label: 'Anmeldeverfahren', type: 'providers',
    current: () => config.authProviders.join(','),
    help: 'Passwort und/oder Microsoft. Ohne Passwort-Anmeldung kommt nur noch hinein, wer Microsoft freigegeben hat.' },
  { group: 'Anmeldung', key: 'MS_TENANT_ID', label: 'Microsoft: Tenant-ID', type: 'text',
    current: () => config.microsoft.tenantId, placeholder: 'organizations',
    help: 'Tenant-ID des Vereins oder «organizations» (Konten beliebiger Organisationen).' },
  { group: 'Anmeldung', key: 'MS_CLIENT_ID', label: 'Microsoft: Client-ID', type: 'text',
    current: () => config.microsoft.clientId, help: 'Anwendungs-ID (Client-ID) der App-Registrierung in Entra.' },
  { group: 'Anmeldung', key: 'MS_CLIENT_SECRET', label: 'Microsoft: geheimer Schlüssel', type: 'secret',
    current: () => config.microsoft.clientSecret, help: 'Der «Wert» des geheimen Clientschlüssels aus Entra.' },
  { group: 'Anmeldung', key: 'MS_SECRET_EXPIRES', label: 'Microsoft: Schlüssel läuft ab am', type: 'date',
    current: () => config.microsoft.secretExpires, help: 'Admins sehen 30 Tage vorher im Cockpit eine Erinnerung.' },
  { group: 'Anmeldung', key: 'MS_ALLOWED_TENANTS', label: 'Microsoft: nur diese Tenants', type: 'text',
    current: () => config.microsoft.allowedTenants.join(' '),
    help: 'Optional. Tenant-IDs mit Leerzeichen getrennt. Leer = Konten aus jedem Tenant (sofern freigegeben).',
    parse: (v) => splitJoin(v.toLowerCase()) },

  { group: 'E-Mail-Versand', key: 'SMTP_HOST', label: 'Mailserver (SMTP)', type: 'text',
    current: () => config.smtp.host, placeholder: 'smtp.example.ch',
    help: 'Leer = Mails bleiben im Postausgang unter «Formulare» und werden nicht verschickt.' },
  { group: 'E-Mail-Versand', key: 'SMTP_PORT', label: 'Port', type: 'number', min: 1, max: 65535,
    current: () => String(config.smtp.port), help: 'Meist 587 (STARTTLS) oder 465 (SSL).' },
  { group: 'E-Mail-Versand', key: 'SMTP_SECURE', label: 'SSL von Anfang an', type: 'bool',
    current: () => bool(config.smtp.secure), help: 'Ja bei Port 465, Nein bei Port 587.' },
  { group: 'E-Mail-Versand', key: 'SMTP_USER', label: 'Benutzername', type: 'text',
    current: () => config.smtp.user, help: 'Login beim Mailserver, meist die E-Mail-Adresse.' },
  { group: 'E-Mail-Versand', key: 'SMTP_PASS', label: 'Passwort', type: 'secret',
    current: () => config.smtp.pass, help: 'Passwort beim Mailserver.' },
  { group: 'E-Mail-Versand', key: 'SMTP_FROM', label: 'Absender', type: 'text',
    current: () => config.smtp.from, placeholder: 'KKB Aufgebot <aufgebot@kkb.ch>',
    help: 'So steht der Absender in den Mails. Leer = Benutzername.' },

  { group: 'Datensicherung', key: 'BACKUP_DIR', label: 'Ordner für Sicherungen', type: 'text',
    current: () => config.backupDir || '', placeholder: () => path.join(config.dataDir, 'backups'),
    help: 'Leer = Ordner «backups» im Datenordner. Der Ordner wird bei Bedarf angelegt.' },
  { group: 'Datensicherung', key: 'BACKUP_KEEP_DAYS', label: 'Sicherungen behalten', type: 'number', unit: 'Tage', min: 1, max: 3650,
    current: () => String(config.backupKeepDays), help: 'Ältere automatische Sicherungen werden gelöscht.' },
];

// Nur lesend: ohne diese Werte startet der Server nicht oder findet die Datenbank nicht
const READONLY = [
  { key: 'PORT', label: 'Port', current: () => String(config.port),
    reason: 'Auf diesen Port leitet der Nginx Proxy Manager weiter. Ein falscher Wert hier würde den Einsatzplaner unerreichbar machen, und du könntest ihn nicht mehr über diese Seite zurückstellen.' },
  { key: 'HOST', label: 'Netzwerk-Schnittstelle', current: () => config.host,
    reason: 'Wie beim Port: Ein falscher Wert sperrt den Zugriff von aussen. Standard 0.0.0.0 = alle Schnittstellen.' },
  { key: 'DATA_DIR', label: 'Datenordner', current: () => config.dataDir,
    reason: 'Darin liegt die Datenbank, und in der Datenbank liegen die Werte dieser Seite. Der Ordner muss deshalb vor dem Start feststehen.' },
  { key: 'DB_FILE', label: 'Datenbank-Datei', current: () => config.dbFile || path.join(config.dataDir, 'einsatzplaner.sqlite'),
    reason: 'Aus demselben Grund wie der Datenordner. Normalerweise nicht gesetzt.' },
  { key: 'NODE_ENV', label: 'Betriebsart', current: () => process.env.NODE_ENV || '',
    reason: 'Wird beim Start von Node.js gelesen. Auf dem Server immer «production».' },
];

const fieldByKey = Object.fromEntries(FIELDS.map((f) => [f.key, f]));

function stored() {
  const v = settings.get(STORE_KEY);
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

// Roher Wert: Verwaltung vor .env, sonst undefined
function raw(key) {
  const s = stored();
  if (Object.hasOwn(s, key)) return s[key];
  return process.env[key];
}

// Beim Start: gespeicherte Werte über die .env legen
function applyStored() {
  const s = stored();
  const known = Object.fromEntries(Object.entries(s).filter(([k]) => fieldByKey[k]));
  config.apply(known);
}

// Zeilen für die Verwaltung
function rows() {
  const s = stored();
  const fields = FIELDS.map((f) => {
    const inDb = Object.hasOwn(s, f.key);
    const inEnv = process.env[f.key] !== undefined && process.env[f.key] !== '';
    const value = f.current();
    return {
      ...f,
      value: f.type === 'secret' ? '' : value,
      isSet: Boolean(value),
      source: inDb ? 'verwaltung' : inEnv ? 'env' : 'standard',
      overridesEnv: inDb && inEnv,
      placeholder: typeof f.placeholder === 'function' ? f.placeholder() : f.placeholder || '',
    };
  });
  const groups = [];
  for (const f of fields) {
    let g = groups.find((x) => x.name === f.group);
    if (!g) groups.push(g = { name: f.group, fields: [] });
    g.fields.push(f);
  }
  const readonly = READONLY.map((f) => ({ ...f, value: f.current(), source: process.env[f.key] ? 'env' : 'standard' }));
  return { groups, readonly };
}

// Eingabe in die gespeicherte Form bringen (wirft Error mit verständlicher Meldung)
function normalize(f, input) {
  if (f.type === 'providers') {
    const list = (Array.isArray(input) ? input : input ? [input] : []).map(String).filter((p) => ['local', 'microsoft'].includes(p));
    if (!list.length) throw new Error('Mindestens ein Anmeldeverfahren muss eingeschaltet bleiben.');
    return ['local', 'microsoft'].filter((p) => list.includes(p)).join(',');
  }
  const v = String(Array.isArray(input) ? input.at(-1) : input ?? '');
  if (f.type === 'bool') return v === 'true' ? 'true' : 'false';
  if (f.type === 'number') {
    const s = v.trim();
    if (!/^\d+$/.test(s) || Number(s) < f.min || Number(s) > f.max) throw new Error(`«${f.label}»: bitte eine Zahl von ${f.min} bis ${f.max}.`);
    return String(Number(s));
  }
  if (f.type === 'date') {
    const s = v.trim();
    if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`«${f.label}»: bitte ein Datum wählen.`);
    return s;
  }
  if (f.parse) {
    try { return f.parse(v); } catch (err) { throw new Error(err.message); }
  }
  return v.trim();
}

// body: v__KEY = neuer Wert, reset__KEY = 1 (zurück auf .env). Gibt die geänderten Schlüssel zurück.
// ctx: { user, secure } für die Schutzregeln (nicht aussperren)
function save(body, { user = null, secure = true } = {}) {
  const before = stored();
  const next = { ...before };
  const errors = [];
  const changed = [];
  for (const f of FIELDS) {
    if (body[`reset__${f.key}`] === '1') {
      if (Object.hasOwn(next, f.key)) { delete next[f.key]; changed.push(f.key); }
      continue;
    }
    const input = body[`v__${f.key}`];
    if (input === undefined && f.type !== 'providers') continue;
    if (f.type === 'secret' && !String(input).trim()) continue; // leer = unverändert
    if (f.type === 'providers' && body.has__AUTH_PROVIDERS !== '1') continue;
    let value;
    try { value = normalize(f, input); } catch (err) { errors.push(err.message); continue; }
    if (f.type === 'secret') value = String(input); // Passwörter nicht kürzen
    const current = Object.hasOwn(next, f.key) ? next[f.key] : f.current();
    if (value === current) continue;
    next[f.key] = value;
    changed.push(f.key);
  }
  if (errors.length) throw new ValidationError(errors);
  if (!changed.length) return [];

  // Schutzregeln, damit sich niemand aussperrt
  const effective = (key) => (Object.hasOwn(next, key) ? next[key] : process.env[key] ?? '');
  const providers = String(Object.hasOwn(next, 'AUTH_PROVIDERS') ? next.AUTH_PROVIDERS : (process.env.AUTH_PROVIDERS || 'local')).split(',');
  if (!providers.includes('local')) {
    const msReady = effective('MS_TENANT_ID') && effective('MS_CLIENT_ID') && effective('MS_CLIENT_SECRET');
    if (!msReady) errors.push('Die Passwort-Anmeldung kann erst ausgeschaltet werden, wenn Tenant-ID, Client-ID und geheimer Schlüssel für Microsoft eingetragen sind.');
    else if (user && !Number(user.ms_login)) errors.push('Die Passwort-Anmeldung kann nicht ausgeschaltet werden, solange dein eigenes Konto die Microsoft-Anmeldung nicht freigegeben hat. Sonst sperrst du dich aus.');
    else {
      const admins = db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND ms_login = 1").n;
      if (!admins) errors.push('Ohne Passwort-Anmeldung braucht es mindestens ein aktives Admin-Konto mit Microsoft-Anmeldung.');
    }
  }
  if (changed.includes('SECURE_COOKIES') && effective('SECURE_COOKIES') === 'true' && !secure) {
    errors.push('Du bist gerade ohne HTTPS verbunden. Mit «Anmeldung nur über HTTPS» könntest du dich danach nicht mehr anmelden.');
  }
  if (errors.length) throw new ValidationError(errors);

  settings.set(STORE_KEY, next);
  applyStored();
  audit.log({
    entity: 'settings', action: 'server',
    summary: `${user?.display_name || 'System'} hat Server-Einstellungen geändert: ${changed.join(', ')}`,
    details: { keys: changed }, user,
  });
  return changed;
}

// Alle (oder einzelne) Werte aus der Verwaltung löschen: Notausgang auf dem Server
function reset(keys = null) {
  const s = stored();
  const next = keys && keys.length ? Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k))) : {};
  settings.set(STORE_KEY, next);
  applyStored();
  return Object.keys(s).filter((k) => !Object.hasOwn(next, k));
}

module.exports = { FIELDS, READONLY, rows, save, reset, applyStored, stored, raw };
