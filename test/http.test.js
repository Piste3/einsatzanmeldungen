'use strict';
// Server über HTTP: Browser-App, Schnittstelle /api/v1, Rollen, Listen und Exporte
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const { client, flashText } = require('./client');
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
  const c = client(base);
  c.res = await c.login(username, password);
  return c;
}
const raw = (path, headers = {}) => fetch(`${base}${path}`, { headers, redirect: 'manual' });
const csvLines = async (r) => (await r.res.text()).replace(/^﻿/, '').trim().split(/\r?\n/);
const json = (r) => JSON.stringify(r.json);

test('Browser-App: Seiten für alle, Daten nur mit Anmeldung', async () => {
  for (const p of ['/', '/login', '/einsaetze/5', '/handy']) {
    const r = await raw(p, { accept: 'text/html' });
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /<div id="app">/, p);
  }
  assert.equal((await raw('/login')).headers.get('cache-control'), 'no-store', 'Seiten nicht aus dem Browser-Cache');
  // Stylesheets mit Version in der Adresse (nach einem Update lädt der Browser sie neu)
  assert.match(await (await raw('/', { accept: 'text/html' })).text(), /\/static\/css\/app\.css\?v=[0-9a-f]{10}"/);
  const form = await raw('/forms/anmeldung');
  assert.equal(form.status, 200);
  assert.doesNotMatch(await form.text(), /<div id="app">/, 'Formular: eigener, kleiner Einstieg');
  // Ohne Login: Schnittstelle antwortet 401, keine Seite
  const anon = client(base);
  assert.equal((await anon.get('/')).status, 401);
  assert.equal((await anon.get('/einsaetze')).status, 401);
  // Fehlende Dateien: 404 statt Fehler
  assert.equal((await raw('/assets/gibt-es-nicht.js')).status, 404);
  assert.equal((await raw('/handbuch/bilder/x.png')).status, 302, 'Bilder des Handbuchs nur mit Login');
});

test('Anmeldung und Rollen', async () => {
  const bad = await login('admin', 'falsch-falsch');
  assert.equal(bad.res.status, 401);

  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.equal(admin.res.redirect, '/');
  assert.equal((await admin.get('/')).status, 200);
  for (const p of ['/verwaltung/benutzer/neu', '/verwaltung/benutzer/1', '/verwaltung/benutzer']) assert.equal((await admin.get(p)).status, 200, p);
  // Einstellungen öffnen beim ersten Reiter, nicht bei Benutzer
  assert.equal((await admin.get('/verwaltung')).redirect, '/verwaltung/listen');

  const lena = await login('lena', 'Aufgebot-2026-x');
  assert.equal((await lena.get('/einsaetze')).status, 200);
  const no = await lena.get('/verwaltung/benutzer');
  assert.equal(no.status, 403);
  assert.equal(no.view, 'pages/error');
});

test('Erstes Login mit Startpasswort verlangt neues Passwort', async () => {
  const neu = await login('neu', 'Erstes-Kennwort-99');
  assert.equal(neu.res.redirect, '/konto/passwort');
  assert.equal((await neu.get('/')).redirect, '/konto/passwort');
  assert.equal((await neu.get('/konto/passwort')).view, 'auth/password');
});

test('POST ohne CSRF-Token wird abgelehnt', async () => {
  const admin = await login('admin', 'Chef-Passwort-2026');
  const r = await fetch(`${base}/api/v1/einsaetze`, {
    method: 'POST', redirect: 'manual',
    headers: { cookie: admin.cookie(), 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'X', date: '2030-01-01' }),
  });
  assert.equal(r.status, 403);
});

test('Konto wird nach 5 Fehlversuchen gesperrt', async () => {
  for (let i = 0; i < 5; i++) await login('lena', 'falsch-falsch');
  const locked = await login('lena', 'Aufgebot-2026-x');
  assert.equal(locked.res.status, 401);
});

test('Formular darf nur in erlaubte Seiten eingebettet werden', async () => {
  const r = await raw('/forms/anmeldung');
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'self' https:\/\/\*\.clubdesk\.com/);
  assert.equal(r.headers.get('x-frame-options'), null);
  const app = await raw('/login');
  assert.match(app.headers.get('content-security-policy') || app.headers.get('x-frame-options') || '', /frame-ancestors 'none'|DENY/i);
});

test('Blockier-Meldungen des Browsers werden angenommen', async () => {
  const r = await fetch(`${base}/forms/csp-bericht`, {
    method: 'POST', headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'violated-directive': 'frame-ancestors', 'blocked-uri': 'https://example.org', 'document-uri': 'https://x/forms/anmeldung' } }),
  });
  assert.equal(r.status, 204);
  assert.match((await raw('/forms/anmeldung')).headers.get('content-security-policy'), /report-uri \/forms\/csp-bericht/);
});

test('Bestätigungsmail: Seite, Vorschau und Speichern (nur Admin)', async () => {
  const settings = require('../src/services/settings');
  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.equal((await admin.get('/verwaltung/bestaetigungsmail')).status, 200);
  const post = (action) => admin.post('/verwaltung/bestaetigungsmail', { enabled: '1', subject: 'Bestätigt: {{einsatz.name}}', body: 'Hallo {{person.vorname}}', action });
  const preview = await post('preview');
  assert.equal(preview.status, 200);
  assert.equal(preview.view, 'admin/confirmation');
  assert.notEqual(settings.get('confirmation').subject, 'Bestätigt: {{einsatz.name}}');
  assert.ok((await post('save')).redirect);
  assert.equal(settings.get('confirmation').subject, 'Bestätigt: {{einsatz.name}}');
  // formatierte Vorlage (HTML aus dem Editor) wird bereinigt gespeichert
  const rich = await admin.post('/verwaltung/bestaetigungsmail', { enabled: '1', subject: 'S', body: '<div>Hallo <b>{{person.vorname}}</b><script>x</script></div>', body_format: 'html', action: 'save' });
  assert.ok(rich.redirect);
  assert.equal(settings.get('confirmation').format, 'html');
  assert.equal(settings.get('confirmation').body, '<div>Hallo <b>{{person.vorname}}</b></div>');
  // Der Editor bekommt den Inhalt als fertigen Wert
  assert.match((await admin.get('/verwaltung/bestaetigungsmail')).data.editorValue, /<b>/);
  const neu = await login('neu', 'Erstes-Kennwort-99');
  const no = await neu.get('/verwaltung/bestaetigungsmail');
  assert.ok(no.status !== 200 || no.redirect, 'nur Admin');
  assert.notEqual(no.view, 'admin/confirmation');
});

