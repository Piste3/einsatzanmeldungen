'use strict';
// Zahlen stimmen überall überein: Besetzung, Reiter «Anfragen», Cockpit «Noch nicht bestätigt»
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, system } = require('./helpers');
const db = require('../src/db');
const persons = require('../src/services/persons');
const events = require('../src/services/events');
const registrations = require('../src/services/registrations');
const inquiries = require('../src/services/inquiries');
const feedback = require('../src/services/feedback');
const cockpit = require('../src/services/cockpit');
const { today, addDays } = require('../src/lib/dates');

function setup() {
  freshDb();
  const id = events.create({ name: 'Herbstmesse', date: addDays(today(), 5), start_time: '13:00', end_time: '19:00', target_count: 5 }, system);
  events.setStatus(id, 'veroeffentlicht', system);
  const d = db.one('SELECT date FROM events WHERE id = ?', id).date;
  events.addShift(id, { name: 'Abend', date: d, start_time: '19:00', end_time: '23:00', target_count: 3 }, system);
  const [tag, abend] = events.shiftsOf(id);
  const p = (first) => persons.create({ first_name: first, last_name: 'Test', status: 'aktiv' }, system);
  const reg = (person, shift, status) => registrations.create({ eventId: id, personId: person, source: 'manuell', wishes: [shift.id], status, user: system });
  return { id, tag, abend, p, reg };
}

test('Besetzung: Rückmeldungen zählt wie Schichten (Neu, Rückfrage, Bestätigt; ohne Warteliste)', () => {
  const { id, tag, abend, p, reg } = setup();
  reg(p('Neu'), tag, 'neu');
  reg(p('Best'), tag, 'bestaetigt');
  reg(p('Warte'), tag, 'warteliste');
  reg(p('Frage'), abend, 'rueckfrage');
  const st = events.stats(events.get(id));
  const ist = Object.fromEntries(st.shifts.map((s) => [s.id, s.ist]));
  assert.deepEqual([ist[tag.id], ist[abend.id]], [2, 1]);
  const ev = feedback.matrix({}).events.find((e) => e.id === id);
  assert.deepEqual([ev.istByShift[tag.id], ev.istByShift[abend.id]], [2, 1], 'gleiche Zahlen wie im Reiter Schichten');
});

test('Reiter Anfragen: Zahl = Gruppe «Noch offen»', () => {
  const { id, tag, p, reg } = setup();
  const a = p('A');
  const b = p('B');
  p('C'); // noch nicht angefragt
  const angemeldet = p('D');
  reg(angemeldet, tag, 'neu');
  inquiries.addAttempt(id, a, { channel: 'telefon', result: 'nicht_erreicht' }, system);
  inquiries.addAttempt(id, b, { channel: 'telefon', result: 'abgesagt' }, system);
  const list = inquiries.listForEvent(id);
  const open = list.filter((r) => !['zugesagt', 'angemeldet', 'abgesagt'].includes(r.state)).length;
  assert.equal(open, 2);
  assert.equal(inquiries.openCount(id), open);
});

test('Cockpit «Noch nicht bestätigt»: ohne Warteliste', () => {
  const { tag, p, reg } = setup();
  reg(p('Neu'), tag, 'neu');
  reg(p('Frage'), tag, 'rueckfrage');
  reg(p('Warte'), tag, 'warteliste');
  const statuses = cockpit.data(system).unconfirmed.map((r) => r.status).sort();
  assert.deepEqual(statuses, ['neu', 'rueckfrage']);
});
