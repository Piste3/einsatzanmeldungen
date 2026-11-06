'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, system } = require('./helpers');
const users = require('../src/services/users');
const { createApp } = require('../src/app');

let server;
let base;

test.before(async () => {
  freshDb();
  await users.create({ username: 'lena', display_name: 'Lena', role: 'aufgebotsstelle', password: 'Aufgebot-2026-x', must_change_password: false }, null);
  await users.create({ username: 'leiter', display_name: 'Leo Leiter', role: 'einsatzleiter', password: 'Kommando-Lauf-2026', must_change_password: false }, null);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function login(username, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, next: '/' }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}
const get = (path, cookie) => fetch(`${base}${path}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });

test('Manifest und Service Worker ohne Login erreichbar', async () => {
  const m = await get('/manifest.webmanifest');
  assert.equal(m.status, 200);
  assert.match(m.headers.get('content-type'), /application\/manifest\+json/);
  const json = await m.json();
  assert.equal(json.start_url, '/handy');
  assert.equal(json.display, 'standalone');
  for (const icon of json.icons) assert.equal((await get(icon.src)).status, 200, icon.src);
  const sw = await get('/sw.js');
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /javascript/);
  assert.equal((await get('/static/offline.html')).status, 200);
  const r = await get('/handy');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/login?next=%2Fhandy');
});

test('Handy-App: Einsatz wählen, Antwort eintragen, rückgängig machen', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const { today, addDays } = require('../src/lib/dates');
  const pia = persons.create({ first_name: 'Pia', last_name: 'Planer', status: 'aktiv', mobile: '079 555 44 33' }, system);
  const ev = events.create({ name: 'Übung Hardwald', date: addDays(today(), 2), start_time: '08:00', end_time: '12:00' }, system);
  db.run("UPDATE events SET status = 'veroeffentlicht' WHERE id = ?", ev);
  const cookie = await login('lena', 'Aufgebot-2026-x');

  const start = await (await get('/handy', cookie)).text();
  assert.match(start, /Übung Hardwald/);
  assert.match(start, /rel="manifest"/);
  const page = await (await get(`/handy/einsatz/${ev}`, cookie)).text();
  assert.match(page, /Pia Planer/);
  assert.match(page, /href="tel:0795554433"/);
  assert.match(page, /Noch nicht gefragt/);
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];

  const post = (path, body, xhr = true) => fetch(`${base}/handy/einsatz/${ev}/${path}`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...(xhr ? { 'x-requested-with': 'XMLHttpRequest' } : {}) },
    body: new URLSearchParams({ _csrf: csrf, person_id: String(pia), ...body }),
  });

  // Kann (mündlich): Karte kommt zurück, Anmeldung entsteht
  const kann = await post('antwort', { antwort: 'kann', channel: 'muendlich' });
  assert.equal(kann.status, 200);
  const card = await kann.text();
  assert.match(card.trim(), /^<article class="hc hc-kann"/);
  assert.match(card, /Mdl \d\d:\d\d/);
  const reg = db.one('SELECT * FROM registrations WHERE event_id = ? AND person_id = ?', ev, pia);
  assert.equal(reg.source, 'muendlich');
  assert.equal((await (await get(`/handy/einsatz/${ev}?zeige=kann`, cookie)).text()).includes('Pia Planer'), true);

  // Kann nicht per Telefon: Anmeldung wird zurückgezogen
  const nein = await (await post('antwort', { antwort: 'kann_nicht', channel: 'telefon' })).text();
  assert.match(nein, /hc-kann_nicht/);
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', reg.id).status, 'zurueckgezogen');

  // Falsch getippt: letzten Eintrag rückgängig machen
  const last = db.one('SELECT a.id FROM contact_attempts a JOIN inquiries i ON i.id = a.inquiry_id WHERE i.event_id = ? ORDER BY a.id DESC LIMIT 1', ev);
  const undo = await (await post('zuruecknehmen', { attempt_id: String(last.id) })).text();
  assert.match(undo, /hc-kann"/);

  // Ohne Script: zurück zur Liste an die Stelle der Person
  const plain = await post('antwort', { antwort: 'unsicher', channel: 'muendlich', back: `/handy/einsatz/${ev}?zeige=alle` }, false);
  assert.equal(plain.status, 302);
  assert.equal(plain.headers.get('location'), `/handy/einsatz/${ev}?zeige=alle#p${pia}`);
  const outside = await post('antwort', { antwort: 'unsicher', back: 'https://example.com/' }, false);
  assert.equal(outside.headers.get('location'), `/handy/einsatz/${ev}#p${pia}`);

  // Unbekannte Antwort: Fehlermeldung als Text
  const bad = await post('antwort', { antwort: 'vielleicht' });
  assert.equal(bad.status, 400);
  assert.match(await bad.text(), /Antwort wählen/);
});

test('Einsatzleiter haben keine Handy-App', async () => {
  const cookie = await login('leiter', 'Kommando-Lauf-2026');
  assert.equal((await get('/handy', cookie)).status, 403);
  assert.doesNotMatch(await (await get('/', cookie)).text(), /href="\/handy"/);
});