test('System-Seite: nur Admin, Update ohne Starter wird abgelehnt', async () => {
  const admin = await login('admin', 'Chef-Passwort-2026');
  const page = await admin.get('/verwaltung/system');
  assert.equal(page.status, 200);
  assert.equal(page.data.st.canRestart, false, 'alter Start ohne Starter');
  const r = await admin.post('/verwaltung/system/neustart');
  assert.equal(r.status, 400, 'Fehlermeldung statt Neustart');
  assert.match(JSON.stringify(r.json), /alten Startskript/);
});

test('Standard-Anmeldefrage ist bei neuen Einsätzen vorausgewählt', async () => {
  const settings = require('../src/services/settings');
  const db = require('../src/db');
  const admin = await login('admin', 'Chef-Passwort-2026');
  const q = db.one("SELECT * FROM question_templates WHERE name = 'Schichtauswahl'");
  const save = (def) => admin.post('/verwaltung/vorlagen/fragen', { default_question: def });
  assert.ok((await save(String(q.id))).redirect);
  assert.equal(settings.get('default_question_template'), q.id);
  let e = (await admin.get('/einsaetze/neu')).data.e;
  assert.equal(Number(e.question_template_id), q.id);
  assert.equal(e.question_text, 'Für welche Schichten kannst du?');
  await save('');
  assert.equal(settings.get('default_question_template'), null);
  e = (await admin.get('/einsaetze/neu')).data.e;
  assert.ok(!e.question_template_id);
});

test('Teilnehmerliste: nach Rang, mit Mobil und Essenseinschränkungen, als Seite, Excel und CSV', async () => {
  const db = require('../src/db');
  const { system } = require('./helpers');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const { today, addDays } = require('../src/lib/dates');
  const rank = (s) => db.one('SELECT id FROM ranks WHERE short = ?', s).id;
  const sdt = persons.create({ first_name: 'Sina', last_name: 'Soldat', status: 'aktiv', rank_id: rank('Sdt'), mobile: '079 111 22 33', diet_category: 'vegetarisch' }, system);
  const hptm = persons.create({ first_name: 'Hans', last_name: 'Haupt', status: 'aktiv', rank_id: rank('Hptm'), mobile: '079 999 88 77', diet_category: 'allergie', diet_text: 'Nüsse' }, system);
  const wm = persons.create({ first_name: 'Willi', last_name: 'Wacht', status: 'aktiv', rank_id: rank('Wm') }, system);
  const weg = persons.create({ first_name: 'Abi', last_name: 'Gemeldet', status: 'aktiv' }, system);
  const ev = events.create({ name: 'Zolli-Fest', date: addDays(today(), 3), start_time: '09:00', end_time: '17:00' }, system);
  const reg = (pid) => registrations.create({ eventId: ev, personId: pid, matchType: 'auto', source: 'manuell', wishes: [], user: system });
  reg(sdt); reg(wm);
  registrations.setStatus(reg(hptm), 'bestaetigt', system);
  registrations.setStatus(reg(weg), 'zurueckgezogen', system);

  // eigene Aufgebotsstelle (lena ist durch den Sperr-Test oben gesperrt)
  await users.create({ username: 'mara', display_name: 'Mara', role: 'aufgebotsstelle', password: 'Aufgebot-2026-m', must_change_password: false }, null);
  const mara = await login('mara', 'Aufgebot-2026-m');
  const names = (d) => d.list.map((r) => `${r.first_name} ${r.last_name}`);
  const page = (await mara.get(`/einsaetze/${ev}/teilnehmerliste`)).data;
  assert.deepEqual(names(page), ['Sina Soldat', 'Willi Wacht', 'Hans Haupt'], 'Standard: tiefster Rang zuerst; Abmeldungen nicht auf der Liste');
  assert.deepEqual(names((await mara.get(`/einsaetze/${ev}/teilnehmerliste?sort=rang_ab`)).data), ['Hans Haupt', 'Willi Wacht', 'Sina Soldat'], 'umgeschaltet: höchster Rang zuerst');
  const hans = page.list.find((r) => r.last_name === 'Haupt');
  assert.equal(hans.mobile, '079 999 88 77');
  assert.ok(hans.diet.visible, 'Aufgebotsstelle sieht die Angaben der Angemeldeten');
  assert.deepEqual([hans.diet.category, hans.diet.text], ['Allergie', 'Nüsse']);
  assert.deepEqual(page.summary, [['Allergie', 1], ['vegetarisch', 1], ['ohne Einschränkung', 1]]);

  assert.deepEqual(names((await mara.get(`/einsaetze/${ev}/teilnehmerliste?sort=rang_ab&umfang=bestaetigt`)).data), ['Hans Haupt'], 'nur bestätigte');

  const csv = await mara.get(`/einsaetze/${ev}/teilnehmerliste?format=csv`);
  assert.match(csv.headers.get('content-disposition'), /Teilnehmerliste_Zolli-Fest/);
  const lines = await csvLines(csv);
  assert.match(lines[0], /Nr\.;Rang;Nachname;Vorname;Mobil;Essenseinschränkung;Details;Status/);
  assert.match(lines[1], /^1;Sdt;Soldat;Sina;079 111 22 33;vegetarisch;;Neu$/);
  assert.match(lines[3], /^3;Hptm;Haupt;Hans;079 999 88 77;Allergie;Nüsse;Bestätigt$/);
  assert.equal(lines.length, 4);
  const xlsx = await mara.get(`/einsaetze/${ev}/teilnehmerliste?format=xlsx`);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  const pdf = await mara.get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /^inline; filename="Teilnehmerliste_Zolli-Fest_/);
  const body = Buffer.from(await pdf.res.arrayBuffer()).toString('latin1');
  assert.match(body, /^%PDF-1\.4/);
  assert.match(body, /\/Count 1 /);
  assert.match(body, /%%EOF\n$/);
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND action = 'export'", ev), 'Export steht im Verlauf');
});

