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

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const getAs = (path, cookie, ua) => fetch(`${base}${path}`, { headers: { ...(cookie ? { cookie } : {}), 'user-agent': ua }, redirect: 'manual' });

test('Auf dem Handy kommt immer die Handy-App', async () => {
  const cookie = await login('lena', 'Aufgebot-2026-x');
  const cases = [['/', '/handy'], ['/einsaetze', '/handy'], ['/einsaetze/5/anmeldungen', '/handy/einsatz/5/anmeldungen'],
    ['/einsaetze/5/schichten', '/handy/einsatz/5'], ['/personen/3', '/handy/personen/3'], ['/rueckmeldungen', '/handy/personen']];
  for (const [from, to] of cases) {
    const r = await getAs(from, cookie, IPHONE);
    assert.equal(r.status, 302, from);
    assert.equal(r.headers.get('location'), to, from);
  }
  // Handbuch, Konto und Exporte bleiben erreichbar; Tablet und PC bleiben bei der normalen Ansicht
  assert.equal((await getAs('/handbuch', cookie, IPHONE)).status, 200);
  assert.equal((await getAs('/konto/passwort', cookie, IPHONE)).status, 200);
  assert.equal((await getAs('/', cookie, 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1')).status, 200);
  assert.equal((await get('/', cookie)).status, 200);
  // «Ganze Ansicht» schaltet für eine Stunde um, die Handy-App schaltet zurück
  const pc = await getAs('/handy/ganze-ansicht', cookie, IPHONE);
  assert.equal(pc.headers.get('location'), '/');
  const pcCookie = pc.headers.get('set-cookie').split(';')[0];
  assert.match(pc.headers.get('set-cookie'), /Max-Age=3600/);
  assert.equal((await getAs('/einsaetze', `${cookie}; ${pcCookie}`, IPHONE)).status, 200);
  assert.match((await getAs('/handy', `${cookie}; ${pcCookie}`, IPHONE)).headers.get('set-cookie') || '', /kkb_ansicht=;/);
});

test('Handy-App: Anmeldungen ansehen und bestätigen, Ansicht Personen', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const { today, addDays } = require('../src/lib/dates');
  const tom = persons.create({ first_name: 'Tom', last_name: 'Tambour', status: 'aktiv', mobile: '079 222 33 44' }, system);
  const ev = events.create({ name: 'Übung Bruderholz', date: addDays(today(), 3), start_time: '09:00', end_time: '12:00' }, system);
  const ev2 = events.create({ name: 'Übung Allschwil', date: addDays(today(), 9), start_time: '09:00', end_time: '12:00' }, system);
  db.run("UPDATE events SET status = 'veroeffentlicht' WHERE id IN (?, ?)", ev, ev2);
  const rid = registrations.create({ eventId: ev, personId: tom, matchType: 'auto', source: 'formular', answer: 'ja', wishes: [], remark: 'Komme später', user: system });
  const cookie = await login('lena', 'Aufgebot-2026-x');

  const page = await (await get(`/handy/einsatz/${ev}/anmeldungen`, cookie)).text();
  assert.match(page, /Tom Tambour/);
  assert.match(page, /Komme später/);
  assert.match(page, /Neu eingegangen/);
  assert.match(page, /Teilnehmerliste PDF/);
  assert.match(page, /class="h-nav"[\s\S]*Anfragen[\s\S]*Anmeldungen/, 'Leiste im Einsatz');
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  const ok = await fetch(`${base}/handy/einsatz/${ev}/anmeldung/${rid}/status`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ _csrf: csrf, status: 'bestaetigt', expected: 'neu' }),
  });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Bestätigt/);
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', rid).status, 'bestaetigt');

  // Personen: Liste und eine Person mit allen kommenden Einsätzen
  const list = await (await get('/handy/personen', cookie)).text();
  assert.match(list, new RegExp(`href="/handy/personen/${tom}"`));
  assert.match(list, /class="h-nav"[\s\S]*Einsätze[\s\S]*Personen/, 'Leiste ausserhalb');
  const person = await (await get(`/handy/personen/${tom}`, cookie)).text();
  assert.match(person, /Übung Bruderholz/);
  assert.match(person, /Übung Allschwil/);
  assert.match(person, /über Formular/);
  // Antwort für den zweiten Einsatz direkt bei der Person
  const ans = await fetch(`${base}/handy/einsatz/${ev2}/antwort`, {
    method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ _csrf: csrf, person_id: String(tom), antwort: 'kann', channel: 'muendlich', ansicht: 'person' }),
  });
  const card = await ans.text();
  assert.match(card, new RegExp(`id="e${ev2}"`));
  assert.match(card, /Übung Allschwil/);
  assert.ok(db.one('SELECT 1 FROM registrations WHERE event_id = ? AND person_id = ?', ev2, tom));
});

