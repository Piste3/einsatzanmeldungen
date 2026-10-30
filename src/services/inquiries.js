'use strict';
// Nachfassen per Telefon und WhatsApp (Konzept 8.4)
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const registrations = require('./registrations');
const { nowIso, localNow, fmtLocal } = require('../lib/dates');
const { INQUIRY_STATUS, ATTEMPT_RESULT, CHANNEL } = require('../lib/labels');
const { ValidationError } = require('./errors');
const { rankOrder } = require('../lib/sorting');

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

// Anzeige-Status einer Zeile im Reiter «Anfragen»:
// «angemeldet» = hat sich inzwischen selbst gemeldet (Formular oder anders), «vorgesehen» = zur Anfrage vorgemerkt, noch kein Kontakt
function rowState(r) {
  if (r.reg_id && r.inquiry_status !== 'zugesagt') return 'angemeldet';
  if (r.inquiry_status === 'offen' && r.inquiry_id && !r.attempts.length) return 'vorgesehen';
  return r.inquiry_status;
}
const ROW_ORDER = { nicht_erreicht: 0, whatsapp: 0, unsicher: 0, vorgesehen: 1, offen: 2, zugesagt: 3, angemeldet: 4, abgesagt: 5 };

/**
 * Reiter «Anfragen»: alle aktiven Personen ohne Anmeldung zu diesem Einsatz
 * plus alle Personen, die bereits angefragt wurden.
 */
function listForEvent(eventId, { status = '', team = '', q = '', sort = 'rang' } = {}) {
  const where = `(p.status = 'aktiv' AND NOT EXISTS (SELECT 1 FROM registrations g WHERE g.event_id = ? AND g.person_id = p.id AND g.status <> 'ungueltig'))
    OR i.id IS NOT NULL`;
  const rows = db.all(`SELECT p.id AS person_id, p.first_name, p.last_name, p.mobile, p.email, r.short AS rank_short,
      (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams,
      i.id AS inquiry_id, coalesce(i.status, 'offen') AS inquiry_status, i.registration_id, i.version AS inquiry_version,
      g.id AS reg_id, g.status AS reg_status, g.source AS reg_source
    FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
    LEFT JOIN inquiries i ON i.person_id = p.id AND i.event_id = ?
    LEFT JOIN registrations g ON g.id = (SELECT id FROM registrations WHERE event_id = ? AND person_id = p.id AND status <> 'ungueltig' ORDER BY id DESC LIMIT 1)
    WHERE ${where}
    ORDER BY ${rankOrder(sort)}`, eventId, eventId, eventId);
  let out = rows;
  if (team) {
    const inTeam = new Set(db.all('SELECT person_id FROM person_teams WHERE team_id = ?', Number(team)).map((x) => x.person_id));
    out = out.filter((r) => inTeam.has(r.person_id));
  }
  if (q) out = out.filter((r) => `${r.first_name} ${r.last_name}`.toLowerCase().includes(q.toLowerCase()));
  const attempts = attemptsFor(out.map((r) => r.inquiry_id).filter(Boolean));
  for (const r of out) {
    r.attempts = attempts.get(r.inquiry_id) || [];
    r.state = rowState(r);
  }
  // Zähler für die Status-Chips (vor dem Statusfilter)
  const counts = {};
  for (const r of out) counts[r.state] = (counts[r.state] || 0) + 1;
  const total = out.length;
  if (status) out = out.filter((r) => r.state === status || (status === 'offen' && r.state === 'vorgesehen'));
  out.sort((a, b) => (ROW_ORDER[a.state] ?? 2) - (ROW_ORDER[b.state] ?? 2));
  return Object.assign(out, { counts, total });
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
    const resultText = { nicht_erreicht: 'nicht erreicht', whatsapp: 'per WhatsApp angeschrieben', zugesagt: 'Zusage', unsicher: 'noch unsicher', abgesagt: 'Absage' }[result];
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

// Den letzten Kontaktversuch zurücknehmen (z. B. bei der falschen Person erfasst).
// Hat er eine Anmeldung erzeugt, wird diese mitgelöscht.
function removeAttempt(eventId, attemptId, user) {
  const a = db.one(`SELECT a.*, i.event_id, i.person_id, i.registration_id FROM contact_attempts a JOIN inquiries i ON i.id = a.inquiry_id WHERE a.id = ?`, attemptId);
  if (!a || a.event_id !== eventId) throw new ValidationError(['Kontaktversuch nicht gefunden.']);
  const event = db.one('SELECT * FROM events WHERE id = ?', eventId);
  if (event.status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);
  const last = db.one('SELECT id FROM contact_attempts WHERE inquiry_id = ? ORDER BY contacted_at DESC, id DESC LIMIT 1', a.inquiry_id);
  if (last.id !== a.id) throw new ValidationError(['Nur der letzte Kontaktversuch lässt sich zurücknehmen.']);
  const person = db.one('SELECT * FROM persons WHERE id = ?', a.person_id);
  let regRemoved = false;
  db.tx(() => {
    if (a.result === 'zugesagt' && a.registration_id) {
      const reg = db.one('SELECT * FROM registrations WHERE id = ?', a.registration_id);
      if (reg && reg.source !== 'formular') { registrations.remove(reg.id, user); regRemoved = true; }
    }
    db.run('DELETE FROM contact_attempts WHERE id = ?', a.id);
    const prev = db.one('SELECT * FROM contact_attempts WHERE inquiry_id = ? ORDER BY contacted_at DESC, id DESC LIMIT 1', a.inquiry_id);
    let status = prev ? prev.result : 'offen';
    if (status === 'whatsapp' && prev.channel === 'telefon') status = 'nicht_erreicht';
    const inq = db.one('SELECT * FROM inquiries WHERE id = ?', a.inquiry_id);
    db.run('UPDATE inquiries SET status = ?, registration_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
      status, status === 'zugesagt' ? inq.registration_id : (regRemoved ? null : inq.registration_id), nowIso(), user.id, a.inquiry_id);
    audit.log({
      entity: 'inquiry', entityId: a.inquiry_id, eventId, personId: a.person_id, action: 'attempt_delete',
      summary: `${user.display_name} hat einen Kontaktversuch bei ${person.first_name} ${person.last_name} zurückgenommen (${CHANNEL[a.channel].label}, ${fmtLocal(a.contacted_at)})${regRemoved ? ' – Anmeldung gelöscht' : ''} · ${event.name}`,
      details: { kanal: a.channel, ergebnis: a.result, notiz: a.note }, user,
    });
  });
  live.notify(`event:${eventId}`, 'feedback', `person:${a.person_id}`);
  return { regRemoved };
}

function attemptLabel(a) {
  return `${CHANNEL[a.channel].short} ${fmtLocal(a.contacted_at).slice(0, 6)} ${a.contacted_at.slice(11, 16)}`;
}

module.exports = { listForEvent, forPerson, plan, addAttempt, setStatus, removeAttempt, attemptLabel };
