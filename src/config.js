'use strict';
const path = require('node:path');

// Konfiguration aus Umgebungsvariablen (.env, siehe README). Die meisten Werte kann der Admin zusätzlich unter
// Einstellungen › Server ändern; diese Werte liegen in der Datenbank und gehen der .env vor (apply()).
// Werte, ohne die der Server nicht startet oder die Datenbank nicht findet (Port, Datenordner …), kommen nur aus der .env.
const isProd = process.env.NODE_ENV === 'production';

// Liste der erlaubten Einbettungs-Seiten (Leerzeichen oder Komma getrennt).
// «self» wird immer ergänzt; auch ohne Anführungszeichen geschrieben.
function frameAncestors(value) {
  const list = String(value).split(/[\s,]+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean)
    .map((t) => (t === 'self' ? "'self'" : t.replace(/\/+$/, '')));
  if (!list.includes("'self'")) list.unshift("'self'");
  return list.join(' ');
}

const DEFAULT_FRAME_ANCESTORS = "'self' https://*.clubdesk.com https://web.kkb.ch https://*.web.kkb.ch http://web.kkb.ch http://*.web.kkb.ch";

// Werte, die nur beim Start aus der .env gelesen werden (nicht in der Verwaltung änderbar)
function startupValues(env) {
  return {
    isProd,
    port: Number(env.PORT || 3000),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
    dbFile: env.DB_FILE || null,
    timezone: 'Europe/Zurich',
  };
}

// Werte, die auch in der Verwaltung geändert werden können
function adjustableValues(env, port) {
  return {
    baseUrl: (env.BASE_URL || `http://localhost:${port}`).replace(/\/$/, ''),
    // Hinter einem Reverse-Proxy (HTTPS-Terminierung) muss TRUST_PROXY=1 gesetzt sein
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : isProd,
    sessionHours: Number(env.SESSION_HOURS) > 0 ? Number(env.SESSION_HOURS) : 12,
    sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES) > 0 ? Number(env.SESSION_IDLE_MINUTES) : 120,
    // Welche Anmeldeverfahren aktiv sind: «local», «microsoft» oder beide (kommagetrennt)
    authProviders: (env.AUTH_PROVIDERS || 'local').split(',').map((s) => s.trim()).filter(Boolean),
    microsoft: {
      tenantId: env.MS_TENANT_ID || '',
      clientId: env.MS_CLIENT_ID || '',
      clientSecret: env.MS_CLIENT_SECRET || '',
      // Ablaufdatum des geheimen Clientschlüssels (JJJJ-MM-TT): Admins sehen 30 Tage vorher eine Erinnerung
      secretExpires: /^\d{4}-\d{2}-\d{2}$/.test(env.MS_SECRET_EXPIRES || '') ? env.MS_SECRET_EXPIRES : '',
      // Optional: nur Konten aus diesen Mandanten (Tenant-IDs, kommagetrennt). Leer = jeder Mandant.
      allowedTenants: (env.MS_ALLOWED_TENANTS || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
    },
    // Wer das Anmeldeformular einbetten darf (CSP frame-ancestors)
    formFrameAncestors: frameAncestors(env.FORM_FRAME_ANCESTORS || DEFAULT_FRAME_ANCESTORS),
    smtp: {
      host: env.SMTP_HOST || '',
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || '',
      pass: env.SMTP_PASS || '',
      from: env.SMTP_FROM || '',
    },
    backupDir: env.BACKUP_DIR || null,
    // Lesezugang zu GitHub für «Update installieren» (privates Repository; der Server läuft im Autostart als SYSTEM ohne eigene Anmeldung)
    githubToken: env.GITHUB_TOKEN || '',
    backupKeepDays: Number(env.BACKUP_KEEP_DAYS) > 0 ? Number(env.BACKUP_KEEP_DAYS) : 30,
  };
}

const config = { ...startupValues(process.env) };
Object.assign(config, adjustableValues(process.env, config.port));

const listeners = [];

// Werte aus der Verwaltung (Schlüssel wie in der .env) über die .env legen. Verschachtelte Objekte
// (microsoft, smtp) werden an Ort und Stelle aktualisiert, damit gemerkte Verweise gültig bleiben.
function apply(overrides = {}) {
  const fresh = adjustableValues({ ...process.env, ...overrides }, config.port);
  for (const [key, value] of Object.entries(fresh)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && config[key] && typeof config[key] === 'object') {
      Object.assign(config[key], value);
    } else {
      config[key] = value;
    }
  }
  for (const fn of listeners) fn(config);
}

// Wird nach jeder Änderung aufgerufen (z. B. Mailserver-Verbindung neu aufbauen)
function onChange(fn) {
  listeners.push(fn);
}

Object.defineProperties(config, {
  apply: { value: apply },
  onChange: { value: onChange },
  frameAncestors: { value: frameAncestors },
  DEFAULT_FRAME_ANCESTORS: { value: DEFAULT_FRAME_ANCESTORS },
});

module.exports = config;
