'use strict';
// JSON-Schnittstelle /api/v1 (Browser-App)
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const users = require('../src/services/users');
const { createApp } = require('../src/app');

let server;
let base;

test.before(async () => {
  freshDb();
  await users.create({ username: 'admin', display_name: 'Admin', role: 'admin', password: 'Chef-Passwort-2026', must_change_password: false }, null);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (path, { method = 'GET', body, cookie, csrf } = {}) => fetch(`${base}/api/v1${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(csrf ? { 'x-csrf-token': csrf } : {}) },
  body: body ? JSON.stringify(body) : undefined,
  redirect: 'manual',
});

test('ohne Anmeldung antwortet die Schnittstelle mit 401 als JSON', async () => {
  const r = await call('/');
  assert.equal(r.status, 401);
  assert.equal((await r.json()).login, true);
  const s = await (await call('/session')).json();
  assert.equal(s.user, null);
});

test('Login, Sitzung, Seitendaten und Änderung mit CSRF-Token', async () => {
  const bad = await call('/login', { method: 'POST', body: { username: 'admin', password: 'falsch' } });
  assert.equal(bad.status, 401);
  assert.ok((await bad.json()).data.error);

  const ok = await call('/login', { method: 'POST', body: { username: 'admin', password: 'Chef-Passwort-2026', next: '/' } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).redirect, '/');
  const cookie = ok.headers.get('set-cookie').split(';')[0];

  const s = await (await call('/session', { cookie })).json();
  assert.equal(s.user.username, 'admin');
  assert.ok(s.csrf);
  for (const k of ['password_hash', 'totp_secret', 'recovery_codes']) assert.equal(k in s.user, false, `${k} bleibt im Backend`);

  const home = await call('/', { cookie });
  assert.equal(home.status, 200);
  const page = await home.json();
  assert.equal(page.view, 'pages/cockpit');
  assert.ok(Array.isArray(page.data.todos));
  assert.equal(page.user.role, 'admin');
  assert.equal('password_hash' in page.user, false);

  // Änderung ohne Token wird abgelehnt
  const noToken = await call('/konto/darstellung', { method: 'POST', body: { theme: 'dark' }, cookie });
  assert.equal(noToken.status, 403);
  const withToken = await call('/konto/darstellung', { method: 'POST', body: { theme: 'dark' }, cookie, csrf: s.csrf });
  assert.equal(withToken.status, 200);
  assert.ok((await withToken.json()).redirect);
  assert.equal((await (await call('/session', { cookie })).json()).user.theme, 'dark');
});

test('unbekannte Adresse: JSON-Fehler 404', async () => {
  const r = await call('/gibt-es-nicht');
  assert.ok([401, 404].includes(r.status));
  assert.match(r.headers.get('content-type'), /json/);
});

test('öffentliches Formular über die Schnittstelle', async () => {
  const r = await call('/forms/anmeldung');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).view, 'form/anmeldung');
});

test('Benutzerliste enthält nie Passwort-Hashes', async () => {
  const ok = await call('/login', { method: 'POST', body: { username: 'admin', password: 'Chef-Passwort-2026', next: '/' } });
  const cookie = ok.headers.get('set-cookie').split(';')[0];
  const r = await call('/verwaltung/benutzer', { cookie });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.doesNotMatch(text, /password_hash|totp_secret|recovery_codes/);
});
