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

async function login(username, password) {
  const res = await fetch(`${base}/login`, {
    method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ username, password, next: '/' }),
  });
  return (res.headers.get('set-cookie') || '').split(';')[0];
}
const get = (path, cookie) => fetch(`${base}${path}`, { headers: { cookie }, redirect: 'manual' });
const page = async (path, cookie) => (await get(path, cookie)).text();

test('Rückmeldungen: Filter gelten auch in einer neuen Anmeldung, die Namenssuche nicht', async () => {
  const pc = await login('lena', 'Aufgebot-2026-x');
  await get('/rueckmeldungen?view=einsatz&q=Muster&period=12m&team=&only=unsicher&sort=rang_ab&drafts=1', pc);

  const handy = await login('lena', 'Aufgebot-2026-x'); // anderes Gerät
  const html = await page('/rueckmeldungen', handy);
  assert.match(html, /<option value="12m" selected>/);
  assert.match(html, /<option value="unsicher" selected>/);
  assert.match(html, /name="drafts" value="1" checked/);
  assert.match(html, /name="sort" value="rang_ab"/, 'Sortierung bleibt in «Pro Einsatz» erhalten');
  assert.match(html, /class="active" href="[^"]*view=einsatz/);
  assert.match(html, /name="q" value=""/, 'Suche nicht gespeichert');
  assert.match(html, /href="\/rueckmeldungen\?filter=zuruecksetzen"/);

  // Andere Benutzer sehen ihren eigenen Stand
  const tom = await login('tom', 'Aufgebot-2026-y');
  const other = await page('/rueckmeldungen', tom);
  assert.match(other, /<option value="3m" selected>/);
  assert.doesNotMatch(other, /filter=zuruecksetzen/);

  // Häkchen weg = aus; Link von aussen ergänzt nur die fehlenden Filter
  await get('/rueckmeldungen?view=tabelle&period=6m&team=&only=&sort=name', pc);
  const again = await page('/rueckmeldungen?only=offen', handy);
  assert.match(again, /<option value="6m" selected>/);
  assert.match(again, /<option value="offen" selected>/);
  assert.match(again, /name="drafts" value="1" >/);

  // Zurücksetzen
  const r = await get('/rueckmeldungen?filter=zuruecksetzen', pc);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/rueckmeldungen');
  assert.match(await page('/rueckmeldungen', handy), /<option value="3m" selected>/);
});

test('Einsätze und Personen: «Alle Status» und Sortierung bleiben', async () => {
  const pc = await login('lena', 'Aufgebot-2026-x');
  await get('/einsaetze?status=&from=2026-01-01&to=&q=abc', pc);
  let html = await page('/einsaetze', pc);
  assert.match(html, /<option value="" selected>Alle Status/);
  assert.match(html, /name="from" value="2026-01-01"/);
  assert.match(html, /name="q" value=""/);
  // Export ohne Filter in der Adresse übernimmt den gespeicherten Stand
  assert.equal((await get('/einsaetze?format=csv', pc)).status, 200);
  assert.match(await page('/einsaetze', pc), /name="from" value="2026-01-01"/);

  await get('/personen?q=&team=&rank=&status=alle&sort=rang_ab', pc);
  html = await page('/personen', pc);
  assert.match(html, /<option value="alle" selected>/);
  assert.match(html, /<option value="rang_ab" selected>/);
  assert.match(html, /href="\/personen\?filter=zuruecksetzen"/);
});

test('Anmeldungen und Teilnehmerliste: Sortierung gilt für alle Einsätze', async () => {
  const events = require('../src/services/events');
  const a = events.create({ name: 'Probe A', date: '2027-03-01', start_time: '18:00', end_time: '21:00' }, system);
  const b = events.create({ name: 'Probe B', date: '2027-03-08', start_time: '18:00', end_time: '21:00' }, system);
  const pc = await login('lena', 'Aufgebot-2026-x');
  await get(`/einsaetze/${a}/anmeldungen?status=&q=&sort=funktion`, pc);
  assert.match(await page(`/einsaetze/${b}/anmeldungen?status=neu`, pc), /<option value="funktion" selected>/);
  await get(`/einsaetze/${a}/teilnehmerliste?umfang=bestaetigt&sort=rang_ab`, pc);
  const html = await page(`/einsaetze/${b}/verpflegungsliste`, pc);
  assert.match(html, /<option value="bestaetigt" selected>/);
  assert.match(html, /<option value="rang_ab" selected>/);
});
