'use strict';
// Aufgebot als Kalendertermin (Konzept 9.5) und Anmeldebestätigung per E-Mail
const crypto = require('node:crypto');
const db = require('../db');
const audit = require('./audit');
const settings = require('./settings');
const events = require('./events');
const mailer = require('../lib/mailer');
const { render } = require('../lib/template');
const { renderTemplate } = require('../lib/html');
const { buildCalendar } = require('../lib/ics');
const { nowIso, fmtDateLong, fmtDateShort, fmtDate } = require('../lib/dates');
const { BY_RANK } = require('../lib/sorting');

// Bausteine, gruppiert wie in den Einstellungen angezeigt
function blockGroups() {
  const groups = [
    { name: 'Einsatz', items: [['einsatz.name', 'Einsatzname'], ['einsatz.datum_kurz', 'Datum kurz'], ['einsatz.datum', 'Datum'], ['einsatz.beschreibung', 'Beschreibung'], ['einsatz.tenue', 'Tenue']] },
    { name: 'Schicht', items: [['schicht.name', 'Schichtname']] },
    { name: 'Antreten', items: [['antreten.datum', 'Datum'], ['antreten.zeit', 'Zeit'], ['antreten.ort', 'Ort']] },
    { name: 'Abtreten', items: [['abtreten.datum', 'Datum'], ['abtreten.zeit', 'Zeit'], ['abtreten.ort', 'Ort']] },
    { name: 'Personen', items: [['einsatzleitung', 'Einsatzleitung'], ['einsatzleitung.name', 'Einsatzleitung Name'], ['einsatzleitung.telefon', 'Einsatzleitung Telefon'], ['teilnehmende.liste', 'Teilnehmerliste'], ['teilnehmende.anzahl', 'Anzahl'], ['absender', 'Absender']] },
    { name: 'Verein', items: [['verein.aufgebot_email', 'Aufgebots-E-Mail']] },
  ];
  const extras = events.extraDefs();
  if (extras.length) groups.push({ name: 'Zusatzfelder', items: extras.map((d) => [`zusatzfeld.${d.name}`, d.name]) });
  return groups;
}

function senderName(user) {
  if (!user) return settings.get('verein_name');
  if (user.person_id) {
    const p = db.one('SELECT p.first_name, p.last_name, r.short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id WHERE p.id = ?', user.person_id);
    if (p) return `${p.short ? `${p.short} ` : ''}${p.first_name} ${p.last_name}`;
  }
  return user.display_name;
}

// Teilnehmende: bestätigte Anmeldungen (einer Schicht bzw. des ganzen Einsatzes)
function participants(event, shift) {
  const sql = shift
    ? `SELECT DISTINCT p.*, r.short AS rank_short FROM shift_assignments a JOIN registrations g ON g.id = a.registration_id
       JOIN persons p ON p.id = g.person_id LEFT JOIN ranks r ON r.id = p.rank_id WHERE a.shift_id = ? AND g.status = 'bestaetigt'`
    : `SELECT p.*, r.short AS rank_short FROM registrations g JOIN persons p ON p.id = g.person_id LEFT JOIN ranks r ON r.id = p.rank_id
       WHERE g.event_id = ? AND g.status = 'bestaetigt'`;
  return db.all(`${sql} ORDER BY ${BY_RANK}`, shift ? shift.id : event.id);
}

function timesOf(event, shift) {
  const list = shift ? [shift] : event.shifts;
  const starts = list.map((s) => s.starts_at).filter(Boolean).sort();
  const ends = list.map((s) => s.ends_at).filter(Boolean).sort();
  const sp = events.span(event.date, event.start_time, event.end_time);
  return { start: starts[0] || sp.starts_at, end: ends.at(-1) || sp.ends_at };
}

