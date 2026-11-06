'use strict';
// Cockpit: Was ist heute zu tun?
const db = require('../db');
const events = require('./events');
const audit = require('./audit');
const { today, addDays, daysUntil, localNow } = require('../lib/dates');
const { BY_RANK } = require('../lib/sorting');

function data() {
  // Auch Einsätze ohne Datum zeigen (noch in Planung)
  const upcoming = events.list({ status: 'aktiv', from: today(), to: addDays(today(), 92), undated: true });
  const rows = upcoming.map((e) => ({ ...e, stats: events.stats(e), inForm: events.isInForm(e) }));
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const kpis = {
    neu: db.one("SELECT COUNT(*) AS n FROM registrations g JOIN events e ON e.id = g.event_id WHERE g.status = 'neu' AND e.status IN ('entwurf','veroeffentlicht')").n,
    neuSeit: db.one("SELECT COUNT(*) AS n FROM registrations WHERE registered_at > ? AND status <> 'ungueltig'", since).n,
    klaeren: db.one("SELECT COUNT(*) AS n FROM registrations WHERE person_id IS NULL AND status = 'unsicher'").n,
    nichtErreicht: db.one(`SELECT COUNT(*) AS n FROM inquiries i JOIN events e ON e.id = i.event_id
      WHERE i.status IN ('nicht_erreicht','whatsapp','unsicher') AND e.date_to >= ? AND e.status = 'veroeffentlicht'
      AND NOT EXISTS (SELECT 1 FROM registrations g WHERE g.event_id = i.event_id AND g.person_id = i.person_id AND g.status <> 'ungueltig')`, today()).n,
    next: rows.find((e) => e.status === 'veroeffentlicht' && e.date_from) || rows.find((e) => e.date_from) || null,
  };
  return { rows, kpis, todos: todos(rows, kpis), activity: audit.recent(12), formErrors: formErrorCount(), unconfirmed: unconfirmed() };
}

// Anmeldungen, die noch nicht bestätigt sind (Neu, Rückfrage) – für anstehende Einsätze. Die Warteliste ist ein bewusster Entscheid und fehlt hier.
function unconfirmed() {
  const rows = db.all(`SELECT g.id, g.status, g.source, g.registered_at, g.remark, g.internal_note, g.event_id, e.name AS event_name, e.date_from AS event_date, e.date_to AS event_date_to, e.status AS event_status,
      p.id AS person_id, p.first_name, p.last_name, r.short AS rank_short,
      (SELECT group_concat(s.name, ', ') FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id WHERE a.registration_id = g.id) AS shifts
    FROM registrations g JOIN events e ON e.id = g.event_id JOIN persons p ON p.id = g.person_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE g.status IN ('neu','rueckfrage') AND e.status IN ('entwurf','veroeffentlicht') AND (e.date_to >= ? OR e.date_from IS NULL)
    ORDER BY e.date_from IS NULL, e.date_from, e.id, ${BY_RANK}`, today());
  return rows;
}

function formErrorCount() {
  return db.one("SELECT COUNT(*) AS n FROM form_submissions WHERE status = 'fehler'").n;
}

// Konkrete Hinweise
function todos(rows, kpis) {
  const list = [];
  if (kpis.klaeren) list.push({ tag: 'Klären', tone: 'yellow', text: `${kpis.klaeren} Anmeldung${kpis.klaeren === 1 ? '' : 'en'} ohne sichere Zuordnung`, href: '/klaerungen' });
  const errors = formErrorCount();
  if (errors) list.push({ tag: 'Formular', tone: 'red', text: `${errors} Formular-Eingang mit Fehler`, href: '/formulare?status=fehler' });
  for (const e of rows) {
    const s = e.stats;
    if (e.inForm && s.full) list.push({ tag: 'Formular', tone: 'orange', text: `${e.name}: alle Schichten voll, Einsatz steht noch im Formular`, href: `/einsaetze/${e.id}` });
    for (const sh of s.shifts) {
      if (!s.full && e.inForm && sh.soll && sh.ist >= sh.soll && e.shifts.length > 1) {
        list.push({ tag: 'Formular', tone: 'orange', text: `${e.name}: ${sh.name} ist voll, Einsatz steht noch im Formular`, href: `/einsaetze/${e.id}/schichten` });
      }
    }
    if (s.neu) list.push({ tag: 'Bestätigen', tone: 'blue', text: `${e.name}: ${s.neu} neue Anmeldung${s.neu === 1 ? '' : 'en'} bestätigen`, href: `/einsaetze/${e.id}/anmeldungen?status=neu` });
    if (s.inquiryOpen) list.push({ tag: 'Nachfassen', tone: 'blue', text: `${e.name}: ${s.inquiryOpen} Person${s.inquiryOpen === 1 ? '' : 'en'} noch nicht erreicht`, href: `/einsaetze/${e.id}/anfragen?status=alle` });
    const days = e.date_from ? daysUntil(e.date_from) : null;
    if (e.status === 'veroeffentlicht' && days !== null && days <= 7 && s.bestaetigt && !e.calendar_sent_at) {
      list.push({ tag: 'Aufgebot', tone: 'gray', text: `Kalendertermin ${e.name} noch nicht exportiert`, href: `/einsaetze/${e.id}` });
    }
    if (e.status === 'entwurf' && days !== null && days <= 21) list.push({ tag: 'Entwurf', tone: 'gray', text: `${e.name} ist noch nicht veröffentlicht (in ${days} Tagen)`, href: `/einsaetze/${e.id}` });
    if (!e.date_from) list.push({ tag: 'Datum', tone: 'gray', text: `${e.name} hat noch kein Datum (Einsatz oder Schichten)`, href: `/einsaetze/${e.id}/schichten` });
  }
  // Vorbei, aber noch nicht abgeschlossen
  for (const e of events.list({ status: 'veroeffentlicht', to: today() })) {
    const end = events.lastEnd(e);
    if (end && end <= localNow()) list.push({ tag: 'Abschliessen', tone: 'gray', text: `${e.name} ist vorbei und kann abgeschlossen werden`, href: `/einsaetze/${e.id}` });
  }
  return list;
}

function navCounts() {
  return {
    klaerungen: db.one("SELECT COUNT(*) AS n FROM registrations WHERE person_id IS NULL AND status = 'unsicher'").n,
    formErrors: formErrorCount(),
  };
}

module.exports = { data, navCounts };
