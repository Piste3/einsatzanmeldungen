'use strict';
// Rückmeldungen: Mitglieder × anstehende Einsätze (An / Ab / Unsicher / Offen)
const db = require('../db');
const { today, addDays } = require('../lib/dates');

const PERIODS = {
  '2w': { label: 'nächste 2 Wochen', days: 14 },
  '1m': { label: 'nächster Monat', days: 31 },
  '3m': { label: 'nächste 3 Monate', days: 92 },
  '6m': { label: 'nächste 6 Monate', days: 183 },
  '12m': { label: 'nächstes Jahr', days: 366 },
};

/** Zustand einer Person für einen Einsatz aus Anmeldung und Anfrage ableiten */
function cellState(reg, inq) {
  if (reg && reg.status !== 'ungueltig') {
    if (['zurueckgezogen', 'abgesagt'].includes(reg.status)) return { state: 'ab', reg, inq };
    if (['rueckfrage', 'unsicher'].includes(reg.status)) return { state: 'unsicher', reg, inq };
    return { state: 'an', reg, inq };
  }
  if (inq) {
    if (inq.status === 'abgesagt') return { state: 'ab', reg, inq };
    if (inq.status === 'zugesagt') return { state: 'an', reg, inq };
    if (['nicht_erreicht', 'whatsapp'].includes(inq.status)) return { state: 'unsicher', reg, inq };
  }
  return { state: 'offen', reg, inq };
}

function upcomingEvents(period = '3m') {
  const days = PERIODS[period]?.days || PERIODS['3m'].days;
  return db.all(`SELECT * FROM events WHERE status IN ('veroeffentlicht','entwurf') AND date >= ? AND date <= ? ORDER BY date, start_time, id`,
    today(), addDays(today(), days));
}

function matrix({ team = '', period = '3m', sort = 'name', includeDrafts = false, q = '', only = '' } = {}) {
  let evts = upcomingEvents(period);
  if (!includeDrafts) evts = evts.filter((e) => e.status === 'veroeffentlicht');
  const params = [];
  let where = "p.status = 'aktiv'";
  if (team) { where += ' AND EXISTS (SELECT 1 FROM person_teams pt WHERE pt.person_id = p.id AND pt.team_id = ?)'; params.push(Number(team)); }
  const people = db.all(`SELECT p.*, r.short AS rank_short,
      (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams
    FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id WHERE ${where} ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`, ...params);
  const ids = evts.map((e) => e.id);
  const regs = new Map();
  const inqs = new Map();
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const r of db.all(`SELECT * FROM registrations WHERE event_id IN (${ph}) AND person_id IS NOT NULL`, ...ids)) regs.set(`${r.person_id}:${r.event_id}`, r);
    for (const i of db.all(`SELECT * FROM inquiries WHERE event_id IN (${ph})`, ...ids)) inqs.set(`${i.person_id}:${i.event_id}`, i);
    // Soll = Summe der Soll-Werte aller Schichten
    const soll = new Map(db.all(`SELECT event_id, SUM(target_count) AS n FROM shifts WHERE event_id IN (${ph}) GROUP BY event_id`, ...ids).map((r) => [r.event_id, r.n]));
    for (const e of evts) e.soll = soll.get(e.id) || null;
  }
  const totals = Object.fromEntries(evts.map((e) => [e.id, { an: 0, ab: 0, unsicher: 0, offen: 0 }]));
  let rows = people.map((p) => {
    const cells = evts.map((e) => {
      const c = cellState(regs.get(`${p.id}:${e.id}`), inqs.get(`${p.id}:${e.id}`));
      totals[e.id][c.state]++;
      return { ...c, eventId: e.id };
    });
    return { person: p, cells, openCount: cells.filter((c) => c.state === 'offen').length };
  });
  // Suche und «nur mit offenen» wirken auf die Zeilen, die Summen zählen weiterhin alle Mitglieder
  const allCount = rows.length;
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => `${r.person.first_name} ${r.person.last_name} ${r.person.last_name} ${r.person.first_name}`.toLowerCase().includes(needle));
  }
  if (only === 'offen') rows = rows.filter((r) => r.openCount > 0);
  if (only === 'unsicher') rows = rows.filter((r) => r.cells.some((c) => c.state === 'unsicher'));
  if (sort === 'offen') rows.sort((a, b) => b.openCount - a.openCount || a.person.last_name.localeCompare(b.person.last_name, 'de'));
  return { events: evts, rows, totals, allCount };
}

module.exports = { matrix, cellState, upcomingEvents, PERIODS };
