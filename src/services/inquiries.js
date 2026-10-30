'use strict';
// Nachfassen per Telefon und WhatsApp (Konzept 8.4)
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const registrations = require('./registrations');
const { nowIso, localNow, fmtLocal } = require('../lib/dates');
const { INQUIRY_STATUS, ATTEMPT_RESULT, CHANNEL } = require('../lib/labels');
const { ValidationError } = require('./errors');

function attemptsFor(inquiryIds) {
  if (!inquiryIds.length) return new Map();
  const rows = db.all(`SELECT * FROM contact_attempts WHERE inquiry_id IN (${inquiryIds.map(() => '?').join(',')}) ORDER BY contacted_at, id`, ...inquiryIds);
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.inquiry_id)) map.set(r.inquiry_id, []);
    map.get(r.inquiry_id).push(r);
  }
  return map;
}

/**
 * Reiter «Anfragen»: alle aktiven Personen ohne Anmeldung zu diesem Einsatz
 * plus alle Personen, die bereits angefragt wurden.
 */
function listForEvent(eventId, { status = '', team = '', q = '' } = {}) {
  const where = `(p.status = 'aktiv' AND NOT EXISTS (SELECT 1 FROM registrations g WHERE g.event_id = ? AND g.person_id = p.id AND g.status <> 'ungueltig'))
    OR i.id IS NOT NULL`;
  const rows = db.all(`SELECT p.id AS person_id, p.first_name, p.last_name, p.mobile, p.email, r.short AS rank_short,
      (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams,
      i.id AS inquiry_id, coalesce(i.status, 'offen') AS inquiry_status, i.registration_id, i.version AS inquiry_version
    FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
    LEFT JOIN inquiries i ON i.person_id = p.id AND i.event_id = ?
    WHERE ${where}
    ORDER BY p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`, eventId, eventId);
  let out = rows;
  if (status) out = out.filter((r) => r.inquiry_status === status);
  if (team) out = out.filter((r) => db.one('SELECT 1 FROM person_teams WHERE person_id = ? AND team_id = ?', r.person_id, Number(team)));
  if (q) out = out.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q.toLowerCase()));
  const attempts = attemptsFor(out.map((r) => r.inquiry_id).filter(Boolean));
  for (const r of out) r.attempts = attempts.get(r.inquiry_id) || [];
  // Abgesagte werden nicht mehr vorgeschlagen -> ans Ende
  const order = { offen: 1, nicht_erreicht: 0, whatsapp: 0, zugesagt: 2, abgesagt: 3 };
  out.sort((a, b) => (order[a.inquiry_status] ?? 1) - (order[b.inquiry_status] ?? 1));
  return out;
}

function forPerson(personId) {
  const rows = db.all(`SELECT i.*, e.name AS event_name, e.date AS event_date FROM inquiries i JOIN events e ON e.id = i.event_id WHERE i.person_id = ?`, personId);
  const attempts = attemptsFor(rows.map((r) => r.id));
  for (const r of rows) r.attempts = attempts.get(r.id) || [];
  return rows;
}

function ensureInquiry(eventId, personId, user) {
  let inq = db.one('SELECT * FROM inquiries WHERE event_id = ? AND person_id = ?', eventId, personId);
  if (!inq) {
    const now = nowIso();
    db.run('INSERT INTO inquiries (event_id, person_id, status, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)', eventId, personId, 'offen', now, now, user.id);
    inq = db.one('SELECT * FROM inquiries WHERE event_id = ? AND person_id = ?', eventId, personId);
  }
  return inq;
}

// Person zur Anfrage vorsehen (Status «Offen»)
function plan(eventId, personIds, user) {
  for (const pid of personIds) ensureInquiry(eventId, Number(pid), user);
  live.notify(`event:${eventId}`, 'feedback');
}

/**
 * Kontaktversuch erfassen: Kanal, Datum/Uhrzeit, ausführende Person, Ergebnis, Notiz.
 * «Zugesagt» erzeugt automatisch eine Anmeldung mit Quelle Telefon bzw. WhatsApp.
 */
