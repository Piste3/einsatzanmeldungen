'use strict';
// Zuletzt gewählte Filter pro Benutzer: speichern, wiederherstellen, zurücksetzen
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
  await users.create({ username: 'tom', display_name: 'Tom', role: 'aufgebotsstelle', password: 'Aufgebot-2026-y', must_change_password: false }, null);
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const { client } = require('./client');
async function login(username, password) {
  const c = client(base);
  await c.login(username, password);
  return c;
}
const filters = async (c, path) => (await c.get(path)).data.filters;

test('Rückmeldungen: Filter gelten auch in einer neuen Anmeldung, die Namenssuche nicht', async () => {
  const pc = await login('lena', 'Aufgebot-2026-x');
  await pc.get('/rueckmeldungen?view=einsatz&q=Muster&period=12m&team=&only=unsicher&sort=rang_ab&drafts=1');

  const handy = await login('lena', 'Aufgebot-2026-x'); // anderes Gerät
  let f = await filters(handy, '/rueckmeldungen');
  assert.equal(f.period, '12m');
  assert.equal(f.only, 'unsicher');
  assert.equal(f.drafts, '1');
  assert.equal(f.sort, 'rang_ab', 'Sortierung bleibt in «Pro Einsatz» erhalten');
  assert.equal(f.view, 'einsatz');
  assert.equal(f.q, '', 'Suche nicht gespeichert');

  // Andere Benutzer sehen ihren eigenen Stand
  const tom = await login('tom', 'Aufgebot-2026-y');
  f = await filters(tom, '/rueckmeldungen');
  assert.equal(f.period, '3m');
  assert.equal(f.view, 'tabelle');

  // Häkchen weg = aus; Link von aussen ergänzt nur die fehlenden Filter
  await pc.get('/rueckmeldungen?view=tabelle&period=6m&team=&only=&sort=name');
  f = await filters(handy, '/rueckmeldungen?only=offen');
  assert.equal(f.period, '6m');
  assert.equal(f.only, 'offen');
  assert.equal(f.drafts, '');

  // Zurücksetzen
  const r = await pc.get('/rueckmeldungen?filter=zuruecksetzen');
  assert.equal(r.redirect, '/rueckmeldungen');
  assert.equal((await filters(handy, '/rueckmeldungen')).period, '3m');
});

test('Einsätze und Personen: «Alle Status» und Sortierung bleiben', async () => {
  const pc = await login('lena', 'Aufgebot-2026-x');
  await pc.get('/einsaetze?status=&from=2026-01-01&to=&q=abc');
  let f = await filters(pc, '/einsaetze');
  assert.equal(f.status, '');
  assert.equal(f.from, '2026-01-01');
  assert.equal(f.q, '');
  // Export ohne Filter in der Adresse übernimmt den gespeicherten Stand
  assert.equal((await pc.get('/einsaetze?format=csv')).status, 200);
  assert.equal((await filters(pc, '/einsaetze')).from, '2026-01-01');

  await pc.get('/personen?q=&team=&rank=&status=alle&sort=rang_ab');
  f = await filters(pc, '/personen');
  assert.equal(f.status, 'alle');
  assert.equal(f.sort, 'rang_ab');
});

test('Anmeldungen und Teilnehmerliste: Sortierung gilt für alle Einsätze', async () => {
  const events = require('../src/services/events');
  const a = events.create({ name: 'Probe A', date: '2027-03-01', start_time: '18:00', end_time: '21:00' }, system);
  const b = events.create({ name: 'Probe B', date: '2027-03-08', start_time: '18:00', end_time: '21:00' }, system);
  const pc = await login('lena', 'Aufgebot-2026-x');
  await pc.get(`/einsaetze/${a}/anmeldungen?status=&q=&sort=funktion`);
  assert.equal((await filters(pc, `/einsaetze/${b}/anmeldungen?status=neu`)).sort, 'funktion');
  await pc.get(`/einsaetze/${a}/teilnehmerliste?umfang=bestaetigt&sort=rang_ab`);
  const d = (await pc.get(`/einsaetze/${b}/verpflegungsliste`)).data;
  assert.equal(d.umfang ?? d.filters?.umfang, 'bestaetigt');
  assert.equal(d.sort ?? d.filters?.sort, 'rang_ab');
});
