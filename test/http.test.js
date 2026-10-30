'use strict';
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
  await users.create({ username: 'lena', display_name: 'Lena', role: 'aufgebotsstelle', password: 'Aufgebot-2026-x', must_change_password: false }, null);
  await users.create({ username: 'neu', display_name: 'Neu', role: 'aufgebotsstelle', password: 'Erstes-Kennwort-99' }, null);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function login(username, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, next: '/' }),
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { res, cookie };
}

const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });

test('ohne Anmeldung nur Login und Formular erreichbar', async () => {
  const r = await get('/');
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /^\/login/);
  assert.equal((await get('/login')).status, 200);
  assert.equal((await get('/forms/anmeldung')).status, 200);
});

test('Anmeldung und Rollen', async () => {
  const bad = await login('admin', 'falsch-falsch');
  assert.equal(bad.res.status, 401);

  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.equal(admin.res.status, 302);
  assert.equal((await get('/', admin.cookie)).status, 200);
  assert.equal((await get('/verwaltung/benutzer', admin.cookie)).status, 200);

  const lena = await login('lena', 'Aufgebot-2026-x');
  assert.equal((await get('/einsaetze', lena.cookie)).status, 200);
  assert.equal((await get('/verwaltung/benutzer', lena.cookie)).status, 403);
});

test('Erstes Login mit Startpasswort verlangt neues Passwort', async () => {
  const neu = await login('neu', 'Erstes-Kennwort-99');
  assert.equal(neu.res.headers.get('location'), '/konto/passwort');
  const r = await get('/', neu.cookie);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/konto/passwort');
});

test('POST ohne CSRF-Token wird abgelehnt', async () => {
  const admin = await login('admin', 'Chef-Passwort-2026');
  const r = await fetch(`${base}/einsaetze/neu`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'X', date: '2030-01-01' }),
  });
  assert.equal(r.status, 403);
});

test('Konto wird nach 5 Fehlversuchen gesperrt', async () => {
  for (let i = 0; i < 5; i++) await login('lena', 'falsch-falsch');
  const locked = await login('lena', 'Aufgebot-2026-x');
  assert.equal(locked.res.status, 401);
});

test('Formular darf nur in erlaubte Seiten eingebettet werden', async () => {
  const r = await get('/forms/anmeldung');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/\*\.clubdesk\.com/);
  assert.equal(r.headers.get('x-frame-options'), null);
  const app = await get('/login');
  assert.match(app.headers.get('content-security-policy') || app.headers.get('x-frame-options') || '', /frame-ancestors 'none'|DENY/i);
});