function context(event, shift, user, extra = {}) {
  const { start, end } = timesOf(event, shift);
  const people = participants(event, shift);
  const startPlace = shift?.start_place || event.start_place || '';
  const leaderName = event.leader_person_id ? `${event.leader_rank ? `${event.leader_rank} ` : ''}${event.leader_first} ${event.leader_last}` : '';
  // Bei nur einer (Standard-)Schicht bleibt der Schichtname leer
  const onlyDefault = event.shifts.length === 1;
  const values = {
    'einsatz.name': event.name,
    'einsatz.datum': fmtDate(event.date),
    'einsatz.datum_kurz': fmtDateShort(event.date),
    'einsatz.beschreibung': event.description || '',
    'einsatz.tenue': event.tenue || '',
    'schicht.name': shift ? (onlyDefault ? '' : shift.name) : (onlyDefault ? '' : 'Ganzer Einsatz'),
    'antreten.datum': start ? fmtDateLong(start.slice(0, 10)) : fmtDateLong(event.date),
    'antreten.zeit': start ? start.slice(11, 16) : '',
    'antreten.ort': startPlace,
    'abtreten.datum': end ? fmtDateLong(end.slice(0, 10)) : '',
    'abtreten.zeit': end ? end.slice(11, 16) : '',
    'abtreten.ort': event.end_place || startPlace,
    einsatzleitung: leaderName ? `${leaderName}${event.leader_mobile ? ` (${event.leader_mobile})` : ''}` : '',
    'einsatzleitung.name': leaderName,
    'einsatzleitung.telefon': event.leader_mobile || '',
    'teilnehmende.liste': people.map((p) => `${p.rank_short ? `${p.rank_short} ` : ''}${p.first_name} ${p.last_name}`).join('\n'),
    'teilnehmende.anzahl': String(people.length),
    'verein.aufgebot_email': settings.get('aufgebot_email'),
    absender: senderName(user),
    ...extra,
  };
  for (const [k, v] of Object.entries(event.extra || {})) values[`zusatzfeld.${k}`] = v;
  return { values, start, end, people };
}

// Titelzeile: übrig gebliebene Trennzeichen bei leeren Bausteinen entfernen
function cleanTitle(s) {
  return s.replace(/(\s+[-–·|])+\s*$/, '').replace(/^\s*([-–·|]\s+)+/, '').replace(/\s+[-–]\s+(?=[-–]\s)/g, ' ').trim();
}

// Formatierte Vorlage (HTML) -> { text, html }; alte Klartext-Vorlagen -> nur { text }
function renderRich(template, format, values, opts) {
  if (format === 'html') return renderTemplate(template, values, opts);
  return { text: render(template, values, opts), html: null };
}

function renderEntry(event, shift, user, tpl = settings.get('calendar')) {
  const { values, start, end, people } = context(event, shift, user);
  const opts = { omitEmptyLines: Boolean(tpl.omit_empty_lines) };
  const desc = renderRich(tpl.description, tpl.format, values, opts);
  return {
    summary: cleanTitle(render(tpl.title, values)),
    location: render(tpl.location, values),
    description: desc.text,
    descriptionHtml: desc.html,
    start, end, people,
  };
}

function uidFor(event, shift) {
  return shift ? `einsatz-${event.id}-schicht-${shift.id}@kkb-einsatzplaner` : `einsatz-${event.id}@kkb-einsatzplaner`;
}

// Gleiche UID + höhere SEQUENCE -> der Kalender aktualisiert statt zu verdoppeln
function sequenceFor(uid, content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  const row = db.one('SELECT * FROM calendar_exports WHERE uid = ?', uid);
  if (!row) {
    db.run('INSERT INTO calendar_exports (uid, content_hash, sequence, exported_at) VALUES (?, ?, 0, ?)', uid, hash, nowIso());
    return 0;
  }
  if (row.content_hash === hash) return row.sequence;
  db.run('UPDATE calendar_exports SET content_hash = ?, sequence = sequence + 1, exported_at = ? WHERE uid = ?', hash, nowIso(), uid);
  return row.sequence + 1;
}

