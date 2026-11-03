'use strict';
// Rückmeldungen: Mitglieder × anstehende Einsätze (An / Ab / Unsicher / Offen)
const db = require('../db');
const externals = require('./externals');
const history = require('./history');
const { today, addDays, isMultiDay, fmtShiftWhen } = require('../lib/dates');
const { rankOrder } = require('../lib/sorting');

const PERIODS = {
  '2w': { label: 'nächste 2 Wochen', days: 14 },
  '1m': { label: 'nächster Monat', days: 31 },
  '3m': { label: 'nächste 3 Monate', days: 92 },
  '6m': { label: 'nächste 6 Monate', days: 183 },
  '12m': { label: 'nächstes Jahr', days: 366 },
};

/**
 * Genaueres Symbol innerhalb eines Zustands (eigene Icons in der Tabelle):
 * an → bestaetigt / warteliste, unsicher → whatsapp (Nachricht gesendet) / telefon (nicht erreicht) / rueckfrage
 */
function detailOf(c) {
  const { state, reg, inq } = c;
  const activeReg = reg && reg.status !== 'ungueltig' ? reg : null;
  if (state === 'an' && activeReg) return { bestaetigt: 'bestaetigt', warteliste: 'warteliste' }[activeReg.status] || null;
  if (state === 'unsicher') {
    if (activeReg) return activeReg.status === 'rueckfrage' ? 'rueckfrage' : null;
    if (inq) return { whatsapp: 'whatsapp', nicht_erreicht: 'telefon' }[inq.status] || (inq.status === 'unsicher' && inq.last_channel === 'muendlich' ? 'muendlich' : null);
  }
  return null;
}

/** Zustand einer Person für einen Einsatz aus Anmeldung und Anfrage ableiten */
function cellState(reg, inq) {
  const c = baseState(reg, inq);
  c.detail = detailOf(c);
  return c;
}

function baseState(reg, inq) {
  if (reg && reg.status !== 'ungueltig') {
    if (['zurueckgezogen', 'abgesagt'].includes(reg.status)) return { state: 'ab', reg, inq };
    if (['rueckfrage', 'unsicher'].includes(reg.status)) return { state: 'unsicher', reg, inq };
    return { state: 'an', reg, inq };
  }
  if (inq) {
    if (inq.status === 'abgesagt') return { state: 'ab', reg, inq };
    if (inq.status === 'zugesagt') return { state: 'an', reg, inq };
    if (['nicht_erreicht', 'whatsapp', 'unsicher'].includes(inq.status)) return { state: 'unsicher', reg, inq };
  }
  return { state: 'offen', reg, inq };
}

function upcomingEvents(period = '3m') {
  const days = PERIODS[period]?.days || PERIODS['3m'].days;
  // Mehrtägige Einsätze zählen, solange ihr letzter Tag nicht vorbei ist
  return db.all(`SELECT * FROM events WHERE status IN ('veroeffentlicht','entwurf') AND date_to >= ? AND date_from <= ? ORDER BY date_from, start_time, id`,
    today(), addDays(today(), days));
}

