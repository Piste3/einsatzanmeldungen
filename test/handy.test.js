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

const { client, flashText } = require('./client');
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
async function login(username, password, opts) {
  const c = client(base, opts);
  await c.login(username, password);
  return c;
}
const get = (path, headers = {}) => fetch(`${base}${path}`, { headers, redirect: 'manual' });
// Karte speichern wie die Handy-App: Antwort ist nur die Karte
const XHR = { 'x-requested-with': 'XMLHttpRequest' };

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
  // Die Seite selbst liefert die Browser-App; die Daten nur mit Login
  assert.equal((await get('/handy', { accept: 'text/html' })).status, 200);
  assert.equal((await client(base).get('/handy')).status, 401);
});

test('Handy-App: Einsatz wählen, Antwort eintragen, rückgängig machen', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const { today, addDays } = require('../src/lib/dates');
  const pia = persons.create({ first_name: 'Pia', last_name: 'Planer', status: 'aktiv', mobile: '079 555 44 33' }, system);
  const ev = events.create({ name: 'Übung Hardwald', date: addDays(today(), 2), start_time: '08:00', end_time: '12:00' }, system);
  db.run("UPDATE events SET status = 'veroeffentlicht' WHERE id = ?", ev);
  const c = await login('lena', 'Aufgebot-2026-x');

  const start = await c.get('/handy');
  assert.equal(start.view, 'handy/start');
  assert.ok(start.data.list.some((e) => e.name === 'Übung Hardwald'));
  const page = await c.get(`/handy/einsatz/${ev}`);
  const row = page.data.list.find((r) => r.person_id === pia);
  assert.equal(row.mobile, '079 555 44 33');
  assert.equal(row.label.text, 'Noch nicht gefragt');

  const post = (path, body, headers = XHR) => c.post(`/handy/einsatz/${ev}/${path}`, { person_id: String(pia), ...body }, headers);

  // Kann (mündlich): Karte kommt zurück, Anmeldung entsteht
  const kann = await post('antwort', { antwort: 'kann', channel: 'muendlich' });
  assert.equal(kann.status, 200);
  assert.equal(kann.view, 'handy/_person');
  assert.equal(kann.data.r.answer, 'kann');
  assert.equal(kann.data.r.attempts.at(-1).channel, 'muendlich');
  const reg = db.one('SELECT * FROM registrations WHERE event_id = ? AND person_id = ?', ev, pia);
  assert.equal(reg.source, 'muendlich');
  assert.ok((await c.get(`/handy/einsatz/${ev}?zeige=kann`)).data.list.some((r) => r.person_id === pia));

  // Kann nicht per Telefon: Anmeldung wird zurückgezogen
  const nein = await post('antwort', { antwort: 'kann_nicht', channel: 'telefon' });
  assert.equal(nein.data.r.answer, 'kann_nicht');
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', reg.id).status, 'zurueckgezogen');

  // Falsch getippt: letzten Eintrag rückgängig machen
  const last = db.one('SELECT a.id FROM contact_attempts a JOIN inquiries i ON i.id = a.inquiry_id WHERE i.event_id = ? ORDER BY a.id DESC LIMIT 1', ev);
  const undo = await post('zuruecknehmen', { attempt_id: String(last.id) });
  assert.equal(undo.data.r.answer, 'kann');

  // Ohne Karte: Weiterleitung zurück zur Liste an die Stelle der Person
  const plain = await post('antwort', { antwort: 'unsicher', channel: 'muendlich', back: `/handy/einsatz/${ev}?zeige=alle` }, {});
  assert.equal(plain.redirect, `/handy/einsatz/${ev}?zeige=alle#p${pia}`);
  const outside = await post('antwort', { antwort: 'unsicher', back: 'https://example.com/' }, {});
  assert.equal(outside.redirect, `/handy/einsatz/${ev}#p${pia}`);

  // Unbekannte Antwort: Fehlermeldung als Text
  const bad = await post('antwort', { antwort: 'vielleicht' });
  assert.equal(bad.status, 400);
  assert.match(await bad.res.text(), /Antwort wählen/);
});

