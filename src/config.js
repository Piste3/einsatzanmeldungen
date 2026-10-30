'use strict';
const path = require('node:path');

// Konfiguration ausschliesslich über Umgebungsvariablen (siehe README)
const env = process.env;
const isProd = env.NODE_ENV === 'production';

// Liste der erlaubten Einbettungs-Seiten (Leerzeichen oder Komma getrennt).
// «self» wird immer ergänzt; auch ohne Anführungszeichen geschrieben.
function frameAncestors(value) {
  const list = String(value).split(/[\s,]+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean)
    .map((t) => (t === 'self' ? "'self'" : t.replace(/\/+$/, '')));
  if (!list.includes("'self'")) list.unshift("'self'");
  return list.join(' ');
}

module.exports = {
  isProd,
  port: Number(env.PORT || 3000),
  host: env.HOST || '0.0.0.0',
  baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
  dataDir: path.resolve(env.DATA_DIR || path.join(__dirname, '..', 'data')),
  dbFile: env.DB_FILE || null,
  // Hinter einem Reverse-Proxy (HTTPS-Terminierung) muss TRUST_PROXY=1 gesetzt sein
  trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
  secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : isProd,
  sessionHours: Number(env.SESSION_HOURS || 12),
  sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES || 120),
  // Welche Anmeldeverfahren aktiv sind: «local», «microsoft» oder beide (kommagetrennt)
  authProviders: (env.AUTH_PROVIDERS || 'local').split(',').map((s) => s.trim()).filter(Boolean),
  microsoft: {
    tenantId: env.MS_TENANT_ID || '',
    clientId: env.MS_CLIENT_ID || '',
    clientSecret: env.MS_CLIENT_SECRET || '',
    // Optional: nur Konten aus diesen Mandanten (Tenant-IDs, kommagetrennt). Leer = jeder Mandant.
    allowedTenants: (env.MS_ALLOWED_TENANTS || '').split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
  },
  // Wer das Anmeldeformular einbetten darf (CSP frame-ancestors)
  formFrameAncestors: frameAncestors(env.FORM_FRAME_ANCESTORS || "'self' https://*.clubdesk.com https://web.kkb.ch https://*.web.kkb.ch http://web.kkb.ch http://*.web.kkb.ch"),
  smtp: {
    host: env.SMTP_HOST || '',
    port: Number(env.SMTP_PORT || 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER || '',
    pass: env.SMTP_PASS || '',
    from: env.SMTP_FROM || '',
  },
  backupDir: env.BACKUP_DIR || null,
  backupKeepDays: Number(env.BACKUP_KEEP_DAYS || 30),
  timezone: 'Europe/Zurich',
};
