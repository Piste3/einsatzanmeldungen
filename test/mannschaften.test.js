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

test('Mindestalter 16+ / 18+: Alter am Tag der Schicht, unbekannt zählt als vorgesehen', () => {
  const st = require('../src/services/shift-teams');
  assert.equal(st.ageOn({ birth_date: '2008-11-20' }, '2026-11-19'), 17);
  assert.equal(st.ageOn({ birth_date: '2008-11-20' }, '2026-11-20'), 18);
  assert.equal(st.ageOn({ birth_year: 2010 }, '2026-03-01'), 16);
  assert.equal(st.ageOn({}, '2026-03-01'), null);
  const { id, tag, abend, k, z } = setup();
  const day = abend.starts_at.slice(0, 10);
  const y = Number(day.slice(0, 4));
  db.run('UPDATE persons SET birth_year = ? WHERE id = ?', y - 17, k);   // 17 -> zu jung für 18+
  db.run('UPDATE persons SET birth_year = ? WHERE id = ?', y - 20, z);   // 20 -> passt
  const row = (s, extra) => ({ name: s.name, date: day, start: s.starts_at.slice(11, 16), end: s.ends_at.slice(11, 16), ...extra });
  events.saveShifts(id, { [abend.id]: row(abend, { min_age: '18' }) }, null, system);
  const a2 = events.shiftsOf(id)[1];
  assert.equal(a2.min_age, 18);
  assert.equal(a2.rule, '18+');
  const m = feedback.matrix({});
  const col = m.columns.findIndex((c) => c.shift && c.shift.id === abend.id);
  assert.equal(m.rows.find((r) => r.person.id === k).cells[col].state, 'nicht_vorgesehen');
  assert.equal(m.rows.find((r) => r.person.id === z).cells[col].state, 'offen');
  assert.equal(m.columns[col].planned, '18+');
  // ohne Feld im Formular bleibt der Wert; «alle» löscht ihn
  events.saveShifts(id, { [abend.id]: row(abend, { name: 'Abend 2' }) }, null, system);
  assert.equal(events.shiftsOf(id)[1].min_age, 18);
  events.saveShifts(id, { [abend.id]: row(abend, { name: 'Abend 2', min_age: '' }) }, null, system);
  assert.equal(events.shiftsOf(id)[1].min_age, null);
  assert.ok(tag);
});

test('Mindestrang (z. B. ab KS): dieser Rang und höher, ohne Rang = vorgesehen', () => {
  const { id, abend, k, z } = setup();
  const ranks = db.all('SELECT id, short, sort FROM ranks ORDER BY sort');
  const ks = Number(db.run("INSERT INTO ranks (name, short, sort) VALUES ('Kaderschüler', 'KS', ?)", ranks[1].sort).lastInsertRowid);
  db.run('UPDATE ranks SET sort = sort + 1 WHERE sort >= ? AND id <> ?', ranks[1].sort, ks);
  db.run('UPDATE persons SET rank_id = ? WHERE id = ?', ranks[0].id, k); // Sdt -> zu tief
  db.run('UPDATE persons SET rank_id = ? WHERE id = ?', ks, z);          // KS -> passt
  const n = persons.create({ first_name: 'Ohne', last_name: 'Rang', status: 'aktiv' }, system);
  const day = abend.starts_at.slice(0, 10);
  events.saveShifts(id, { [abend.id]: { name: abend.name, date: day, start: abend.starts_at.slice(11, 16), end: abend.ends_at.slice(11, 16), min_rank_id: String(ks) } }, null, system);
  assert.equal(events.shiftsOf(id)[1].rule, 'ab KS');
  const m = feedback.matrix({});
  const col = m.columns.findIndex((c) => c.shift && c.shift.id === abend.id);
  const state = (p) => m.rows.find((r) => r.person.id === p).cells[col].state;
  assert.equal(state(k), 'nicht_vorgesehen');
  assert.equal(state(z), 'offen');
  assert.equal(state(n), 'offen');
});