test('Auf dem Handy kommt immer die Handy-App', async () => {
  // Die Browser-App fragt die Sitzung: Handy erkannt? «Ganze Ansicht» aktiv?
  const phone = await login('lena', 'Aufgebot-2026-x', { userAgent: IPHONE });
  let s = await phone.refresh();
  assert.equal(s.phone, true);
  assert.equal(s.pcView, false);
  const tablet = await login('lena', 'Aufgebot-2026-x', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' });
  assert.equal((await tablet.refresh()).phone, false);
  assert.equal((await (await login('lena', 'Aufgebot-2026-x')).refresh()).phone, false);
  // «Ganze Ansicht» schaltet für eine Stunde um, die Handy-App schaltet zurück
  const pc = await phone.get('/handy/ganze-ansicht');
  assert.equal(pc.redirect, '/');
  assert.match(pc.headers.get('set-cookie'), /Max-Age=3600/);
  s = await phone.refresh();
  assert.equal(s.pcView, true);
  assert.match((await phone.get('/handy')).headers.get('set-cookie') || '', /kkb_ansicht=;/);
  assert.equal((await phone.refresh()).pcView, false);
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
  const c = await login('lena', 'Aufgebot-2026-x');

  const page = await c.get(`/handy/einsatz/${ev}/anmeldungen`);
  assert.equal(page.view, 'handy/anmeldungen');
  const r = page.data.list.find((x) => x.id === rid);
  assert.equal(r.remark, 'Komme später');
  assert.equal(r.status, 'neu');
  const ok = await c.post(`/handy/einsatz/${ev}/anmeldung/${rid}/status`, { status: 'bestaetigt', expected: 'neu' }, XHR);
  assert.equal(ok.status, 200);
  assert.equal(ok.view, 'handy/_registration');
  assert.equal(ok.data.r.status, 'bestaetigt');
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', rid).status, 'bestaetigt');

  // Personen: Liste und eine Person mit allen kommenden Einsätzen
  assert.ok((await c.get('/handy/personen')).data.list.some((p) => p.id === tom));
  const person = await c.get(`/handy/personen/${tom}`);
  const names = person.data.cards.map((x) => x.e.name);
  assert.ok(names.includes('Übung Bruderholz'));
  assert.ok(names.includes('Übung Allschwil'));
  assert.equal(person.data.cards.find((x) => x.e.id === ev).r.reg_source, 'formular');
  // Antwort für den zweiten Einsatz direkt bei der Person
  const ans = await c.post(`/handy/einsatz/${ev2}/antwort`, { person_id: String(tom), antwort: 'kann', channel: 'muendlich', ansicht: 'person' }, XHR);
  assert.equal(ans.data.mode, 'person');
  assert.equal(ans.data.cardEvent.name, 'Übung Allschwil');
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
  const c = await login('lena', 'Aufgebot-2026-x');

  // Karte: Anmeldung von Hand ohne Kontaktversuch (Zurücksetzen löscht sie), Formular-Anmeldung nicht
  const card = (await c.get(`/handy/personen/${max}`)).data.cards.find((x) => x.e.id === ev).r;
  assert.equal(card.reg_id, rid);
  assert.equal(card.reg_source, 'manuell');
  assert.equal(card.attempts.length, 0);
  assert.equal((await c.get(`/handy/personen/${fe}`)).data.cards.find((x) => x.e.id === ev).r.reg_source, 'formular');

  const post = (body) => c.post(`/handy/einsatz/${ev}/zuruecknehmen`, { ansicht: 'person', ...body }, XHR);
  const bad = await post({ person_id: String(fe), reg_id: String(fid) });
  assert.equal(bad.status, 400);
  assert.ok(db.one('SELECT 1 AS x FROM registrations WHERE id = ?', fid), 'Formular-Anmeldung bleibt');
  const ok = await post({ person_id: String(max), reg_id: String(rid) });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.r.label.text, 'Noch nicht gefragt');
  assert.equal(db.one('SELECT 1 AS x FROM registrations WHERE id = ?', rid), undefined, 'Anmeldung gelöscht');
});

