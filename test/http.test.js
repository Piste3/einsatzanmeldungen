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