function matrix({ team = '', period = '3m', sort = 'rang', includeDrafts = false, q = '', only = '' } = {}) {
  let evts = upcomingEvents(period);
  if (!includeDrafts) evts = evts.filter((e) => e.status === 'veroeffentlicht');
  const params = [];
  let where = "p.status = 'aktiv'";
  if (team) { where += ' AND EXISTS (SELECT 1 FROM person_teams pt WHERE pt.person_id = p.id AND pt.team_id = ?)'; params.push(Number(team)); }
  const people = db.all(`SELECT p.*, r.short AS rank_short,
      (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams
    FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id WHERE ${where} ORDER BY ${rankOrder(sort)}`, ...params);
  const ids = evts.map((e) => e.id);
  const regs = new Map();
  const inqs = new Map();
  const assigned = new Map();
  // wer den aktuellen Stand gesetzt hat (letzter Historie-Eintrag pro Person und Einsatz)
  const latest = history.latestByPair(ids);
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const r of db.all(`SELECT * FROM registrations WHERE event_id IN (${ph}) AND person_id IS NOT NULL`, ...ids)) regs.set(`${r.person_id}:${r.event_id}`, r);
    for (const i of db.all(`SELECT i.*, (SELECT a.channel FROM contact_attempts a WHERE a.inquiry_id = i.id ORDER BY a.contacted_at DESC, a.id DESC LIMIT 1) AS last_channel FROM inquiries i WHERE i.event_id IN (${ph})`, ...ids)) inqs.set(`${i.person_id}:${i.event_id}`, i);
    // Soll = Summe der Soll-Werte aller Schichten
    const soll = new Map(db.all(`SELECT event_id, SUM(target_count) AS n FROM shifts WHERE event_id IN (${ph}) GROUP BY event_id`, ...ids).map((r) => [r.event_id, r.n]));
    const shifts = new Map();
    for (const sh of db.all(`SELECT id, event_id, name, starts_at, ends_at, target_count FROM shifts WHERE event_id IN (${ph}) ORDER BY sort, starts_at, id`, ...ids)) {
      if (!shifts.has(sh.event_id)) shifts.set(sh.event_id, []);
      shifts.get(sh.event_id).push(sh);
    }
    for (const e of evts) {
      e.soll = soll.get(e.id) || null;
      // Externe Abteilungen (nur Anzahl) pro Schicht; Summe wie beim Soll über alle Schichten
      e.externByShift = externals.countsByShift(e.id, shifts.get(e.id) || []);
      e.extern = Object.values(e.externByShift).reduce((a, n) => a + n, 0);
      // Nur bei mehreren Schichten eine Spalte pro Schicht
      e.shifts = (shifts.get(e.id) || []).length > 1 ? shifts.get(e.id) : [];
    }
    for (const a of db.all(`SELECT a.registration_id, a.shift_id FROM shift_assignments a JOIN registrations g ON g.id = a.registration_id WHERE g.event_id IN (${ph})`, ...ids)) {
      if (!assigned.has(a.registration_id)) assigned.set(a.registration_id, new Set());
      assigned.get(a.registration_id).add(a.shift_id);
    }
  } else for (const e of evts) { e.shifts = []; e.externByShift = {}; e.extern = 0; }
  // Spalten: ein Einsatz oder eine Schicht eines Einsatzes
  const columns = evts.flatMap((e) => (e.shifts.length
    ? e.shifts.map((sh, i) => ({ event: e, shift: sh, first: i === 0, key: `${e.id}:${sh.id}` }))
    : [{ event: e, shift: null, first: true, key: `${e.id}:0` }]));
  const totals = Object.fromEntries(evts.map((e) => [e.id, { an: 0, ab: 0, unsicher: 0, offen: 0 }]));
  const colTotals = Object.fromEntries(columns.map((c) => [c.key, { an: 0, ab: 0, unsicher: 0, offen: 0, andere: 0, schicht_offen: 0 }]));
  // Schichten einer Anmeldung: Zuteilung, sonst die Wünsche aus dem Formular
  const shiftsOf = (reg, e) => {
    if (!reg) return new Set();
    if (assigned.has(reg.id)) return assigned.get(reg.id);
    let wishes = [];
    try { wishes = JSON.parse(reg.shift_wishes || '[]').map(Number); } catch { /* keine */ }
    return new Set(wishes.filter((id) => e.shifts.some((sh) => sh.id === id)));
  };
  let rows = people.map((p) => {
    const eventCells = evts.map((e) => {
      const c = cellState(regs.get(`${p.id}:${e.id}`), inqs.get(`${p.id}:${e.id}`));
      totals[e.id][c.state]++;
      return { ...c, eventId: e.id, last: latest.get(`${p.id}:${e.id}`) || null };
    });
    const byEvent = new Map(eventCells.map((c) => [c.eventId, c]));
    const cells = columns.map((col) => {
      const base = byEvent.get(col.event.id);
      let state = base.state;
      if (col.shift && state === 'an') {
        const mine = shiftsOf(base.reg, col.event);
        state = !mine.size ? 'schicht_offen' : mine.has(col.shift.id) ? 'an' : 'andere';
      }
      colTotals[col.key][state]++;
      return { ...base, state, detail: state === base.state ? base.detail : null, shiftId: col.shift?.id || null };
    });
    return { person: p, cells, eventCells, openCount: eventCells.filter((c) => c.state === 'offen').length };
  });
  // Suche und «nur mit offenen» wirken auf die Zeilen, die Summen zählen weiterhin alle Mitglieder
  const allCount = rows.length;
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) => `${r.person.first_name} ${r.person.last_name} ${r.person.last_name} ${r.person.first_name}`.toLowerCase().includes(needle));
  }
  if (only === 'offen') rows = rows.filter((r) => r.openCount > 0);
  if (only === 'unsicher') rows = rows.filter((r) => r.cells.some((c) => c.state === 'unsicher'));
  // Standard: nach Rang (aus der Abfrage); sort() ist stabil, gleiche Werte behalten die Rangfolge
  if (sort === 'offen') rows.sort((a, b) => b.openCount - a.openCount);
  if (sort === 'name') rows.sort((a, b) => a.person.last_name.localeCompare(b.person.last_name, 'de') || a.person.first_name.localeCompare(b.person.first_name, 'de'));
  return { events: evts, columns, rows, totals, colTotals, allCount };
}

// Schichten zur Auswahl beim Erfassen einer Zusage: { eventId: [{ id, name, time }] }, nur Einsätze mit mehreren Schichten
function shiftChoices(eventIds) {
  const ids = (eventIds || upcomingEvents('12m').map((e) => e.id)).map(Number).filter(Boolean);
  if (!ids.length) return {};
  const out = {};
  const ph = ids.map(() => '?').join(',');
  // Bei Schichten an verschiedenen Tagen steht der Tag vor der Zeit
  const multi = new Set(db.all(`SELECT id, date_from, date_to FROM events WHERE id IN (${ph})`, ...ids).filter(isMultiDay).map((e) => e.id));
  for (const sh of db.all(`SELECT id, event_id, name, starts_at, ends_at FROM shifts WHERE event_id IN (${ph}) ORDER BY sort, starts_at, id`, ...ids)) {
    (out[sh.event_id] ||= []).push({ id: sh.id, name: sh.name, time: fmtShiftWhen(sh, multi.has(sh.event_id)) });
  }
  for (const k of Object.keys(out)) if (out[k].length < 2) delete out[k];
  return out;
}

module.exports = { matrix, cellState, upcomingEvents, shiftChoices, PERIODS };