test('Interne Bemerkung zur Antwort', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const { today, addDays } = require('../src/lib/dates');
  const ev = events.create({ name: 'Übung Notiz', date: addDays(today(), 6), start_time: '08:00', end_time: '12:00' }, system);
  const ida = persons.create({ first_name: 'Ida', last_name: 'Intern', status: 'aktiv' }, system);
  const c = await login('lena', 'Aufgebot-2026-x');
  const post = (path, body) => c.post(`/handy/einsatz/${ev}/${path}`, { person_id: String(ida), ...body }, XHR);
  let card = (await post('antwort', { antwort: 'kann', channel: 'muendlich' })).data.r;
  const attempt = card.attempts.at(-1).id;
  assert.equal(card.attempts.at(-1).note, null);
  card = (await post('notiz', { attempt_id: String(attempt), note: '  kommt erst ab 10 Uhr ' })).data.r;
  assert.equal(card.attempts.at(-1).note, 'kommt erst ab 10 Uhr');
  assert.equal(db.one('SELECT note FROM contact_attempts WHERE id = ?', attempt).note, 'kommt erst ab 10 Uhr');
  assert.equal(db.one('SELECT internal_note FROM registrations WHERE event_id = ? AND person_id = ?', ev, ida).internal_note, 'kommt erst ab 10 Uhr', 'auch in der Anmeldung');
  // Am PC im Reiter Anfragen beim Versuch sichtbar
  const pcRow = (await c.get(`/einsaetze/${ev}/anfragen?status=`)).data.list.find((r) => r.person_id === ida);
  assert.equal(pcRow.attempts.at(-1).note, 'kommt erst ab 10 Uhr');
  // Leeren
  await post('notiz', { attempt_id: String(attempt), note: '' });
  assert.equal(db.one('SELECT note FROM contact_attempts WHERE id = ?', attempt).note, null);
  assert.equal(db.one('SELECT internal_note FROM registrations WHERE event_id = ? AND person_id = ?', ev, ida).internal_note, null);
  const bad = await post('notiz', { attempt_id: '999999', note: 'x' });
  assert.equal(bad.status, 400);
});

test('Rückgängig: letzte eigene Aktion spurlos zurücknehmen', async () => {
  const db = require('../src/db');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const { today, addDays } = require('../src/lib/dates');
  const ev = events.create({ name: 'Übung Spurlos', date: addDays(today(), 8), start_time: '08:00', end_time: '12:00' }, system);
  const uwe = persons.create({ first_name: 'Uwe', last_name: 'Undo', status: 'aktiv' }, system);
  const fia = persons.create({ first_name: 'Fia', last_name: 'Fest', status: 'aktiv' }, system);
  const fid = registrations.create({ eventId: ev, personId: fia, matchType: 'auto', source: 'formular', answer: 'ja', wishes: [], user: system });
  const c = await login('lena', 'Aufgebot-2026-x');
  const post = (path, body, headers = XHR) => c.post(path, body, headers);
  const auditBefore = db.one('SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ?', ev).n;

  // «Kann» erzeugt Anfrage, Versuch, Anmeldung und Verlauf. Rückgängig entfernt alles.
  const res = await post(`/handy/einsatz/${ev}/antwort`, { person_id: String(uwe), antwort: 'kann', channel: 'muendlich' });
  assert.match(res.data.handySteps.undo, /«Kann» für Uwe Undo/);
  assert.ok(db.one('SELECT 1 AS x FROM registrations WHERE event_id = ? AND person_id = ?', ev, uwe));
  assert.match((await c.get(`/handy/einsatz/${ev}`)).data.handySteps.undo, /«Kann» für Uwe Undo/);
  const back = await post('/handy/rueckgaengig', { back: `/handy/einsatz/${ev}` }, {});
  assert.equal(back.redirect, `/handy/einsatz/${ev}`);
  assert.equal(db.one('SELECT 1 AS x FROM registrations WHERE event_id = ? AND person_id = ?', ev, uwe), undefined);
  assert.equal(db.one('SELECT 1 AS x FROM inquiries WHERE event_id = ? AND person_id = ?', ev, uwe), undefined);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ?', ev).n, auditBefore, 'keine Spur im Verlauf');

  // «Kann nicht» zieht die Formular-Anmeldung zurück. Rückgängig holt sie mit Version und Status zurück.
  const before = db.one('SELECT * FROM registrations WHERE id = ?', fid);
  await post(`/handy/einsatz/${ev}/antwort`, { person_id: String(fia), antwort: 'kann_nicht', channel: 'telefon' });
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', fid).status, 'zurueckgezogen');
  await post('/handy/rueckgaengig', {}, {});
  assert.deepEqual(db.one('SELECT * FROM registrations WHERE id = ?', fid), before);
  assert.equal(db.one('SELECT 1 AS x FROM inquiries WHERE event_id = ? AND person_id = ?', ev, fia), undefined);

  // Status in «Anmeldungen» setzen und zurücknehmen
  await post(`/handy/einsatz/${ev}/anmeldung/${fid}/status`, { status: 'bestaetigt', expected: before.status });
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', fid).status, 'bestaetigt');
  await post('/handy/rueckgaengig', {}, {});
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', fid).status, before.status);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ?', ev).n, auditBefore);

  // Wiederholen stellt die Bestätigung samt Verlauf wieder her, Rückgängig nimmt sie wieder zurück
  assert.match((await c.get(`/handy/einsatz/${ev}`)).data.handySteps.redo, /^«Bestätigt» für/);
  await post('/handy/wiederholen', {}, {});
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', fid).status, 'bestaetigt');
  assert.ok(db.one('SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ?', ev).n > auditBefore, 'Verlauf wieder da');
  await post('/handy/rueckgaengig', {}, {});
  assert.equal(db.one('SELECT status FROM registrations WHERE id = ?', fid).status, before.status);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM audit_log WHERE event_id = ?', ev).n, auditBefore);

  // Hat danach jemand anderes geändert, wird nichts überschrieben
  await post(`/handy/einsatz/${ev}/antwort`, { person_id: String(uwe), antwort: 'unsicher', channel: 'muendlich' });
  const other = db.one("SELECT * FROM users WHERE username = 'leiter'");
  require('../src/services/inquiries').addAttempt(ev, uwe, { channel: 'telefon', result: 'zugesagt' }, other);
  const refused = await post('/handy/rueckgaengig', {}, {});
  assert.ok(refused.redirect);
  assert.equal(db.one('SELECT status FROM inquiries WHERE event_id = ? AND person_id = ?', ev, uwe).status, 'zugesagt', 'Änderung von anderen bleibt');
  assert.match(flashText(refused), /Rückgängig geht nicht mehr/);
});