test('Einsatzleiter: sieht nur freigegebene Einsätze, nur lesen', async () => {
  const db = require('../src/db');
  const { system } = require('./helpers');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const { today, addDays } = require('../src/lib/dates');
  const pia = persons.create({ first_name: 'Pia', last_name: 'Planer', status: 'aktiv', mobile: '079 555 44 33', diet_category: 'vegan' }, system);
  const ev = events.create({ name: 'Basler Herbstlauf', date: addDays(today(), 4), start_time: '08:00', end_time: '12:00', internal_note: 'Nur intern: Budget 500' }, system);
  const other = events.create({ name: 'Geheimer Anlass', date: addDays(today(), 6), start_time: '08:00', end_time: '12:00' }, system);
  registrations.create({ eventId: ev, personId: pia, matchType: 'auto', source: 'manuell', wishes: [], user: system });

  const { id: leaderId } = await users.create({ username: 'leiter', display_name: 'Leo Leiter', role: 'einsatzleiter', password: 'Kommando-Lauf-2026', must_change_password: false }, null);
  await users.create({ username: 'auf2', display_name: 'Aufgebot Zwei', role: 'aufgebotsstelle', password: 'Aufgebot-2026-z', must_change_password: false }, null);
  const leo = await login('leiter', 'Kommando-Lauf-2026');
  const auf = await login('auf2', 'Aufgebot-2026-z');

  // vor der Freigabe: nichts zu sehen
  const home = await leo.get('/');
  assert.equal(home.view, 'leader/home');
  assert.doesNotMatch(json(home), /Basler Herbstlauf/);
  assert.deepEqual(home.json.nav, {}, 'keine Zähler für Personen, Klärungen');
  assert.equal((await leo.get(`/einsaetze/${ev}`)).status, 403);
  for (const p of ['/einsaetze', '/personen', '/rueckmeldungen', '/klaerungen', '/suche?q=pia', `/einsaetze/${ev}/anmeldungen`, `/einsaetze/${ev}/teilnehmerliste?format=csv`, '/verwaltung', '/handy']) {
    assert.equal((await leo.get(p)).status, 403, p);
  }
  const leoBook = await leo.get('/handbuch');
  assert.match(leoBook.json.title, /Handbuch für Einsatzleiter/, 'Einsatzleiter sehen ihr eigenes Handbuch');
  assert.doesNotMatch(json(leoBook), /Klärungen/, 'nicht das volle Handbuch');
  assert.ok((await leo.get('/handbuch/einsatzleiter')).redirect);
  assert.equal((await leo.get('/konto/passwort')).status, 200);

  // Aufgebotsstelle: volles Handbuch, Einsatzleiter-Handbuch zum Nachschauen
  const fullBook = await auf.get('/handbuch');
  assert.match(json(fullBook), /Klärungen/);
  assert.match(json(await auf.get('/handbuch/einsatzleiter')), /Was du als Einsatzleiter siehst/);

  // «Als PDF»: das gestaltete PDF, Einsatzleiter bekommen ihres
  assert.equal(fullBook.data.pdfHref, '/handbuch/pdf');
  for (const [path, who, file] of [
    ['/handbuch/pdf', auf, 'KKB-Einsatzplaner_Handbuch.pdf'],
    ['/handbuch/einsatzleiter/pdf', auf, 'KKB-Einsatzplaner_Handbuch_Einsatzleiter.pdf'],
    ['/handbuch/pdf', leo, 'KKB-Einsatzplaner_Handbuch_Einsatzleiter.pdf'],
  ]) {
    const r = await who.get(path);
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.match(r.headers.get('content-disposition'), new RegExp(`inline; filename="${file}"`));
    assert.equal(Buffer.from(await r.res.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
  }

  // Aufgebotsstelle gibt frei
  const page = (await auf.get(`/einsaetze/${ev}`)).data;
  assert.ok(page.leaderCandidates.some((u) => u.id === leaderId && u.display_name === 'Leo Leiter'));
  assert.ok((await auf.post(`/einsaetze/${ev}/einsatzleiter`, { user_id: String(leaderId) })).redirect);
  assert.ok(db.one('SELECT 1 FROM event_leaders WHERE event_id = ? AND user_id = ?', ev, leaderId));
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND action = 'leader_grant'", ev), 'Freigabe steht im Verlauf');

  // nach der Freigabe: Einsatz mit Angaben und Teilnehmern, aber ohne interne Bemerkung
  assert.match(json(await leo.get('/')), /Basler Herbstlauf/);
  const view = await leo.get(`/einsaetze/${ev}`);
  assert.equal(view.view, 'leader/event');
  const p = view.data.list.find((r) => r.person_id === pia);
  assert.equal(p.mobile, '079 555 44 33');
  assert.equal(p.diet.category, 'vegan', 'Essenseinschränkung beim anstehenden freigegebenen Einsatz sichtbar');
  assert.doesNotMatch(json(view), /Budget 500/, 'keine interne Bemerkung');
  const csv = await leo.get(`/einsaetze/${ev}/teilnehmerliste?format=csv`);
  assert.equal(csv.status, 200);
  assert.match(await csv.res.text(), /Planer;Pia;079 555 44 33;vegan/);
  assert.equal((await leo.get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`)).headers.get('content-type'), 'application/pdf');
  assert.equal((await leo.get(`/einsaetze/${ev}/teilnehmerliste`)).redirect, `/einsaetze/${ev}`);
  assert.equal((await leo.get(`/einsaetze/${other}`)).status, 403, 'andere Einsätze bleiben gesperrt');
  assert.equal((await leo.get(`/einsaetze/${ev}/schichten`)).status, 403);

  // Einsatzleiter darf nichts ändern
  assert.equal((await leo.post(`/einsaetze/${ev}/status`, { status: 'abgesagt' })).status, 403);
  assert.equal((await leo.post(`/einsaetze/${ev}/einsatzleiter`, { user_id: String(leaderId) })).status, 403);
  assert.equal(db.one('SELECT status FROM events WHERE id = ?', ev).status, 'entwurf');

  // Freigabe entfernen
  assert.ok((await auf.post(`/einsaetze/${ev}/einsatzleiter/${leaderId}/entfernen`)).redirect);
  assert.equal((await leo.get(`/einsaetze/${ev}`)).status, 403);
});

test('Externe Abteilungen: mit Anzahl erfassen, zählen in der Besetzung, stehen auf der Teilnehmerliste', async () => {
  const db = require('../src/db');
  const { system } = require('./helpers');
  const events = require('../src/services/events');
  const { today, addDays } = require('../src/lib/dates');
  const ev = events.create({ name: 'Basler Herbstlauf', date: addDays(today(), 4), start_time: '08:00', end_time: '12:00', target_count: 10 }, system);
  events.addShift(ev, { name: 'Abend', start: '18:00', end: '22:00', target_count: 4 }, system);
  const [tag, abend] = events.get(ev).shifts;

  await users.create({ username: 'ext', display_name: 'Ext', role: 'aufgebotsstelle', password: 'Aufgebot-2026-e', must_change_password: false }, null);
  const ext = await login('ext', 'Aufgebot-2026-e');
  assert.ok(Array.isArray((await ext.get(`/einsaetze/${ev}`)).data.externals));
  // Formularfelder wie im Browser: gleiche Namen mehrfach = Liste
  const post = (path, fields) => {
    const body = {};
    for (const [k, v] of fields) body[k] = k in body ? [].concat(body[k], v) : v;
    return ext.post(path, body);
  };

  // neue Abteilung per Name (wird in die Liste aufgenommen), nur Tagschicht
  assert.ok((await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Feuerwehr Riehen'], ['person_count', '6'], ['shift_ids', String(tag.id)], ['contact', 'Hptm Muster 079 555 44 33']])).redirect);
  // gleicher Name anders geschrieben = gleiche Abteilung; alle Schichten
  assert.ok((await post(`/einsaetze/${ev}/externe`, [['unit_name', 'feuerwehr riehen'], ['person_count', '2'], ['shift_ids', String(tag.id)], ['shift_ids', String(abend.id)]])).redirect);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM external_units').n, 1);
  // ungültig: keine Anzahl, keine Schicht
  assert.equal((await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Samariter'], ['person_count', '0'], ['shift_ids', String(tag.id)]])).status, 400);
  assert.equal((await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Samariter'], ['person_count', '3']])).status, 400);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM event_externals WHERE event_id = ?', ev).n, 2);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM external_units').n, 1, 'abgelehnte Eingaben legen keine Abteilung an');

  let st = events.stats(events.get(ev));
  assert.deepEqual(st.shifts.map((s) => [s.ist, s.extern]), [[8, 8], [2, 2]]);
  assert.equal(JSON.parse(db.one('SELECT shift_ids FROM event_externals WHERE person_count = 2').shift_ids).length, 0, 'alle angekreuzt = ganzer Einsatz');

  // ändern und Verlauf
  const x = db.one('SELECT id FROM event_externals WHERE person_count = 6');
  assert.ok((await post(`/einsaetze/${ev}/externe/${x.id}`, [['unit_name', 'Feuerwehr Riehen'], ['person_count', '7'], ['shift_ids', String(tag.id)], ['contact', 'Hptm Muster 079 555 44 33'],
    ['diet_count', '2'], ['diet_category', 'vegetarisch'], ['diet_text', ''],
    ['diet_count', '1'], ['diet_category', 'allergie'], ['diet_text', 'Nüsse'],
    ['diet_count', ''], ['diet_category', ''], ['diet_text', '']])).redirect);
  assert.deepEqual(JSON.parse(db.one('SELECT diets FROM event_externals WHERE id = ?', x.id).diets), [{ count: 2, category: 'vegetarisch', text: '' }, { count: 1, category: 'allergie', text: 'Nüsse' }]);
  // mehr Einschränkungen als Personen: abgelehnt, alte Angaben bleiben
  await post(`/einsaetze/${ev}/externe/${x.id}`, [['unit_name', 'Feuerwehr Riehen'], ['person_count', '7'], ['shift_ids', String(tag.id)], ['diet_count', '8'], ['diet_category', 'vegan'], ['diet_text', '']]);
  assert.match(db.one('SELECT diets FROM event_externals WHERE id = ?', x.id).diets, /Nüsse/);
  st = events.stats(events.get(ev));
  assert.equal(st.shifts[0].ist, 9);
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND entity_type = 'external' AND summary LIKE '%Anzahl 6 → 7%Essenseinschränkungen%'", ev));

  const tl = (await ext.get(`/einsaetze/${ev}/teilnehmerliste`)).data;
  assert.equal(tl.list.length, 0);
  assert.equal(tl.extTotal, 9);
  const riehen = tl.exts.find((e) => e.unit_name === 'Feuerwehr Riehen');
  assert.equal(riehen.contact, 'Hptm Muster 079 555 44 33');
  assert.deepEqual(riehen.dietList.map((d) => [d.count, d.label]), [[2, 'vegetarisch'], [1, 'Allergie']]);
  assert.deepEqual(tl.summary, [['vegetarisch', 2], ['Allergie', 1], ['ohne Einschränkung', 4], ['extern (keine Angaben)', 2]]);
  assert.equal((await ext.get(`/einsaetze/${ev}/teilnehmerliste?schicht=${abend.id}`)).data.extTotal, 2);
  const csv = await csvLines(await ext.get(`/einsaetze/${ev}/teilnehmerliste?format=csv`));
  assert.match(csv[0], /^Nr\.;Anzahl;Rang;Nachname/);
  assert.match(csv[1], /^;7;extern;Feuerwehr Riehen;;Hptm Muster 079 555 44 33;"2× vegetarisch, 1× Allergie: Nüsse";/);
  const pdf = Buffer.from(await (await ext.get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`)).res.arrayBuffer());
  assert.match(pdf.toString('latin1'), /^%PDF-1\.4/);
  assert.equal((await ext.get(`/einsaetze/${ev}/schichten`)).status, 200);
  assert.equal((await ext.get('/rueckmeldungen')).status, 200);
  assert.equal((await ext.get('/')).status, 200);

  // Schicht löschen: Auswahl wird bereinigt, Abteilung gilt dann für alle Schichten
  events.deleteShift(tag.id, system);
  st = events.stats(events.get(ev));
  assert.deepEqual(st.shifts.map((s) => s.extern), [9]);

  // Entfernen
  assert.ok((await post(`/einsaetze/${ev}/externe/${x.id}/loeschen`, [])).redirect);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM event_externals WHERE event_id = ?', ev).n, 1);

  // Auswahlliste: nur Admin
  assert.equal((await ext.get('/verwaltung/listen')).status, 403);
  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.ok((await admin.get('/verwaltung/listen')).data.externalUnits.some((u) => u.name === 'Feuerwehr Riehen'));
});

test('Funktionen: Soll pro Einsatz festlegen, zuweisen, Ist/Soll und Teilnehmerliste', async () => {
  const db = require('../src/db');
  const { system } = require('./helpers');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const functions = require('../src/services/functions');
  const { today, addDays } = require('../src/lib/dates');
  const fn = (short) => db.one('SELECT id FROM functions WHERE short = ?', short).id;
  const rank = (s) => db.one('SELECT id FROM ranks WHERE short = ?', s).id;
  assert.deepEqual(db.all('SELECT short FROM functions ORDER BY sort').map((f) => f.short), ['EL', 'SC', 'BF', 'TN']);

  await users.create({ username: 'fkt', display_name: 'Fkt', role: 'aufgebotsstelle', password: 'Aufgebot-2026-f', must_change_password: false }, null);
  const auf = await login('fkt', 'Aufgebot-2026-f');
  assert.deepEqual((await auf.get('/einsaetze/neu')).data.functionList.map((f) => f.short), ['EL', 'SC', 'BF', 'TN']);
  const post = (path, fields) => {
    const body = {};
    for (const [k, v] of fields) body[k] = k in body ? [].concat(body[k], v) : v;
    return auf.post(path, body);
  };

  // Einsatz mit Soll: 1 EL, 2 SC, 1 BF, 3 TN (0 = braucht es nicht)
  const created = await post('/einsaetze', [['name', 'Fasnachtsumzug'], ['date', addDays(today(), 8)], ['start_time', '13:00'], ['end_time', '18:00'],
    [`fn_target_${fn('EL')}`, '1'], [`fn_target_${fn('SC')}`, '2'], [`fn_target_${fn('BF')}`, '1'], [`fn_target_${fn('TN')}`, '3']]);
  const ev = Number(created.redirect.match(/\/einsaetze\/(\d+)/)[1]);
  assert.deepEqual(events.get(ev).shifts[0].targets, { [fn('EL')]: 1, [fn('SC')]: 2, [fn('BF')]: 1, [fn('TN')]: 3 });
  assert.equal(events.get(ev).shifts[0].target_count, 7, 'Soll der Schicht = Summe der Funktionen');
  // ungültige Zahl wird abgelehnt
  assert.equal((await post('/einsaetze', [['name', 'X'], ['date', addDays(today(), 8)], [`fn_target_${fn('EL')}`, '-1']])).status, 400);

  const mk = (first, last, r) => persons.create({ first_name: first, last_name: last, status: 'aktiv', rank_id: r ? rank(r) : null }, system);
  const ids = { marco: mk('Marco', 'Leit', 'Oblt'), sara: mk('Sara', 'Sektor', 'Wm'), ben: mk('Ben', 'Bus', 'Gfr'), tim: mk('Tim', 'Teil', 'Fw'), ida: mk('Ida', 'Ab', 'Sdt') };
  const reg = {};
  for (const [k, pid] of Object.entries(ids)) reg[k] = registrations.create({ eventId: ev, personId: pid, matchType: 'auto', source: 'manuell', wishes: [], user: system });
  registrations.setStatus(reg.ida, 'zurueckgezogen', system);

  // Einzeln zuweisen und als Sammelaktion
  assert.ok((await post(`/anmeldungen/${reg.marco}/funktion`, [['function_id', String(fn('EL'))], ['back', `/einsaetze/${ev}`]])).redirect);
  assert.equal(db.one('SELECT function_id FROM registrations WHERE id = ?', reg.marco).function_id, fn('EL'));
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND action = 'function' AND summary LIKE '%Marco Leit die Funktion Einsatzleiter (EL)%'", ev));
  assert.ok((await post(`/einsaetze/${ev}/anmeldungen/sammel`, [['ids', String(reg.sara)], ['ids', String(reg.ben)], ['function_select', String(fn('SC'))], ['status_select', '']])).redirect);
  await post(`/anmeldungen/${reg.ben}/funktion`, [['function_id', String(fn('BF'))]]);
  // Abgemeldete bekommen keine Funktion
  await post(`/anmeldungen/${reg.ida}/funktion`, [['function_id', String(fn('SC'))]]);
  assert.equal(db.one('SELECT function_id FROM registrations WHERE id = ?', reg.ida).function_id, null);
  // zurück auf Standard = NULL
  await post(`/anmeldungen/${reg.tim}/funktion`, [['function_id', String(fn('SC'))]]);
  await post(`/anmeldungen/${reg.tim}/funktion`, [['function_id', String(fn('TN'))]]);
  assert.equal(db.one('SELECT function_id FROM registrations WHERE id = ?', reg.tim).function_id, null);

  // Externe Abteilung als Einsatzteilnehmer (Standard) und eine mit Funktion BF
  await post(`/einsaetze/${ev}/externe`, [['unit_name', 'VK NWS'], ['person_count', '2']]);
  await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Carfahrer AG'], ['person_count', '1'], ['function_id', String(fn('BF'))]]);

  const sum = functions.summary(events.get(ev));
  const row = (s) => sum.shifts[0].rows.find((r) => r.short === s);
  assert.deepEqual(['EL', 'SC', 'BF', 'TN'].map((s) => [row(s).ist, row(s).soll]), [[1, 1], [1, 2], [2, 1], [3, 3]]);
  assert.equal(row('TN').extern, 2);
  assert.equal(row('BF').over, 1);
  assert.equal(functions.line(sum), 'EL 1/1 · SC 1/2 · BF 2/1 · TN 3/3');
  assert.equal(events.stats(events.get(ev)).shifts[0].soll, 7);

  // Zweite Schicht mit eigenem Soll pro Funktion (Reiter Schichten): 1 SC + 2 TN = 3
  const sh1 = events.get(ev).shifts[0];
  assert.ok((await post(`/einsaetze/${ev}/schichten`, [['name', 'Abend'], ['start', '18:00'], ['end', '22:00'], [`fn_target_${fn('SC')}`, '1'], [`fn_target_${fn('TN')}`, '2']])).redirect);
  const sh2 = events.get(ev).shifts[1];
  assert.equal(sh2.target_count, 3);
  // Soll pro Schicht und Funktion im Einsatzformular ändern
  assert.equal((await auf.get(`/einsaetze/${ev}/bearbeiten`)).data.e.shifts[1].targets[fn('SC')], 1);
  const version = String(db.one('SELECT version FROM events WHERE id = ?', ev).version);
  assert.ok((await post(`/einsaetze/${ev}/bearbeiten`, [['version', version], ['name', 'Fasnachtsumzug'], ['date', events.get(ev).date], ['start_time', '13:00'], ['end_time', '18:00'],
    ...[['EL', '1'], ['SC', '2'], ['BF', '1'], ['TN', '3']].map(([k, v]) => [`fn_target_${sh1.id}_${fn(k)}`, v]),
    ...[['EL', ''], ['SC', '1'], ['BF', ''], ['TN', '4']].map(([k, v]) => [`fn_target_${sh2.id}_${fn(k)}`, v])])).redirect);
  assert.equal(events.get(ev).shifts[1].target_count, 5);
  assert.equal(events.get(ev).shifts[0].target_count, 7);
  // Marco ist nur in der Abendschicht: zählt dort als EL
  registrations.setShifts(reg.marco, [sh2.id], system);
  const two = functions.summary(events.get(ev));
  assert.ok(two.multi);
  // externe Abteilungen (2 TN + 1 BF) gelten für alle Schichten
  assert.deepEqual(two.shifts.map((x) => [x.totalIst, x.totalSoll]), [[6, 7], [4, 5]]);
  assert.match(functions.line(two), /^Ganzer Einsatz: EL 0\/1 · .*\|  Abend: EL 1\/– · SC 0\/1 · BF 1\/– · TN 2\/4$/);
  registrations.setShifts(reg.marco, [sh1.id], system);
  events.deleteShift(sh2.id, system);

  // Übersicht: Besetzung pro Funktion, Lage oben, Vorschlag für den Einsatzleiter-Zugriff (Konto der Person mit Funktion EL)
  await users.create({ username: 'marco2', display_name: 'Marco Leit', role: 'einsatzleiter', person_id: ids.marco, password: 'Kommando-Marco-2026', must_change_password: false }, null);
  const over = (await auf.get(`/einsaetze/${ev}`)).data;
  const orow = (s) => over.fnSummary.shifts[0].rows.find((r) => r.short === s);
  assert.deepEqual([orow('SC').ist, orow('SC').soll], [1, 2]);
  assert.equal(orow('BF').over, 1);
  assert.ok(over.leaderSuggestions.some((u) => u.username === 'marco2'), 'Einsatzleiter-Konto der Person mit Funktion EL');
  assert.ok((await auf.get(`/einsaetze/${ev}/schichten`)).data.fnSummary);
  const anm = (await auf.get(`/einsaetze/${ev}/anmeldungen?sort=funktion`)).data;
  assert.ok(anm.functionOptions.length);
  assert.deepEqual(anm.list.filter((r) => r.status !== 'zurueckgezogen').map((r) => `${r.first_name} ${r.last_name}`), ['Marco Leit', 'Sara Sektor', 'Ben Bus', 'Tim Teil'], 'nach Funktion sortiert');
  assert.equal((await auf.get(`/einsaetze/${ev}/bearbeiten`)).status, 200);

  // Schichten verwalten: ein Speichern-Knopf für alle Zeilen, neue Zeile wird mitgespeichert
  const sh0 = events.get(ev).shifts[0];
  const rowOf = (s, extra = {}) => [['name', s.name], ['date', s.starts_at ? s.starts_at.slice(0, 10) : events.get(ev).date], ['start', s.starts_at ? s.starts_at.slice(11, 16) : ''],
    ['end', s.ends_at ? s.ends_at.slice(11, 16) : ''], ['start_place', s.start_place || ''], ['internal_note', s.internal_note || ''],
    ...['EL', 'SC', 'BF', 'TN'].map((k) => [`fn_target_${fn(k)}`, String(s.targets[fn(k)] ?? '')])].map(([k, v]) => [`${k}__${s.id}`, extra[k] ?? v]);
  const logCount = () => db.one("SELECT count(*) AS n FROM audit_log WHERE entity_type = 'shift'").n;
  // nichts geändert: nichts gespeichert, kein Verlaufseintrag
  const before = logCount();
  assert.ok((await post(`/einsaetze/${ev}/schichten/speichern`, rowOf(sh0))).redirect);
  assert.equal(logCount(), before);
  // angefangene neue Zeile ohne Namen: Fehler, auch die geänderte Zeile bleibt ungespeichert
  await post(`/einsaetze/${ev}/schichten/speichern`, [...rowOf(sh0, { name: 'Tagschicht' }), ['name__neu', ''], [`fn_target_${fn('TN')}__neu`, '2']]);
  assert.equal(events.get(ev).shifts[0].name, sh0.name);
  // Zeile ändern und gleichzeitig eine neue Schicht anlegen
  assert.ok((await post(`/einsaetze/${ev}/schichten/speichern`, [...rowOf(sh0, { name: 'Tagschicht', [`fn_target_${fn('SC')}`]: '3' }),
    ['name__neu', 'Nacht'], ['date__neu', events.get(ev).date], ['start__neu', '22:00'], ['end__neu', '23:30'], [`fn_target_${fn('TN')}__neu`, '2']])).redirect);
  const after = events.get(ev).shifts;
  assert.equal(after.length, 2);
  assert.equal(after[0].name, 'Tagschicht');
  assert.equal(after[0].targets[fn('SC')], 3);
  assert.equal(after[1].name, 'Nacht');
  assert.equal(after[1].target_count, 2);
  assert.equal(logCount(), before + 2);
  events.deleteShift(after[1].id, system);
  db.run('UPDATE shifts SET name = ? WHERE id = ?', sh0.name, sh0.id);
  events.setShiftTargets(sh0.id, sh0.targets);

  // Teilnehmerliste: Spalte Funktion, Ist/Soll, Export
  const tl = (await auf.get(`/einsaetze/${ev}/teilnehmerliste?sort=funktion`)).data;
  assert.ok(tl.showFunction);
  assert.deepEqual([tl.fnSummary.shifts[0].rows[0].ist, tl.fnSummary.shifts[0].rows[0].soll], [1, 1]);
  assert.ok(tl.list.findIndex((r) => r.last_name === 'Leit') < tl.list.findIndex((r) => r.last_name === 'Teil'));
  const csv = await csvLines(await auf.get(`/einsaetze/${ev}/teilnehmerliste?format=csv&sort=funktion`));
  assert.match(csv[0], /^Nr\.;Anzahl;Funktion;Rang;Nachname/);
  assert.match(csv[1], /^1;1;EL;Oblt;Leit;Marco/);
  assert.ok(csv.some((l) => /^;1;BF;extern;Carfahrer AG/.test(l)));
  const pdf = Buffer.from(await (await auf.get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`)).res.arrayBuffer()).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4/);

  // Einsatzleiter-Ansicht zeigt die Funktionen (nur lesen)
  const lead = await login('marco2', 'Kommando-Marco-2026');
  await auf.post(`/einsaetze/${ev}/einsatzleiter`, { user_id: String(db.one("SELECT id FROM users WHERE username = 'marco2'").id) });
  const lv = await lead.get(`/einsaetze/${ev}`);
  assert.equal(lv.view, 'leader/event');
  assert.ok(lv.data.fnSummary);

  // Auswahlliste: Funktionen verwalten (Admin); verwendete und die Standardfunktion lassen sich nicht entfernen
  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.ok((await admin.get('/verwaltung/listen')).data.functionList.length >= 4);
  const fields = { default_function: String(fn('TN')) };
  for (const f of db.all('SELECT * FROM functions')) Object.assign(fields, { [`row__${f.id}`]: '1', [`name__${f.id}`]: f.name, [`short__${f.id}`]: f.short, [`sort__${f.id}`]: String(f.sort), [`active__${f.id}`]: '1', [`delete__${f.id}`]: '1' });
  Object.assign(fields, { name__neu: 'Sanität', short__neu: 'SAN', sort__neu: '5' });
  await admin.post('/verwaltung/listen/funktionen', fields);
  assert.deepEqual(db.all('SELECT short FROM functions ORDER BY sort').map((f) => f.short), ['EL', 'SC', 'BF', 'TN', 'SAN']);
  assert.equal(db.one('SELECT short FROM functions WHERE is_default = 1').short, 'TN');
});

test('Teilnehmer- und Verpflegungsliste: ganzer Einsatz, pro Schicht, eine Schicht', async () => {
  const db = require('../src/db');
  const { system } = require('./helpers');
  const persons = require('../src/services/persons');
  const events = require('../src/services/events');
  const registrations = require('../src/services/registrations');
  const externals = require('../src/services/externals');
  const leaders = require('../src/services/leaders');
  const { today, addDays } = require('../src/lib/dates');
  const rank = (s) => db.one('SELECT id FROM ranks WHERE short = ?', s).id;
  const ev = events.create({ name: 'Rheinschwimmen', date: addDays(today(), 5), start_time: '10:00', end_time: '14:00' }, system);
  events.addShift(ev, { name: 'Nachmittag', start: '14:00', end: '18:00' }, system);
  db.run("UPDATE shifts SET name = 'Vormittag' WHERE event_id = ? AND name = 'Ganzer Einsatz'", ev);
  const e = events.get(ev);
  const [vor, nach] = e.shifts;
  const p = (first, last, r, diet = {}) => persons.create({ first_name: first, last_name: last, status: 'aktiv', rank_id: rank(r), ...diet }, system);
  const reg = (pid, shifts) => {
    const id = registrations.create({ eventId: ev, personId: pid, matchType: 'auto', source: 'manuell', wishes: [], user: system });
    if (shifts.length) registrations.setShifts(id, shifts, system);
    return id;
  };
  reg(p('Vera', 'Vegi', 'Sdt', { diet_category: 'vegetarisch' }), [vor.id]);
  reg(p('Nora', 'Nuss', 'Kpl', { diet_category: 'allergie', diet_text: 'Erdnüsse' }), [vor.id, nach.id]);
  reg(p('Otto', 'Ohne', 'Hptm'), [nach.id]);
  reg(p('Fritz', 'Frei', 'Gfr'), []);
  externals.add(e, { unit_name: 'Pontoniere', person_count: '4', shift_ids: [String(nach.id)], diet_count: ['1'], diet_category: ['vegan'], diet_text: [''] }, system);

  await users.create({ username: 'kueche', display_name: 'Küche', role: 'aufgebotsstelle', password: 'Aufgebot-2026-k', must_change_password: false }, null);
  const k = await login('kueche', 'Aufgebot-2026-k');
  const names = (list) => list.map((r) => `${r.first_name} ${r.last_name}`);

  // Teilnehmerliste pro Schicht: ein Block pro Schicht, wer in zwei Schichten ist, steht zweimal; Rest am Schluss
  const tn = (await k.get(`/einsaetze/${ev}/teilnehmerliste?schicht=alle`)).data;
  assert.ok(tn.perShift);
  assert.deepEqual(tn.groups.map((g) => g.shift?.name ?? null), ['Vormittag', 'Nachmittag', null], 'Schichten in Reihenfolge, Rest am Schluss');
  assert.deepEqual(names(tn.groups[0].list), ['Vera Vegi', 'Nora Nuss']);
  assert.ok(names(tn.groups[1].list).includes('Nora Nuss'), 'in zwei Schichten = zweimal aufgeführt');
  assert.deepEqual(names(tn.groups[2].list), ['Fritz Frei']);
  assert.ok(tn.groups[1].exts.some((x) => x.unit_name === 'Pontoniere'));
  assert.ok(!tn.groups[0].exts.some((x) => x.unit_name === 'Pontoniere'));
  const tnCsv = await csvLines(await k.get(`/einsaetze/${ev}/teilnehmerliste?format=csv&schicht=alle`));
  assert.match(tnCsv[0], /^Schicht;Nr\.;Anzahl;Rang;Nachname/);
  assert.match(tnCsv[1], /^Vormittag · 10:00–14:00;1;1;Sdt;Vegi;Vera;/);
  assert.ok(tnCsv.some((l) => /^Nachmittag · 14:00–18:00;;4;extern;Pontoniere;/.test(l)));
  const tnPdf = await k.get(`/einsaetze/${ev}/teilnehmerliste?format=pdf&schicht=alle`);
  assert.match(tnPdf.headers.get('content-disposition'), /Teilnehmerliste_Rheinschwimmen_pro_Schicht_/);
  assert.match(Buffer.from(await tnPdf.res.arrayBuffer()).toString('latin1'), /\/Count 3 /, 'jede Schicht auf einer eigenen Seite');

  // Verpflegungsliste ganzer Einsatz: Spalte pro Schicht + Total (jede Person einmal)
  const vl = (await k.get(`/einsaetze/${ev}/verpflegungsliste`)).data;
  assert.deepEqual([...vl.matrix.totals, vl.matrix.total], [2, 6, 1, 8], 'Vormittag 2, Nachmittag 2 + 4 extern, ohne Schicht 1, ganzer Einsatz 4 + 4');
  assert.ok(vl.matrix.overlap, 'Hinweis: wer in mehreren Schichten eingeteilt ist');
  const nora = vl.list.find((r) => r.last_name === 'Nuss');
  assert.deepEqual([nora.diet.category, nora.diet.text], ['Allergie', 'Erdnüsse']);
  assert.ok(vl.exts.some((x) => x.unit_name === 'Pontoniere' && x.dietList.some((d) => d.label === 'vegan' && d.count === 1)));
  const vlCsv = await csvLines(await k.get(`/einsaetze/${ev}/verpflegungsliste?format=csv`));
  assert.equal(vlCsv[0], 'Schicht;Essen;Anzahl;Wer');
  assert.ok(vlCsv.includes('Ganzer Einsatz;Total Essen;8;'));
  assert.ok(vlCsv.includes('Nachmittag · 14:00–18:00;vegan;1;Pontoniere 1×'));
  assert.ok(vlCsv.includes('Ganzer Einsatz;Allergie;1;Kpl Nora Nuss (Erdnüsse)'));

  // eine Schicht und pro Schicht
  const one = (await k.get(`/einsaetze/${ev}/verpflegungsliste?schicht=${nach.id}`)).data;
  assert.equal(one.shift.name, 'Nachmittag');
  assert.ok(!names(one.list).includes('Vera Vegi'));
  const per = (await k.get(`/einsaetze/${ev}/verpflegungsliste?schicht=alle`)).data;
  assert.equal(per.shiftBlocks.length, 3, 'drei Blöcke: zwei Schichten + ohne Schicht');
  const vlPdf = await k.get(`/einsaetze/${ev}/verpflegungsliste?format=pdf&schicht=alle`);
  assert.equal(vlPdf.headers.get('content-type'), 'application/pdf');
  assert.match(Buffer.from(await vlPdf.res.arrayBuffer()).toString('latin1'), /^%PDF-1\.4/);
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND action = 'export' AND summary LIKE '%Verpflegungsliste (pro Schicht)%'", ev));

  // Einsatzleiter: freigegebener Einsatz ja, andere nein
  const el = await users.create({ username: 'vera-el', display_name: 'Vera EL', role: 'einsatzleiter', password: 'Leitung-2026-v', must_change_password: false }, null);
  leaders.grant(ev, el.id, system);
  const v = await login('vera-el', 'Leitung-2026-v');
  const elPage = await v.get(`/einsaetze/${ev}/verpflegungsliste`);
  assert.equal(elPage.status, 200);
  assert.equal(elPage.data.leaderView, true);
  assert.equal((await v.get(`/einsaetze/${ev}/verpflegungsliste?format=pdf`)).headers.get('content-type'), 'application/pdf');
  const other = events.create({ name: 'Anderer Einsatz', date: addDays(today(), 6) }, system);
  assert.equal((await v.get(`/einsaetze/${other}/verpflegungsliste`)).status, 403);
});

test('Lokales Login aus: Passwort weder selbst noch durch Admin änderbar', async () => {
  const { id } = await users.create({ username: 'nurms', display_name: 'Nur MS', role: 'aufgebotsstelle', email: 'nurms@kkb.ch', password: 'Microsoft-Nur-2026', must_change_password: false, login_fields: '1', ms_login: '1' }, null);
  const hash = users.get(id).password_hash;

  // Die Person selbst (Microsoft ist im Test aus, darum klappt das Passwort-Login hier)
  const me = await login('nurms', 'Microsoft-Nur-2026');
  assert.equal(Number(me.res.json ? (await me.refresh()).user.password_login : 1), 0, 'Passwort-Login ausgeschaltet');
  const r = await me.post('/konto/passwort', { current: 'Microsoft-Nur-2026', password: 'Ganz-Neu-2026!', password_confirm: 'Ganz-Neu-2026!' });
  assert.equal(r.status, 400);

  // Der Admin
  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.equal(Number((await admin.get(`/verwaltung/benutzer/${id}`)).data.u.password_login), 0, 'kein Knopf «Passwort zurücksetzen»');
  const r2 = await admin.post(`/verwaltung/benutzer/${id}/passwort`);
  assert.ok(r2.redirect);
  assert.match(flashText(r2), /./);
  assert.equal(users.get(id).password_hash, hash, 'Passwort unverändert');
});
