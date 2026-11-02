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
  assert.equal((await get('/login')).headers.get('cache-control'), 'no-store', 'Seiten nicht aus dem Browser-Cache');
  assert.equal((await get('/forms/anmeldung')).status, 200);
});

test('Anmeldung und Rollen', async () => {
  const bad = await login('admin', 'falsch-falsch');
  assert.equal(bad.res.status, 401);

  const admin = await login('admin', 'Chef-Passwort-2026');
  assert.equal(admin.res.status, 302);
  assert.equal((await get('/', admin.cookie)).status, 200);
  for (const p of ['/verwaltung/benutzer/neu', '/verwaltung/benutzer/1']) assert.equal((await get(p, admin.cookie)).status, 200, p);
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

test('Blockier-Meldungen des Browsers werden angenommen', async () => {
  const r = await fetch(`${base}/forms/csp-bericht`, {
    method: 'POST', headers: { 'content-type': 'application/csp-report' },
    body: JSON.stringify({ 'csp-report': { 'violated-directive': 'frame-ancestors', 'blocked-uri': 'https://example.org', 'document-uri': 'https://x/forms/anmeldung' } }),
  });
  assert.equal(r.status, 204);
  assert.match((await get('/forms/anmeldung')).headers.get('content-security-policy'), /report-uri \/forms\/csp-bericht/);
});

test('Bestätigungsmail: Seite, Vorschau und Speichern (nur Admin)', async () => {
  const settings = require('../src/services/settings');
  const admin = await login('admin', 'Chef-Passwort-2026');
  const page = await get('/verwaltung/bestaetigungsmail', admin.cookie);
  assert.equal(page.status, 200);
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const post = (action) => fetch(`${base}/verwaltung/bestaetigungsmail`, {
    method: 'POST', redirect: 'manual', headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, enabled: '1', subject: 'Bestätigt: {{einsatz.name}}', body: 'Hallo {{person.vorname}}', action }),
  });
  assert.equal((await post('preview')).status, 200);
  assert.notEqual(settings.get('confirmation').subject, 'Bestätigt: {{einsatz.name}}');
  assert.equal((await post('save')).status, 302);
  assert.equal(settings.get('confirmation').subject, 'Bestätigt: {{einsatz.name}}');
  // formatierte Vorlage (HTML aus dem Editor) wird bereinigt gespeichert
  const rich = await fetch(`${base}/verwaltung/bestaetigungsmail`, {
    method: 'POST', redirect: 'manual', headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, enabled: '1', subject: 'S', body: '<div>Hallo <b>{{person.vorname}}</b><script>x</script></div>', body_format: 'html', action: 'save' }),
  });
  assert.equal(rich.status, 302);
  assert.equal(settings.get('confirmation').format, 'html');
  assert.equal(settings.get('confirmation').body, '<div>Hallo <b>{{person.vorname}}</b></div>');
  const page2 = await (await get('/verwaltung/bestaetigungsmail', admin.cookie)).text();
  assert.match(page2, /data-rte/);
  const lena = await login('lena', 'Aufgebot-2026-x');
  assert.notEqual((await get('/verwaltung/bestaetigungsmail', lena.cookie)).status, 200);
});

test('System-Seite: nur Admin, Update ohne Starter wird abgelehnt', async () => {
  const admin = await login('admin', 'Chef-Passwort-2026');
  const page = await get('/verwaltung/system', admin.cookie);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /alten Startskript/);
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
  const r = await fetch(`${base}/verwaltung/system/neustart`, {
    method: 'POST', redirect: 'manual', headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf }),
  });
  assert.equal(r.status, 302); // Fehlermeldung statt Neustart
});