test('Filter: Zeitraum und Entwürfe einstellen', async () => {
  const db = require('../src/db');
  const events = require('../src/services/events');
  const { today, addDays } = require('../src/lib/dates');
  const weit = events.create({ name: 'Tattoo Parking', date: addDays(today(), 280), start_time: '18:00', end_time: '23:00' }, system);
  const nah = events.create({ name: 'Probe Nah', date: addDays(today(), 4), start_time: '18:00', end_time: '21:00' }, system);
  void nah;
  db.run("UPDATE events SET status = 'veroeffentlicht' WHERE id = ?", weit);
  const vorbei = events.create({ name: 'Vorbei Alt', date: addDays(today(), -3), start_time: '18:00', end_time: '21:00' }, system);
  db.run("UPDATE events SET status = 'veroeffentlicht' WHERE id = ?", vorbei);
  const c = await login('lena', 'Aufgebot-2026-x');
  const names = (d) => d.list.map((e) => e.name);

  // Standard: 6 Monate mit Entwürfen. Der weite Einsatz fehlt, ein Hinweis zeigt ihn als ausgeblendet.
  let start = (await c.get('/handy')).data;
  assert.equal(start.f.label, 'Nächste 6 Monate');
  assert.ok(names(start).includes('Probe Nah'));
  assert.ok(!names(start).includes('Tattoo Parking'));
  assert.ok(start.hidden >= 1);

  assert.equal((await c.get('/handy/filter')).data.f.zeit, '6');
  const res = await c.post('/handy/filter', { zeit: '12', entwurf: '0' });
  assert.equal(res.redirect, '/handy');
  // Gespeichert pro Benutzer: gilt auch in einer neuen Anmeldung (anderes Gerät) ohne Cookie
  const both = await login('lena', 'Aufgebot-2026-x');
  start = (await both.get('/handy')).data;
  assert.equal(start.f.label, 'Nächste 12 Monate · ohne Entwürfe');
  assert.ok(names(start).includes('Tattoo Parking'));
  assert.ok(!names(start).includes('Probe Nah'), 'Entwurf ausgeblendet');
  assert.ok(!names(start).includes('Vorbei Alt'), 'vergangene nie');
  assert.equal((await both.get('/handy/filter')).data.f.zeit, '12');
  assert.equal((await both.get('/handy/personen')).data.f.label, 'Nächste 12 Monate · ohne Entwürfe');
  // Zurück auf den Standard für die übrigen Tests
  db.run("DELETE FROM user_filters WHERE page = 'handy'");
});

test('Profil: Zwei-Faktor-Stand, Darstellung, Abmelden', async () => {
  const c = await login('lena', 'Aufgebot-2026-x');
  const page = await c.get('/handy/profil');
  assert.equal(page.view, 'handy/profil');
  assert.equal(page.data.twofaOn, false);
  assert.ok((await c.post('/konto/darstellung', { theme: 'dark' })).redirect);
  assert.equal((await c.refresh()).user.theme, 'dark');
  await c.post('/logout');
  assert.equal((await c.get('/handy/profil')).status, 401);
});

test('Einsatzleiter haben keine Handy-App', async () => {
  const c = await login('leiter', 'Kommando-Lauf-2026', { userAgent: IPHONE });
  assert.equal((await c.get('/handy')).status, 403);
  assert.equal((await c.refresh()).phone, false, 'auch auf dem Handy die Einsatzleiter-Ansicht');
});