test('Zurücksetzen stellt den Stand vorher wieder her', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const inquiries = require('../src/services/inquiries');
  const { today, addDays } = require('../src/lib/dates');
  const user = db.one("SELECT * FROM users WHERE username = 'lena'");
  const ev = events.create({ name: 'Übung Rhein', date: addDays(today(), 5), start_time: '09:00', end_time: '12:00' }, system);
  const lastAttempt = (pid) => db.one('SELECT a.id FROM contact_attempts a JOIN inquiries i ON i.id = a.inquiry_id WHERE i.event_id = ? AND i.person_id = ? ORDER BY a.id DESC LIMIT 1', ev, pid).id;

  // Über das Formular angemeldet, aus Versehen «Kann nicht» getippt: Zurücksetzen holt die Anmeldung zurück
  const fia = persons.create({ first_name: 'Fia', last_name: 'Formular', status: 'aktiv' }, system);
  const rid = registrations.create({ eventId: ev, personId: fia, matchType: 'auto', source: 'formular', answer: 'ja', wishes: [], user: system });
  registrations.setStatus(rid, 'bestaetigt', system);
  inquiries.addAttempt(ev, fia, { channel: 'muendlich', result: 'abgesagt' }, user);
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', rid).status, 'zurueckgezogen');
  inquiries.removeAttempt(ev, lastAttempt(fia), user);
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', rid).status, 'bestaetigt');

  // Zweimal «Kann»: Zurücksetzen des zweiten lässt die Anmeldung aus dem ersten stehen
  const kai = persons.create({ first_name: 'Kai', last_name: 'Kann', status: 'aktiv' }, system);
  inquiries.addAttempt(ev, kai, { channel: 'telefon', result: 'zugesagt' }, user);
  inquiries.addAttempt(ev, kai, { channel: 'muendlich', result: 'zugesagt' }, user);
  inquiries.removeAttempt(ev, lastAttempt(kai), user);
  assert.ok(db.one('SELECT 1 FROM registrations WHERE event_id = ? AND person_id = ?', ev, kai), 'Anmeldung bleibt');
  inquiries.removeAttempt(ev, lastAttempt(kai), user);
  assert.equal(db.one('SELECT 1 AS x FROM registrations WHERE event_id = ? AND person_id = ?', ev, kai), undefined, 'erste Zusage zurückgesetzt: Anmeldung weg');
});

test('Von Hand eingetragene Anmeldung lässt sich zurücksetzen, Formular-Anmeldung nicht', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const { today, addDays } = require('../src/lib/dates');
  const ev = events.create({ name: 'Parkdienst Halle', date: addDays(today(), 9), start_time: '08:00', end_time: '12:00' }, system);
  const max = persons.create({ first_name: 'Max', last_name: 'Manuell', status: 'aktiv' }, system);
  const fe = persons.create({ first_name: 'Fee', last_name: 'Formular', status: 'aktiv' }, system);
  const rid = registrations.create({ eventId: ev, personId: max, matchType: 'manuell', source: 'manuell', answer: 'ja', wishes: [], user: system });
  const fid = registrations.create({ eventId: ev, personId: fe, matchType: 'auto', source: 'formular', answer: 'ja', wishes: [], user: system });
  const cookie = await login('lena', 'Aufgebot-2026-x');

  const page = await (await get(`/handy/personen/${max}`, cookie)).text();
  assert.match(page, /Anmeldung zurücksetzen\?/);
  assert.match(page, new RegExp(`name="reg_id" value="${rid}"`));
  assert.doesNotMatch(await (await get(`/handy/personen/${fe}`, cookie)).text(), /hc-reset-btn/, 'Formular: kein Zurücksetzen');

  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  const post = (body) => fetch(`${base}/handy/einsatz/${ev}/zuruecknehmen`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'XMLHttpRequest' },
    body: new URLSearchParams({ _csrf: csrf, ansicht: 'person', ...body }),
  });
  const bad = await post({ person_id: String(fe), reg_id: String(fid) });
  assert.equal(bad.status, 400);
  assert.ok(db.one('SELECT 1 AS x FROM registrations WHERE id = ?', fid), 'Formular-Anmeldung bleibt');
  const ok = await post({ person_id: String(max), reg_id: String(rid) });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Noch nicht gefragt/);
  assert.equal(db.one('SELECT 1 AS x FROM registrations WHERE id = ?', rid), undefined, 'Anmeldung gelöscht');
});

test('Profil: Konto, Darstellung, Ganze Ansicht, Abmelden; Konto-Seiten im Rahmen der Handy-App', async () => {
  const cookie = await login('lena', 'Aufgebot-2026-x');
  const page = await (await get('/handy/profil', cookie)).text();
  for (const t of ['href="/konto/passwort"', 'href="/konto/2fa"', 'action="/konto/darstellung"', 'href="/handy/ganze-ansicht"', 'action="/logout"']) assert.ok(page.includes(t), t);
  assert.match(page, /class="h-nav"[\s\S]*Einsätze[\s\S]*Personen[\s\S]*Profil/);
  assert.doesNotMatch(page, /class="h-foot"/, 'keine Fusszeile mehr');
  const pw = await (await getAs('/konto/passwort', cookie, IPHONE)).text();
  assert.match(pw, /class="h-nav"/, 'Passwort-Seite mit Leiste unten');
  assert.doesNotMatch(pw, /class="sidebar"/);
  assert.match(await (await get('/konto/passwort', cookie)).text(), /class="sidebar"/, 'am PC wie bisher');
});

test('Einsatzleiter haben keine Handy-App', async () => {
  const cookie = await login('leiter', 'Kommando-Lauf-2026');
  assert.equal((await get('/handy', cookie)).status, 403);
  assert.doesNotMatch(await (await get('/', cookie)).text(), /href="\/handy"/);
});