/** scope: 'event' (ein Termin) | 'shifts' (je Schicht ein Termin) | 'shift' (eine Schicht) */
function exportIcs(eventId, { scope = 'event', shiftId = null } = {}, user) {
  const event = events.get(eventId);
  const tpl = settings.get('calendar');
  let targets = [null];
  if (scope === 'shift' && event.shifts.length > 1) targets = event.shifts.filter((s) => s.id === Number(shiftId));
  else if (scope === 'shifts' && event.shifts.length > 1) targets = event.shifts;
  if (!targets.length) targets = [null];
  const entries = targets.map((shift) => {
    const r = renderEntry(event, shift, user, tpl);
    const uid = uidFor(event, shift);
    const attendees = tpl.attendees ? r.people.filter((p) => p.email).map((p) => ({ name: `${p.first_name} ${p.last_name}`, email: p.email })) : [];
    // Formatierung zählt mit (sonst übernimmt der Kalender eine reine Farbänderung nicht)
    const rich = r.descriptionHtml ? [r.descriptionHtml, tpl.html_mode || 'alt'] : [];
    const sequence = sequenceFor(uid, JSON.stringify([r.summary, r.location, r.description, r.start, r.end, attendees, ...rich]));
    // Formatierung: als Zusatz (X-ALT-DESC, z. B. Outlook) oder direkt als HTML in der Beschreibung (z. B. Google)
    const htmlInDescription = r.descriptionHtml && tpl.html_mode === 'description';
    return {
      uid, sequence, summary: r.summary, location: r.location,
      description: htmlInDescription ? r.descriptionHtml : r.description, descriptionHtml: r.descriptionHtml,
      start: r.start || `${event.date}T00:00`, end: r.end || r.start || `${event.date}T23:59`, allDay: !r.start,
      organizer: { name: settings.get('verein_name'), email: settings.get('aufgebot_email') },
      attendees, reminderMinutes: Number(tpl.reminder_minutes) || 0,
    };
  });
  db.run('UPDATE events SET calendar_sent_at = ? WHERE id = ?', nowIso(), eventId);
  audit.log({
    entity: 'event', entityId: eventId, eventId, action: 'calendar',
    summary: `${user.display_name} hat den Kalendertermin für «${event.name}» exportiert${entries.length > 1 ? ` (${entries.length} Termine)` : ''}`, user,
  });
  const file = `${event.name}_${event.date}${scope === 'shift' && targets[0] ? `_${targets[0].name}` : ''}.ics`;
  return { ics: buildCalendar(entries, { method: 'PUBLISH' }), file };
}

// Anmeldebestätigung nach dem Bestätigen (sofern E-Mail hinterlegt)
// Betreff und Text der Anmeldebestätigung für eine Person und ihre zugeteilten Schichten
function renderConfirmation(event, assigned, person, user, conf = settings.get('confirmation')) {
  const shift = assigned.length === 1 ? assigned[0] : null;
  const { values } = context(event, shift, user, {
    'person.vorname': person.first_name,
    'person.nachname': person.last_name,
  });
  if (assigned.length > 1) values['schicht.name'] = assigned.map((s) => s.name).join(', ');
  const body = renderRich(conf.body, conf.format, values, { omitEmptyLines: true });
  return { subject: cleanTitle(render(conf.subject, values)), body: body.text, html: body.html };
}

async function sendConfirmation(registrationId, user) {
  const conf = settings.get('confirmation');
  if (!conf.enabled) return { skipped: 'deaktiviert' };
  const reg = db.one('SELECT g.*, p.first_name, p.last_name, p.email FROM registrations g JOIN persons p ON p.id = g.person_id WHERE g.id = ?', registrationId);
  if (!reg || !reg.email) return { skipped: 'keine E-Mail' };
  const event = events.get(reg.event_id);
  const assigned = db.all('SELECT s.* FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id WHERE a.registration_id = ? ORDER BY s.sort, s.starts_at', registrationId);
  const { subject, body, html } = renderConfirmation(event, assigned, reg, user, conf);
  const result = await mailer.send({ to: reg.email, subject, body, html, registrationId });
  db.run('UPDATE registrations SET confirmation_sent_at = ? WHERE id = ?', nowIso(), registrationId);
  return result;
}

module.exports = { blockGroups, context, renderEntry, exportIcs, sendConfirmation, renderConfirmation, participants, cleanTitle };
