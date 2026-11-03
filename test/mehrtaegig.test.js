'use strict';
// Einsätze ohne eigenes Datum: Schichten an verschiedenen Tagen
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { freshDb, system } = require('./helpers');
const db = require('../src/db');
const events = require('../src/services/events');
const calendar = require('../src/services/calendar');
const feedback = require('../src/services/feedback');
const submissions = require('../src/services/submissions');
const { today, addDays, fmtEventDate, fmtRange, fmtShiftWhen } = require('../src/lib/dates');
const { ValidationError } = require('../src/services/errors');

const d1 = addDays(today(), 10);
const d2 = addDays(today(), 11);

function multiDayEvent() {
  const id = events.create({ name: 'Herbstlager', date: '' }, system);
  const [first] = events.get(id).shifts;
  events.saveShifts(id, { [first.id]: { name: 'Aufbau', date: d1, start: '08:00', end: '12:00' } },
    { name: 'Abbau', date: d2, start: '14:00', end: '18:00', fn_target_1: '4' }, system);
  return id;
}

test('Einsatz ohne Datum anlegen; Zeitraum kommt aus den Schichten', () => {
  freshDb();
  const id = events.create({ name: 'Ohne Datum' }, system);
  const e = events.get(id);
  assert.equal(e.date, null);
  assert.equal(e.date_from, null);
  assert.equal(fmtEventDate(e), 'Datum offen');
  assert.equal(events.checklist(e)[0].done, false);
  assert.throws(() => events.setStatus(id, 'veroeffentlicht', system), ValidationError, 'ohne jedes Datum nicht veröffentlichen');
  // Schicht mit Zeit, aber ohne Tag geht nicht, solange der Einsatz kein Datum hat
  assert.throws(() => events.saveShifts(id, { [e.shifts[0].id]: { name: 'Ganzer Einsatz', start: '08:00' } }, null, system), ValidationError);

  const multi = multiDayEvent();
  const m = events.get(multi);
  assert.equal(m.date, null);
  assert.equal(m.date_from, d1);
  assert.equal(m.date_to, d2);
  assert.deepEqual(m.shifts.map((s) => s.starts_at.slice(0, 10)), [d1, d2]);
  assert.equal(events.checklist(m)[0].done, true);
  events.setStatus(multi, 'veroeffentlicht', system);
  assert.equal(events.isInForm(events.get(multi)), true);
});

test('Sortierung und Filter nach Zeitraum; Einsatzdatum bleibt optional änderbar', () => {
  freshDb();
  const multi = multiDayEvent();
  const single = events.create({ name: 'Eintägig', date: addDays(today(), 12), start_time: '10:00', end_time: '12:00' }, system);
  events.create({ name: 'Noch offen' }, system);
  // Ein Filter, der nur den zweiten Tag trifft, findet den mehrtägigen Einsatz trotzdem
  assert.deepEqual(events.list({ from: d2, to: d2 }).map((e) => e.id), [multi]);
  assert.deepEqual(events.list({ from: today(), to: addDays(today(), 30) }).map((e) => e.name), ['Herbstlager', 'Eintägig']);
  assert.deepEqual(events.list({ from: today(), to: addDays(today(), 30), undated: true }).map((e) => e.name), ['Herbstlager', 'Eintägig', 'Noch offen']);
  // Einsatzdatum nachträglich setzen und wieder leeren
  const e = events.get(multi);
  events.update(multi, { name: e.name, date: addDays(today(), 9) }, e.version, system);
  assert.equal(events.get(multi).date_from, addDays(today(), 9));
  const e2 = events.get(multi);
  events.update(multi, { name: e2.name, date: '' }, e2.version, system);
  assert.equal(events.get(multi).date_from, d1);
  // Einzige Standardschicht bleibt ohne Einsatzdatum an ihrem Tag
  const s = events.get(single);
  events.update(single, { name: s.name, date: '', start_time: '09:00', end_time: '11:00' }, s.version, system);
  const after = events.get(single);
  assert.equal(after.shifts[0].starts_at, `${addDays(today(), 12)}T09:00`);
  assert.equal(after.date_from, addDays(today(), 12));
});

test('Anzeige, Kalender, Formular und Rückmeldungen bei Schichten an verschiedenen Tagen', () => {
  freshDb();
  const multi = multiDayEvent();
  events.setStatus(multi, 'veroeffentlicht', system);
  const e = events.get(multi);
  assert.equal(fmtEventDate(e), fmtRange(d1, d2));
  assert.match(fmtShiftWhen(e.shifts[1], true), /^\S\S \d\d\.\d\d\. 14:00–18:00$/);
  // Kalender: ganzer Einsatz von der ersten bis zur letzten Schicht, je Schicht ein Termin mit eigenem Tag
  const whole = calendar.renderEntry(e, null, system);
  assert.equal(whole.start, `${d1}T08:00`);
  assert.equal(whole.end, `${d2}T18:00`);
  const ics = calendar.exportIcs(multi, { scope: 'shifts' }, system).ics;
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2);
  const ctx = calendar.context(e, e.shifts[1], system).values;
  assert.equal(ctx['antreten.zeit'], '14:00');
  assert.equal(ctx['einsatz.datum'], fmtRange(d2, d2));
  assert.equal(calendar.context(e, null, system).values['einsatz.datum'], fmtRange(d1, d2));
  // Formular und Rückmeldungen
  assert.deepEqual(submissions.issueForm('127.0.0.1').events.map((x) => x.id), [multi]);
  assert.deepEqual(feedback.upcomingEvents('3m').map((x) => x.id), [multi]);
  const choices = feedback.shiftChoices([multi])[multi];
  assert.match(choices[0].time, /08:00–12:00$/);
  assert.notEqual(choices[0].time, '08:00–12:00', 'Tag steht vor der Zeit');
  // Ohne Datum kein Kalendertermin
  const none = events.create({ name: 'Ohne Datum' }, system);
  assert.throws(() => calendar.exportIcs(none, {}, system), ValidationError);
});

test('Bestehende Datenbank: Datum wird freiwillig, Zeitraum wird nachgerechnet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kkb-mig-'));
  const file = path.join(dir, 'alt.sqlite');
  // Alte Tabellen: Datum ist Pflicht, kein date_from/date_to
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY, name TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT, end_time TEXT,
    status TEXT NOT NULL DEFAULT 'entwurf', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE shifts (id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE, name TEXT NOT NULL, starts_at TEXT, ends_at TEXT);
    INSERT INTO events (name, date, created_at, updated_at) VALUES ('Alt', '2026-05-01', 'x', 'x');
    INSERT INTO shifts (event_id, name, starts_at) VALUES (1, 'Nacht', '2026-05-02T20:00');`);
  old.close();
  try {
    db.close();
    db.open(file);
    const row = db.one('SELECT date, date_from, date_to FROM events WHERE id = 1');
    assert.deepEqual({ ...row }, { date: '2026-05-01', date_from: '2026-05-01', date_to: '2026-05-02' });
    db.run("INSERT INTO events (name, date, created_at, updated_at) VALUES ('Neu', NULL, 'x', 'x')");
    assert.equal(db.one("SELECT COUNT(*) AS n FROM shifts WHERE event_id = 1").n, 1, 'Schichten bleiben erhalten');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