function addAttempt(eventId, personId, input, user) {
  const channel = CHANNEL[input.channel] ? input.channel : 'telefon';
  const result = ATTEMPT_RESULT[input.result] ? input.result : null;
  if (!result) throw new ValidationError(['Bitte ein Ergebnis wählen.']);
  const date = String(input.date || '').trim();
  const time = String(input.time || '').trim();
  const contactedAt = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? `${date}T${time}` : localNow();
  const sentByUser = input.sent_by_user_id ? db.one('SELECT * FROM users WHERE id = ?', Number(input.sent_by_user_id)) : user;
  const sentByName = sentByUser?.display_name || user.display_name;
  const event = db.one('SELECT * FROM events WHERE id = ?', eventId);
  const person = db.one('SELECT * FROM persons WHERE id = ?', personId);
  if (!event || !person) throw new ValidationError(['Einsatz oder Person nicht gefunden.']);
  if (event.status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);

  return db.tx(() => {
    const inq = ensureInquiry(eventId, personId, user);
    db.run(`INSERT INTO contact_attempts (inquiry_id, channel, contacted_at, sent_by_user_id, sent_by_name, result, note, created_at, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, inq.id, channel, contactedAt, sentByUser?.id || null, sentByName, result,
    String(input.note || '').trim() || null, nowIso(), user.id);
    // whatsapp als Ergebnis eines Telefonanrufs ergibt keinen Sinn -> Kanal entscheidet
    let status = result;
    if (result === 'whatsapp' && channel === 'telefon') status = 'nicht_erreicht';
    let registrationId = inq.registration_id;
    if (result === 'zugesagt' && !registrationId) {
      const existing = db.one("SELECT id FROM registrations WHERE event_id = ? AND person_id = ?", eventId, personId);
      registrationId = existing ? existing.id : registrations.create({
        eventId, personId, enteredFirst: person.first_name, enteredLast: person.last_name, matchType: 'manuell',
        source: channel, answer: 'ja', remark: String(input.note || '').trim() || null, user,
      });
    }
    db.run('UPDATE inquiries SET status = ?, registration_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
      status, registrationId || null, nowIso(), user.id, inq.id);
    const resultText = { nicht_erreicht: 'nicht erreicht', whatsapp: 'per WhatsApp angeschrieben', zugesagt: 'Zusage', abgesagt: 'Absage' }[result];
    audit.log({
      entity: 'inquiry', entityId: inq.id, eventId, personId, action: 'attempt',
      summary: `${sentByName} hat ${person.first_name} ${person.last_name} per ${CHANNEL[channel].label} angefragt (${resultText}) · ${event.name}`,
      details: { kanal: channel, zeitpunkt: fmtLocal(contactedAt), ergebnis: result, erfasst_von: user.display_name }, user,
    });
    live.notify(`event:${eventId}`, 'feedback', `person:${personId}`);
    return { inquiryId: inq.id, registrationId };
  });
}

// Ergebnis direkt setzen (z. B. WhatsApp-Antwort kam herein)
function setStatus(eventId, personId, status, user) {
  if (!INQUIRY_STATUS[status]) throw new ValidationError(['Unbekannter Status.']);
  if (status === 'zugesagt' || status === 'abgesagt') {
    const last = db.one(`SELECT a.channel FROM contact_attempts a JOIN inquiries i ON i.id = a.inquiry_id
      WHERE i.event_id = ? AND i.person_id = ? ORDER BY a.contacted_at DESC, a.id DESC LIMIT 1`, eventId, personId);
    return addAttempt(eventId, personId, { channel: last?.channel || 'whatsapp', result: status, note: 'Antwort erhalten' }, user);
  }
  const inq = ensureInquiry(eventId, personId, user);
  db.run('UPDATE inquiries SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?', status, nowIso(), user.id, inq.id);
  live.notify(`event:${eventId}`, 'feedback');
  return { inquiryId: inq.id };
}

function attemptLabel(a) {
  return `${CHANNEL[a.channel].short} ${fmtLocal(a.contacted_at).slice(0, 6)} ${a.contacted_at.slice(11, 16)}`;
}

module.exports = { listForEvent, forPerson, plan, addAttempt, setStatus, attemptLabel };
