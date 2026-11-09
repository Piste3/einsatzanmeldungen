'use strict';
// Vorgesehene Mannschaften pro Schicht: nur Hinweis, Anmelden bleibt möglich; Rückmeldungen mit eigenem Symbol
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, system } = require('./helpers');
const db = require('../src/db');
const persons = require('../src/services/persons');
const events = require('../src/services/events');
const registrations = require('../src/services/registrations');
const feedback = require('../src/services/feedback');
const { today, addDays } = require('../src/lib/dates');

function setup() {
  freshDb();
  const kader = Number(db.run("INSERT INTO teams (name, sort) VALUES ('Kader', 1)").lastInsertRowid);
  const zug = Number(db.run("INSERT INTO teams (name, sort) VALUES ('Zug 1', 2)").lastInsertRowid);
  const id = events.create({ name: 'Messe', date: addDays(today(), 5), start_time: '13:00', end_time: '19:00' }, system);
  events.setStatus(id, 'veroeffentlicht', system);
  const d = db.one('SELECT date FROM events WHERE id = ?', id).date;
  events.addShift(id, { name: 'Abend', date: d, start: '19:00', end: '23:00' }, system);
  const [tag, abend] = events.shiftsOf(id);
  const k = persons.create({ first_name: 'Karl', last_name: 'Kader', status: 'aktiv', team_ids: [kader] }, system);
  const z = persons.create({ first_name: 'Zora', last_name: 'Zug', status: 'aktiv', team_ids: [zug] }, system);
  return { id, tag, abend, kader, zug, k, z };
}

test('Schichten speichern: Mannschaften pro Schicht, leer = alle', () => {
  const { id, tag, abend, kader } = setup();
  const row = (s, extra) => ({ name: s.name, date: s.starts_at.slice(0, 10), start: s.starts_at.slice(11, 16), end: s.ends_at.slice(11, 16), ...extra });
  events.saveShifts(id, { [abend.id]: row(abend, { teams_shown: '1', teams: [String(kader)] }), [tag.id]: row(tag, { teams_shown: '1' }) }, null, system);
  const [t2, a2] = events.shiftsOf(id);
  assert.deepEqual(t2.teams, []);
  assert.deepEqual(a2.teams, [kader]);
  const log = db.one("SELECT details FROM audit_log WHERE entity_type = 'shift' AND entity_id = ? ORDER BY id DESC", abend.id);
  assert.match(log.details, /Kader/);
  // ohne Feld im Formular bleibt die Einstellung
  events.saveShifts(id, { [abend.id]: row(abend, { name: 'Abendschicht' }) }, null, system);
  assert.deepEqual(events.shiftsOf(id)[1].teams, [kader]);
});

test('Rückmeldungen: nicht vorgesehen = eigenes Symbol, Anmeldung bleibt möglich', () => {
  const { id, tag, abend, kader, k, z } = setup();
  db.run('UPDATE shifts SET team_ids = ? WHERE id = ?', JSON.stringify([kader]), abend.id);
  // Zora (Zug 1) meldet sich trotzdem für die Kader-Schicht an
  const reg = registrations.create({ eventId: id, personId: z, source: 'formular', wishes: [abend.id] });
  assert.ok(db.one('SELECT 1 FROM shift_assignments WHERE registration_id = ? AND shift_id = ?', reg, abend.id), 'Einteilung trotzdem möglich');
  const m = feedback.matrix({});
  const col = (s) => m.columns.findIndex((c) => c.shift && c.shift.id === s.id);
  const cells = (p) => m.rows.find((r) => r.person.id === p).cells;
  assert.equal(cells(k)[col(abend)].state, 'offen');
  assert.equal(cells(k)[col(abend)].notPlanned, false);
  assert.equal(cells(z)[col(abend)].state, 'an');
  assert.equal(cells(z)[col(abend)].notPlanned, true, 'angemeldet, aber markiert');
  assert.equal(cells(z)[col(tag)].state, 'andere');
  // Eine Person ohne Anmeldung: Kader-Schicht nicht vorgesehen, Tagschicht offen
  const n = persons.create({ first_name: 'Nina', last_name: 'Neu', status: 'aktiv' }, system);
  const m2 = feedback.matrix({});
  const c2 = m2.rows.find((r) => r.person.id === n).cells;
  assert.equal(c2[col(abend)].state, 'nicht_vorgesehen');
  assert.equal(c2[col(tag)].state, 'offen');
  assert.equal(m2.colTotals[`${id}:${abend.id}`].nicht_vorgesehen, 1);
});

test('Rückmeldungen: Einsatz mit nur Kader-Schichten zählt Nicht-Kader nicht als offen', () => {
  const { id, tag, abend, kader, z } = setup();
  db.run('UPDATE shifts SET team_ids = ? WHERE event_id = ?', JSON.stringify([kader]), id);
  const row = feedback.matrix({ only: 'offen' }).rows.find((r) => r.person.id === z);
  assert.equal(row, undefined, 'Zora hat keinen offenen Einsatz');
  const all = feedback.matrix({});
  assert.equal(all.totals[id].nicht_vorgesehen, 1);
  assert.ok(tag && abend);
});
