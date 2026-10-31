'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, system } = require('./helpers');
const db = require('../src/db');
const persons = require('../src/services/persons');
const events = require('../src/services/events');
const submissions = require('../src/services/submissions');
const registrations = require('../src/services/registrations');
const matching = require('../src/services/matching');
const { today, addDays } = require('../src/lib/dates');

// Absenden ohne Wartezeit: Spam-Mindestzeit umgehen, indem das Token älter gemacht wird
function ageToken(uid) {
  db.run('UPDATE form_tokens SET issued_at = ? WHERE uid = ?', new Date(Date.now() - 60000).toISOString(), uid);
}

function setup() {
  freshDb();
  const anna = persons.create({ first_name: 'Anna', last_name: 'Roth', status: 'aktiv' }, system);
  persons.create({ first_name: 'Christian', last_name: 'Meier', status: 'aktiv' }, system);
  persons.create({ first_name: 'Christian', last_name: 'Meier', status: 'aktiv' }, system);
  const offen = events.create({ name: 'Herbstmesse', date: addDays(today(), 5), start_time: '13:00', end_time: '19:00', target_count: 5 }, system);
  events.setStatus(offen, 'veroeffentlicht', system);
  const entwurf = events.create({ name: 'Geheim', date: addDays(today(), 9), start_time: '10:00', end_time: '12:00' }, system);
  return { anna, offen, entwurf };
}

test('Zuordnung: eindeutig, vertauscht, mehrdeutig, unbekannt', () => {
  const { anna } = setup();
  assert.equal(matching.match('anna', 'röth').status, 'unknown');
  assert.equal(matching.match('Anna', 'Roth').person.id, anna);
  assert.equal(matching.match('Roth', 'Anna').person.id, anna);
  assert.equal(matching.match('Christian', 'Meier').status, 'ambiguous');
  const unknown = matching.match('Ana', 'Rot');
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.candidates[0].id, anna);
});

test('Formular: Anmeldung, Duplikat und manipulierte Auswahl', () => {
  const { anna, offen, entwurf } = setup();
  const form = submissions.issueForm('127.0.0.1');
  assert.deepEqual(form.events.map((e) => e.id), [offen]);
  ageToken(form.uid);

  const body = {
    submission_uid: form.uid, first_name: 'Anna', last_name: 'Roth',
    event_ids: [String(offen), String(entwurf)], [`answer_${offen}`]: 'ja', [`answer_${entwurf}`]: 'ja',
  };
  const first = submissions.receive(body, { ip: '127.0.0.1' });
  assert.ok(first.ok);
  assert.equal(first.submission.status, 'neu');
  const again = submissions.receive(body, { ip: '127.0.0.1' });
  assert.ok(again.duplicate);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM form_submissions').n, 1);

  const done = submissions.processSubmission(first.submission.id);
  assert.equal(done.status, 'verarbeitet');
  assert.match(done.error, /nicht im Formular/);
  const regs = db.all('SELECT * FROM registrations');
  assert.equal(regs.length, 1);
  assert.equal(regs[0].event_id, offen);
  assert.equal(regs[0].person_id, anna);
  assert.equal(regs[0].status, 'neu');
});

test('Formular: Spam und unklare Namen landen nicht still in den Anmeldungen', () => {
  const { offen } = setup();
  const spam = submissions.issueForm();
  const s = submissions.receive({ submission_uid: spam.uid, first_name: 'X', last_name: 'Y', event_ids: [String(offen)], [`answer_${offen}`]: 'ja' }, {});
  assert.equal(s.submission.status, 'spam'); // zu schnell abgeschickt

  const form = submissions.issueForm();
  ageToken(form.uid);
  const r = submissions.receive({ submission_uid: form.uid, first_name: 'Christian', last_name: 'Meier', event_ids: [String(offen)], [`answer_${offen}`]: 'ja' }, {});
  submissions.processSubmission(r.submission.id);
  const reg = db.one('SELECT * FROM registrations');
  assert.equal(reg.person_id, null);
  assert.equal(reg.status, 'unsicher');
  assert.equal(registrations.unresolved().length, 1);
});

test('Status: Bestätigen erzeugt Mail, Rückzug entfernt Schichten', () => {
  const { anna, offen } = setup();
  db.run("UPDATE persons SET email = 'anna@example.ch' WHERE id = ?", anna);
  const id = registrations.create({ eventId: offen, personId: anna, matchType: 'auto', source: 'telefon', wishes: [], user: system });
  registrations.setStatus(id, 'bestaetigt', system);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM mail_outbox').n, 1);
  assert.ok(db.one('SELECT COUNT(*) AS n FROM shift_assignments WHERE registration_id = ?', id).n >= 0);
  registrations.setStatus(id, 'zurueckgezogen', system);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM shift_assignments WHERE registration_id = ?', id).n, 0);
  assert.throws(() => registrations.setStatus(id, 'bestaetigt', system, { expected: 'neu' }));
});

test('Person löschen entfernt Anmeldungen und Anfragen, Einsätze bleiben', () => {
  const { anna, offen } = setup();
  const reg = registrations.create({ eventId: offen, personId: anna, matchType: 'auto', source: 'telefon', wishes: [], user: system });
  const shift = events.shiftsOf(offen)[0];
  registrations.setShifts(reg, [shift.id], system);
  db.run("INSERT INTO inquiries (event_id, person_id, status, registration_id, created_at, updated_at) VALUES (?, ?, 'zugesagt', ?, '', '')", offen, anna, reg);
  db.run('UPDATE events SET leader_person_id = ? WHERE id = ?', anna, offen);

  const impact = persons.deletionImpact(anna);
  assert.deepEqual([impact.registrations, impact.inquiries, impact.leaderOf], [1, 1, 1]);
  assert.equal(persons.remove(anna, system), 'Anna Roth');

  assert.equal(persons.get(anna), null);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM registrations').n, 0);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM shift_assignments').n, 0);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM inquiries').n, 0);
  assert.equal(events.get(offen).leader_person_id, null);
  assert.ok(db.one("SELECT 1 FROM audit_log WHERE action = 'delete' AND summary LIKE '%Anna Roth gelöscht%'"));
});

