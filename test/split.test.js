'use strict';
// Getrennter Betrieb: Browser-App (frontend/server.cjs) und Backend (createApp({ split: true })) als zwei Server
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { freshDb } = require('./helpers');
const { client } = require('./client');
const users = require('../src/services/users');
const live = require('../src/lib/live');
const auth = require('../src/auth');
const { createApp } = require('../src/app');
const { createFrontendServer } = require('../frontend/server.cjs');

const hasDist = fs.existsSync(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
let backend; let front; let base; let apiBase;

test.before(async () => {
  freshDb();
  await users.create({ username: 'lena', display_name: 'Lena', role: 'aufgebotsstelle', password: 'Aufgebot-2026-x', must_change_password: false }, null);
  backend = http.createServer(createApp({ split: true }));
  live.attach(backend, auth.userFromRequest);
  await new Promise((r) => backend.listen(0, '127.0.0.1', r));
  apiBase = `http://127.0.0.1:${backend.address().port}`;
  const fe = createFrontendServer({ backend: apiBase });
  front = fe.server;
  await fe.ready();
  await new Promise((r) => front.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${front.address().port}`;
});
test.after(() => { live.closeAll(); front.close(); backend.close(); });

test('Backend liefert keine Seiten, nur Daten', async () => {
  const r = await fetch(`${apiBase}/einsaetze`, { headers: { accept: 'text/html' } });
  assert.equal(r.status, 404);
  assert.equal((await fetch(`${apiBase}/static/css/app.css`)).status, 404);
  assert.equal((await fetch(`${apiBase}/health`)).status, 200);
});

test('Browser-App: Seiten selbst, Daten über das Backend', { skip: !hasDist && 'Browser-App nicht gebaut' }, async () => {
  const page = await fetch(`${base}/einsaetze`, { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="app">/);
  assert.equal((await fetch(`${base}/static/css/app.css`)).status, 200);
  // Adresse roh senden (fetch würde «..» selbst auflösen): nie eine Datei ausserhalb der Ordner
  const raw = (p) => new Promise((resolve) => http.get(`${base}${p}`, (r) => { let d = ''; r.on('data', (x) => { d += x; }); r.on('end', () => resolve(d)); }));
  for (const p of ['/static/%2e%2e/package.json', '/static/..%2f..%2fpackage.json', '/static/%2e%2e/%2e%2e/package.json', '/assets/..%2f..%2f..%2fpackage.json']) {
    assert.doesNotMatch(await raw(p), /"kkb-einsatzplaner/, p);
  }
  // Formular: Einbettung nach den Einstellungen des Backends
  const form = await fetch(`${base}/forms/anmeldung`);
  assert.match(form.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/\*\.clubdesk\.com/);
  assert.equal(form.headers.get('x-frame-options'), null);
  assert.equal((await fetch(`${base}/login`)).headers.get('x-frame-options'), 'DENY');
});

test('Anmelden und Daten holen durch die Browser-App hindurch', async () => {
  const c = client(base);
  const r = await c.login('lena', 'Aufgebot-2026-x');
  assert.equal(r.redirect, '/');
  const s = await c.refresh();
  assert.equal(s.user.username, 'lena');
  assert.ok(!('password_hash' in s.user));
  const created = await c.post('/einsaetze', { name: 'Probe', date: '2030-05-01', start_time: '18:00', end_time: '21:00' });
  assert.match(created.redirect, /^\/einsaetze\/\d+/);
  // Download (Datei) durch die Weiterleitung
  const id = created.redirect.match(/\d+/)[0];
  const csv = await c.get(`/einsaetze/${id}/teilnehmerliste?format=csv`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /Teilnehmerliste_Probe/);
});

test('Live-Meldungen durch die Browser-App hindurch', async () => {
  const { WebSocket } = require('ws');
  const c = client(base);
  await c.login('lena', 'Aufgebot-2026-x');
  const ws = new WebSocket(`${base.replace('http', 'ws')}/live`, { headers: { cookie: c.cookie() } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  ws.send(JSON.stringify({ type: 'subscribe', topics: ['events'] }));
  await new Promise((r) => setTimeout(r, 100));
  const got = new Promise((resolve) => ws.on('message', (m) => resolve(JSON.parse(String(m)))));
  live.notify('events');
  const msg = await got;
  assert.ok(msg.topics.includes('events'));
  ws.close();
});

test('Backend weg: Browser-App antwortet mit «kurz nicht erreichbar»', async () => {
  const fe = createFrontendServer({ backend: 'http://127.0.0.1:1' });
  await new Promise((r) => fe.server.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${fe.server.address().port}/api/v1/session`);
    assert.equal(r.status, 503);
    assert.deepEqual(await r.json(), { error: 'Der Server ist kurz nicht erreichbar.', offline: true });
  } finally { fe.server.close(); }
});
