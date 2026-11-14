'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.SMTP_HOST = 'mail.aus-env.ch';
process.env.SMTP_PASS = 'env-geheim-123';
const { freshDb } = require('./helpers');
const config = require('../src/config');
const users = require('../src/services/users');
const settings = require('../src/services/settings');
const serverSettings = require('../src/services/server-settings');
const { createApp } = require('../src/app');

const admin = { id: null, display_name: 'Test', role: 'admin', ms_login: 0 };
// Formular wie im Browser: alle Felder mit aktuellem Wert
function formBody(changes = {}) {
  const body = { has__AUTH_PROVIDERS: '1' };
  for (const g of serverSettings.rows().groups) {
    for (const f of g.fields) body[`v__${f.key}`] = f.type === 'providers' ? f.value.split(',') : f.value;
  }
  return { ...body, ...changes };
}

test.beforeEach(() => {
  freshDb();
  settings.clearCache();
  serverSettings.applyStored();
});

test('ohne Eintrag gilt die .env, gespeicherte Werte gehen vor und gelten sofort', () => {
  assert.equal(config.smtp.host, 'mail.aus-env.ch');
  const smtp = () => serverSettings.rows().groups.find((g) => g.name === 'E-Mail-Versand').fields.find((f) => f.key === 'SMTP_HOST');
  assert.equal(smtp().source, 'env');
  const changed = serverSettings.save(formBody({ v__SMTP_HOST: 'smtp.verwaltung.ch', v__BACKUP_KEEP_DAYS: '14' }), { user: admin });
  assert.deepEqual(changed.sort(), ['BACKUP_KEEP_DAYS', 'SMTP_HOST']);
  assert.equal(config.smtp.host, 'smtp.verwaltung.ch');
  assert.equal(config.backupKeepDays, 14);
  assert.equal(smtp().source, 'verwaltung');
  assert.equal(smtp().overridesEnv, true);
  // Nach einem Neustart: Werte kommen aus der Datenbank
  config.apply({});
  assert.equal(config.smtp.host, 'mail.aus-env.ch');
  serverSettings.applyStored();
  assert.equal(config.smtp.host, 'smtp.verwaltung.ch');
  // Zurück auf .env
  serverSettings.save(formBody({ reset__SMTP_HOST: '1' }), { user: admin });
  assert.equal(config.smtp.host, 'mail.aus-env.ch');
  assert.deepEqual(Object.keys(serverSettings.stored()), ['BACKUP_KEEP_DAYS']);
});

test('unveränderte Werte werden nicht gespeichert', () => {
  assert.deepEqual(serverSettings.save(formBody(), { user: admin }), []);
  assert.deepEqual(serverSettings.stored(), {});
});

test('Geheimnisse: nie im Formular, leer = unverändert', () => {
  const pass = () => serverSettings.rows().groups.flatMap((g) => g.fields).find((f) => f.key === 'SMTP_PASS');
  assert.equal(pass().value, '');
  assert.equal(pass().isSet, true);
  assert.deepEqual(serverSettings.save(formBody({ v__SMTP_PASS: '' }), { user: admin }), []);
  assert.equal(config.smtp.pass, 'env-geheim-123');
  serverSettings.save(formBody({ v__SMTP_PASS: ' neu mit Leerzeichen ' }), { user: admin });
  assert.equal(config.smtp.pass, ' neu mit Leerzeichen ');
  assert.equal(pass().value, '');
});

test('Prüfungen: Zahlen, Adresse, nicht aussperren', () => {
  assert.throws(() => serverSettings.save(formBody({ v__SESSION_HOURS: '0' }), { user: admin }), /Zahl von 1 bis 720/);
  assert.throws(() => serverSettings.save(formBody({ v__BASE_URL: 'einsatz.holmium.ch' }), { user: admin }), /http/);
  assert.throws(() => serverSettings.save(formBody({ v__AUTH_PROVIDERS: [] }), { user: admin }), /Mindestens ein Anmeldeverfahren/);
  assert.throws(() => serverSettings.save(formBody({ v__AUTH_PROVIDERS: ['microsoft'] }), { user: admin }), /erst ausgeschaltet werden/);
  assert.throws(() => serverSettings.save(formBody({
    v__AUTH_PROVIDERS: ['microsoft'], v__MS_TENANT_ID: 'organizations', v__MS_CLIENT_ID: 'abc', v__MS_CLIENT_SECRET: 'xyz',
  }), { user: admin }), /dein eigenes Konto/);
  assert.equal(config.secureCookies, false, 'Testumgebung ohne NODE_ENV=production');
  assert.throws(() => serverSettings.save(formBody({ v__SECURE_COOKIES: 'true' }), { user: admin, secure: false }), /ohne HTTPS/);
  assert.deepEqual(serverSettings.stored(), {}, 'bei Fehlern wird nichts gespeichert');
  // Microsoft zusätzlich zum Passwort geht
  serverSettings.save(formBody({ v__AUTH_PROVIDERS: ['local', 'microsoft'], v__BASE_URL: 'https://einsatz.holmium.ch/' }), { user: admin });
  assert.deepEqual(config.authProviders, ['local', 'microsoft']);
  assert.equal(config.baseUrl, 'https://einsatz.holmium.ch');
});

test('Notausgang: zurücksetzen löscht die Werte aus der Datenbank', () => {
  serverSettings.save(formBody({ v__SMTP_HOST: 'x.ch', v__SESSION_HOURS: '8' }), { user: admin });
  assert.deepEqual(serverSettings.reset(['SMTP_HOST']), ['SMTP_HOST']);
  assert.equal(config.smtp.host, 'mail.aus-env.ch');
  assert.equal(config.sessionHours, 8);
  serverSettings.reset();
  assert.equal(config.sessionHours, 12);
});

test('Seite: nur Admin, kein Geheimnis im HTML, Einbettung wirkt sofort', async () => {
  await users.create({ username: 'admin', display_name: 'Admin', role: 'admin', password: 'Chef-Passwort-2026', must_change_password: false }, null);
  await users.create({ username: 'lena', display_name: 'Lena', role: 'aufgebotsstelle', password: 'Aufgebot-2026-x', must_change_password: false }, null);
  const server = createApp().listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const { client } = require('./client');
    const login = async (username, password) => {
      const c = client(base);
      await c.login(username, password);
      return c;
    };
    const lena = await login('lena', 'Aufgebot-2026-x');
    assert.equal((await lena.get('/verwaltung/server')).status, 403);
    const admin = await login('admin', 'Chef-Passwort-2026');
    const page = await admin.get('/verwaltung/server');
    assert.equal(page.status, 200);
    const json = JSON.stringify(page.json);
    assert.ok(!json.includes('env-geheim-123'), 'Passwort verlässt den Server nicht');
    assert.match(json, /mail\.aus-env\.ch/);
    const r = await admin.post('/verwaltung/server', { has__AUTH_PROVIDERS: '1', v__AUTH_PROVIDERS: 'local', v__FORM_FRAME_ANCESTORS: 'https://neu.example.ch' });
    assert.ok(r.redirect);
    const form = await fetch(`${base}/forms/anmeldung`);
    assert.match(form.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/neu\.example\.ch/);
  } finally {
    server.close();
  }
});