test('Anmeldung löschen setzt zurück, als wäre nichts eingegangen', () => {
  const { anna, offen } = setup();
  const reg = registrations.create({ eventId: offen, personId: anna, matchType: 'auto', source: 'telefon', wishes: [], user: system });
  registrations.setShifts(reg, [events.shiftsOf(offen)[0].id], system);
  const inq = Number(db.run("INSERT INTO inquiries (event_id, person_id, status, registration_id, created_at, updated_at) VALUES (?, ?, 'zugesagt', ?, '', '')", offen, anna, reg).lastInsertRowid);
  registrations.remove(reg, system);
  assert.equal(registrations.get(reg), null);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM shift_assignments').n, 0);
  const i = db.one('SELECT * FROM inquiries WHERE id = ?', inq);
  assert.equal(i.status, 'offen');
  assert.equal(i.registration_id, null);
  // Eine neue Anmeldung derselben Person ist wieder möglich
  assert.ok(registrations.create({ eventId: offen, personId: anna, matchType: 'auto', source: 'manuell', wishes: [], user: system }));
});

test('Anfragen: Selbst gemeldet, Sammelerfassung und Zurücknehmen', () => {
  const { anna, offen } = setup();
  const inquiries = require('../src/services/inquiries');
  const user = db.one('SELECT * FROM users WHERE id = ?', system.id) || system;
  inquiries.addAttempt(offen, anna, { channel: 'telefon', result: 'nicht_erreicht' }, user);
  assert.equal(events.stats(events.get(offen)).inquiryOpen, 1);
  // meldet sich danach selbst über das Formular
  registrations.create({ eventId: offen, personId: anna, enteredFirst: 'Anna', enteredLast: 'Roth', matchType: 'auto', source: 'formular', answer: 'ja', user });
  const row = inquiries.listForEvent(offen).find((r) => r.person_id === anna);
  assert.equal(row.state, 'angemeldet');
  assert.equal(events.stats(events.get(offen)).inquiryOpen, 0);

  // Zusage per Telefon erstellt Anmeldung, Zurücknehmen löscht sie wieder
  const chris = db.one("SELECT id FROM persons WHERE first_name = 'Christian'").id;
  inquiries.addAttempt(offen, chris, { channel: 'whatsapp', result: 'whatsapp' }, user);
  const r = inquiries.addAttempt(offen, chris, { channel: 'whatsapp', result: 'zugesagt' }, user);
  assert.ok(r.registrationId);
  const last = db.one('SELECT id FROM contact_attempts ORDER BY id DESC LIMIT 1').id;
  const first = db.one('SELECT a.id FROM contact_attempts a JOIN inquiries i ON i.id = a.inquiry_id WHERE i.person_id = ? ORDER BY a.id LIMIT 1', chris).id;
  assert.throws(() => inquiries.removeAttempt(offen, first, user), /letzte/);
  assert.equal(inquiries.removeAttempt(offen, last, user).regRemoved, true);
  assert.equal(db.one('SELECT COUNT(*) AS n FROM registrations WHERE id = ?', r.registrationId).n, 0);
  assert.equal(db.one('SELECT status FROM inquiries WHERE event_id = ? AND person_id = ?', offen, chris).status, 'whatsapp');
});

test('Rückmeldungen: Spalte pro Schicht und Zusage mit Schicht', () => {
  const { anna, offen } = setup();
  const inquiries = require('../src/services/inquiries');
  const feedback = require('../src/services/feedback');
  const d = db.one('SELECT date FROM events WHERE id = ?', offen).date;
  events.addShift(offen, { name: 'Abend', date: d, start_time: '19:00', end_time: '23:00', target_count: 3 }, system);
  const [tag, abend] = events.shiftsOf(offen);
  const bert = persons.create({ first_name: 'Bert', last_name: 'Keller', status: 'aktiv' }, system);
  // Anna sagt für den Abend zu, Bert ohne Schicht
  inquiries.addAttempt(offen, anna, { channel: 'telefon', result: 'zugesagt', shift_ids: [String(abend.id)] }, system);
  inquiries.addAttempt(offen, bert, { channel: 'telefon', result: 'zugesagt' }, system);
  const m = feedback.matrix({});
  const cols = m.columns.filter((c) => c.event.id === offen);
  assert.deepEqual(cols.map((c) => c.shift.id), [tag.id, abend.id]);
  const row = (id) => m.rows.find((r) => r.person.id === id);
  const states = (id) => row(id).cells.filter((c) => c.eventId === offen).map((c) => c.state);
  assert.deepEqual(states(anna), ['andere', 'an']);
  assert.deepEqual(states(bert), ['schicht_offen', 'schicht_offen']);
  assert.equal(m.colTotals[`${offen}:${abend.id}`].an, 1);
  assert.equal(m.totals[offen].an, 2, 'pro Einsatz zählen beide');
  assert.deepEqual(Object.keys(feedback.shiftChoices([offen])), [String(offen)]);
});