test('Standard-Anmeldefrage ist bei neuen Einsätzen vorausgewählt', async () => {
  const settings = require('../src/services/settings');
  const db = require('../src/db');
  const admin = await login('admin', 'Chef-Passwort-2026');
  const page = await get('/verwaltung/vorlagen', admin.cookie);
  const csrf = (await page.text()).match(/name="_csrf" value="([^"]+)"/)[1];
  const q = db.one("SELECT * FROM question_templates WHERE name = 'Schichtauswahl'");
  const save = (def) => fetch(`${base}/verwaltung/vorlagen/fragen`, {
    method: 'POST', redirect: 'manual', headers: { cookie: admin.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf, default_question: def }),
  });
  assert.equal((await save(String(q.id))).status, 302);
  assert.equal(settings.get('default_question_template'), q.id);
  const html = await (await get('/einsaetze/neu', admin.cookie)).text();
  assert.match(html, new RegExp(`<option value="${q.id}"[^>]*selected`));
  assert.match(html, /value="Für welche Schichten kannst du\?"/);
  await save('');
  assert.equal(settings.get('default_question_template'), null);
  assert.doesNotMatch(await (await get('/einsaetze/neu', admin.cookie)).text(), /<option value="\d+"[^>]*data-question[^>]*selected/);
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
  const html = await (await get(`/einsaetze/${ev}/teilnehmerliste`, mara.cookie)).text();
  const order = ['Hans Haupt', 'Willi Wacht', 'Sina Soldat'].map((n) => html.indexOf(n));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], 'höchster Rang zuerst');
  assert.doesNotMatch(html, /Abi Gemeldet/, 'Abmeldungen stehen nicht auf der Liste');
  assert.match(html, /079 999 88 77/);
  assert.match(html, /Allergie<\/strong>: Nüsse/, 'Aufgebotsstelle sieht die Angaben der Angemeldeten');
  assert.match(html, /1 Allergie · 1 vegetarisch · 1 ohne Einschränkung/);

  const auf = await (await get(`/einsaetze/${ev}/teilnehmerliste?sort=rang_auf&umfang=bestaetigt`, mara.cookie)).text();
  assert.match(auf, /Hans Haupt/);
  assert.doesNotMatch(auf, /Sina Soldat/, 'nur bestätigte');

  const csv = await get(`/einsaetze/${ev}/teilnehmerliste?format=csv`, mara.cookie);
  assert.match(csv.headers.get('content-disposition'), /Teilnehmerliste_Zolli-Fest/);
  const lines = (await csv.text()).replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.match(lines[0], /Nr\.;Rang;Nachname;Vorname;Mobil;Essenseinschränkung;Details;Status/);
  assert.match(lines[1], /^1;Hptm;Haupt;Hans;079 999 88 77;Allergie;Nüsse;Bestätigt$/);
  assert.equal(lines.length, 4);
  const xlsx = await get(`/einsaetze/${ev}/teilnehmerliste?format=xlsx`, mara.cookie);
  assert.equal(xlsx.status, 200);
  assert.match(xlsx.headers.get('content-type'), /spreadsheetml/);
  const pdf = await get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`, mara.cookie);
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.match(pdf.headers.get('content-disposition'), /^inline; filename="Teilnehmerliste_Zolli-Fest_/);
  const body = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
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
  const home = await (await get('/', leo.cookie)).text();
  assert.match(home, /Meine Einsätze/);
  assert.doesNotMatch(home, /Basler Herbstlauf/);
  assert.doesNotMatch(home, /href="\/personen"/, 'kein Menü für Personen');
  assert.equal((await get(`/einsaetze/${ev}`, leo.cookie)).status, 403);
  for (const p of ['/einsaetze', '/personen', '/rueckmeldungen', '/klaerungen', '/suche?q=pia', `/einsaetze/${ev}/anmeldungen`, `/einsaetze/${ev}/teilnehmerliste?format=csv`, '/verwaltung']) {
    assert.equal((await get(p, leo.cookie)).status, 403, p);
  }
  const leoBook = await (await get('/handbuch', leo.cookie)).text();
  assert.match(leoBook, /Handbuch für Einsatzleiter/, 'Einsatzleiter sehen ihr eigenes Handbuch');
  assert.doesNotMatch(leoBook, /Klärungen/, 'nicht das volle Handbuch');
  assert.equal((await get('/handbuch/einsatzleiter', leo.cookie)).status, 302);
  assert.equal((await get('/konto/passwort', leo.cookie)).status, 200);

  // Aufgebotsstelle: volles Handbuch, Einsatzleiter-Handbuch zum Nachschauen
  const fullBook = await (await get('/handbuch', auf.cookie)).text();
  assert.match(fullBook, /Klärungen/);
  assert.match(fullBook, /href="\/handbuch\/einsatzleiter"/);
  assert.match(await (await get('/handbuch/einsatzleiter', auf.cookie)).text(), /Was du als Einsatzleiter siehst/);

  // Aufgebotsstelle gibt frei
  const page = await (await get(`/einsaetze/${ev}`, auf.cookie)).text();
  assert.match(page, /Einsatzleiter-Zugriff/);
  assert.match(page, new RegExp(`<option value="${leaderId}"[^>]*>Leo Leiter`));
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  const post = (path, cookie, token, body = {}) => fetch(`${base}${path}`, {
    method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: token, ...body }),
  });
  assert.equal((await post(`/einsaetze/${ev}/einsatzleiter`, auf.cookie, csrf, { user_id: String(leaderId) })).status, 302);
  assert.ok(db.one('SELECT 1 FROM event_leaders WHERE event_id = ? AND user_id = ?', ev, leaderId));
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND action = 'leader_grant'", ev), 'Freigabe steht im Verlauf');

  // nach der Freigabe: Einsatz mit Angaben und Teilnehmern, aber ohne interne Bemerkung und ohne Bearbeiten
  assert.match(await (await get('/', leo.cookie)).text(), /Basler Herbstlauf/);
  const view = await (await get(`/einsaetze/${ev}`, leo.cookie)).text();
  assert.match(view, /Pia Planer/);
  assert.match(view, /079 555 44 33/);
  assert.match(view, /vegan/, 'Essenseinschränkung beim anstehenden freigegebenen Einsatz sichtbar');
  assert.doesNotMatch(view, /Budget 500/, 'keine interne Bemerkung');
  assert.doesNotMatch(view, /\/bearbeiten|\/personen\//, 'keine Links zum Bearbeiten oder zu Personen');
  const csv = await get(`/einsaetze/${ev}/teilnehmerliste?format=csv`, leo.cookie);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /Planer;Pia;079 555 44 33;vegan/);
  assert.equal((await get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`, leo.cookie)).headers.get('content-type'), 'application/pdf');
  assert.equal((await get(`/einsaetze/${ev}/teilnehmerliste`, leo.cookie)).headers.get('location'), `/einsaetze/${ev}`);
  assert.equal((await get(`/einsaetze/${other}`, leo.cookie)).status, 403, 'andere Einsätze bleiben gesperrt');
  assert.equal((await get(`/einsaetze/${ev}/schichten`, leo.cookie)).status, 403);

  // Einsatzleiter darf nichts ändern
  const leoCsrf = view.match(/name="_csrf" value="([^"]+)"/)[1];
  assert.equal((await post(`/einsaetze/${ev}/status`, leo.cookie, leoCsrf, { status: 'abgesagt' })).status, 403);
  assert.equal((await post(`/einsaetze/${ev}/einsatzleiter`, leo.cookie, leoCsrf, { user_id: String(leaderId) })).status, 403);
  assert.equal(db.one('SELECT status FROM events WHERE id = ?', ev).status, 'entwurf');

  // Freigabe entfernen
  assert.equal((await post(`/einsaetze/${ev}/einsatzleiter/${leaderId}/entfernen`, auf.cookie, csrf)).status, 302);
  assert.equal((await get(`/einsaetze/${ev}`, leo.cookie)).status, 403);
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
  const page = await (await get(`/einsaetze/${ev}`, ext.cookie)).text();
  assert.match(page, /Externe Abteilungen/);
  const csrf = page.match(/name="_csrf" value="([^"]+)"/)[1];
  const post = (path, fields) => fetch(`${base}${path}`, {
    method: 'POST', redirect: 'manual', headers: { cookie: ext.cookie, 'content-type': 'application/x-www-form-urlencoded', referer: `${base}/einsaetze/${ev}` },
    body: new URLSearchParams([['_csrf', csrf], ...fields]),
  });

  // neue Abteilung per Name (wird in die Liste aufgenommen), nur Tagschicht
  assert.equal((await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Feuerwehr Riehen'], ['person_count', '6'], ['shift_ids', String(tag.id)], ['contact', 'Hptm Muster 079 555 44 33']])).status, 302);
  // gleicher Name anders geschrieben = gleiche Abteilung; alle Schichten
  assert.equal((await post(`/einsaetze/${ev}/externe`, [['unit_name', 'feuerwehr riehen'], ['person_count', '2'], ['shift_ids', String(tag.id)], ['shift_ids', String(abend.id)]])).status, 302);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM external_units').n, 1);
  // ungültig: keine Anzahl, keine Schicht
  await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Samariter'], ['person_count', '0'], ['shift_ids', String(tag.id)]]);
  await post(`/einsaetze/${ev}/externe`, [['unit_name', 'Samariter'], ['person_count', '3']]);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM event_externals WHERE event_id = ?', ev).n, 2);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM external_units').n, 1, 'abgelehnte Eingaben legen keine Abteilung an');

  let st = events.stats(events.get(ev));
  assert.deepEqual(st.shifts.map((s) => [s.ist, s.extern]), [[8, 8], [2, 2]]);
  assert.equal(JSON.parse(db.one('SELECT shift_ids FROM event_externals WHERE person_count = 2').shift_ids).length, 0, 'alle angekreuzt = ganzer Einsatz');

  // ändern und Verlauf
  const x = db.one('SELECT id FROM event_externals WHERE person_count = 6');
  assert.equal((await post(`/einsaetze/${ev}/externe/${x.id}`, [['unit_name', 'Feuerwehr Riehen'], ['person_count', '7'], ['shift_ids', String(tag.id)], ['contact', 'Hptm Muster 079 555 44 33'],
    ['diet_count', '2'], ['diet_category', 'vegetarisch'], ['diet_text', ''],
    ['diet_count', '1'], ['diet_category', 'allergie'], ['diet_text', 'Nüsse'],
    ['diet_count', ''], ['diet_category', ''], ['diet_text', '']])).status, 302);
  assert.deepEqual(JSON.parse(db.one('SELECT diets FROM event_externals WHERE id = ?', x.id).diets), [{ count: 2, category: 'vegetarisch', text: '' }, { count: 1, category: 'allergie', text: 'Nüsse' }]);
  // mehr Einschränkungen als Personen: abgelehnt, alte Angaben bleiben
  await post(`/einsaetze/${ev}/externe/${x.id}`, [['unit_name', 'Feuerwehr Riehen'], ['person_count', '7'], ['shift_ids', String(tag.id)], ['diet_count', '8'], ['diet_category', 'vegan'], ['diet_text', '']]);
  assert.match(db.one('SELECT diets FROM event_externals WHERE id = ?', x.id).diets, /Nüsse/);
  st = events.stats(events.get(ev));
  assert.equal(st.shifts[0].ist, 9);
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE event_id = ? AND entity_type = 'external' AND summary LIKE '%Anzahl 6 → 7%Essenseinschränkungen%'", ev));

  const html = await (await get(`/einsaetze/${ev}/teilnehmerliste`, ext.cookie)).text();
  assert.match(html, /0 Personen \+ 9 extern/);
  assert.match(html, /Feuerwehr Riehen/);
  assert.match(html, /Hptm Muster 079 555 44 33/);
  assert.match(html, /2× vegetarisch/);
  assert.match(html, /1× Allergie<\/strong>: Nüsse/);
  assert.match(html, /Verpflegung:<\/strong>\s*2 vegetarisch · 1 Allergie · 4 ohne Einschränkung · 2 extern \(keine Angaben\)/);
  const abendHtml = await (await get(`/einsaetze/${ev}/teilnehmerliste?schicht=${abend.id}`, ext.cookie)).text();
  assert.match(abendHtml, /0 Personen \+ 2 extern/);
  const csv = (await (await get(`/einsaetze/${ev}/teilnehmerliste?format=csv`, ext.cookie)).text()).replace(/^﻿/, '').trim().split(/\r?\n/);
  assert.match(csv[0], /^Nr\.;Anzahl;Rang;Nachname/);
  assert.match(csv[1], /^;7;extern;Feuerwehr Riehen;;Hptm Muster 079 555 44 33;"2× vegetarisch, 1× Allergie: Nüsse";/);
  const pdf = Buffer.from(await (await get(`/einsaetze/${ev}/teilnehmerliste?format=pdf`, ext.cookie)).arrayBuffer());
  assert.match(pdf.toString('latin1'), /^%PDF-1\.4/);
  assert.equal((await get(`/einsaetze/${ev}/schichten`, ext.cookie)).status, 200);
  assert.equal((await get('/rueckmeldungen', ext.cookie)).status, 200);
  assert.equal((await get('/', ext.cookie)).status, 200);

  // Schicht löschen: Auswahl wird bereinigt, Abteilung gilt dann für alle Schichten
  events.deleteShift(tag.id, system);
  st = events.stats(events.get(ev));
  assert.deepEqual(st.shifts.map((s) => s.extern), [9]);

  // Entfernen
  assert.equal((await post(`/einsaetze/${ev}/externe/${x.id}/loeschen`, [])).status, 302);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM event_externals WHERE event_id = ?', ev).n, 1);

  // Auswahlliste: nur Admin, verwendete Abteilung kann nicht entfernt werden
  assert.equal((await get('/verwaltung/listen', ext.cookie)).status, 403);
  const admin = await login('admin', 'Chef-Passwort-2026');
  const lists = await (await get('/verwaltung/listen', admin.cookie)).text();
  assert.match(lists, /Externe Abteilungen/);
  assert.match(lists, /value="Feuerwehr Riehen"/);
});
