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
// «angemeldet» = hat sich inzwischen selbst gemeldet (Formular oder anders), «offen» = noch nicht angefragt
function rowState(r) {
  if (r.reg_id && r.inquiry_status !== 'zugesagt') return 'angemeldet';
  return r.inquiry_status;
}
const ROW_ORDER = { nicht_erreicht: 0, whatsapp: 0, unsicher: 0, offen: 2, zugesagt: 3, angemeldet: 4, abgesagt: 5 };

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
  if (status) out = out.filter((r) => r.state === status);
  out.sort((a, b) => (ROW_ORDER[a.state] ?? 2) - (ROW_ORDER[b.state] ?? 2));
  return Object.assign(out, { counts, total });
}

function forPerson(personId) {
  const rows = db.all(`SELECT i.*, e.name AS event_name, e.date_from AS event_date, e.date_to AS event_date_to FROM inquiries i JOIN events e ON e.id = i.event_id WHERE i.person_id = ?`, personId);
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
      // gewählte Schichten (bei Einsätzen mit mehreren Schichten)
      const wishes = [].concat(input.shift_ids || []).map(Number).filter(Boolean);
      registrationId = existing ? existing.id : registrations.create({
        eventId, personId, enteredFirst: person.first_name, enteredLast: person.last_name, matchType: 'manuell',
        source: channel, answer: 'ja', wishes, remark: String(input.note || '').trim() || null, user,
      });
      if (existing && wishes.length) registrations.applyWishes(existing.id, eventId, wishes, user);
    }
    // Gibt es schon eine Anmeldung, zieht die neue Antwort sie mit: Absage = zurückgezogen, Zusage = wieder aktiv
    const reg = db.one('SELECT id, status FROM registrations WHERE event_id = ? AND person_id = ?', eventId, personId);
    if (reg && result === 'abgesagt' && !['zurueckgezogen', 'abgesagt', 'ungueltig'].includes(reg.status)) {
      registrations.setStatus(reg.id, 'zurueckgezogen', user, { expected: reg.status });
      registrationId = registrationId || reg.id;
    }
    if (reg && result === 'zugesagt' && ['zurueckgezogen', 'abgesagt'].includes(reg.status)) {
      registrations.setStatus(reg.id, 'neu', user, { expected: reg.status });
      const wishes = [].concat(input.shift_ids || []).map(Number).filter(Boolean);
      if (wishes.length) registrations.applyWishes(reg.id, eventId, wishes, user);
    }
    db.run('UPDATE inquiries SET status = ?, registration_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
      status, registrationId || null, nowIso(), user.id, inq.id);
    const resultText = { nicht_erreicht: 'nicht erreicht', whatsapp: 'per WhatsApp angeschrieben', zugesagt: 'Zusage', unsicher: 'noch unsicher', abgesagt: 'Absage' }[result];
    audit.log({
      entity: 'inquiry', entityId: inq.id, eventId, personId, action: 'attempt',
      summary: `${sentByName} hat ${person.first_name} ${person.last_name} per ${CHANNEL[channel].label} angefragt (${resultText}) · ${event.name}`,
      details: { kanal: channel, zeitpunkt: fmtLocal(contactedAt), ergebnis: result, gesendet_von: sentByName, erfasst_von: user.display_name, notiz: String(input.note || '').trim() || null }, user,
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
  if (inq.status === status) return { inquiryId: inq.id };
  db.run('UPDATE inquiries SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?', status, nowIso(), user.id, inq.id);
  const person = db.one('SELECT first_name, last_name FROM persons WHERE id = ?', personId);
  const event = db.one('SELECT name FROM events WHERE id = ?', eventId);
  audit.log({
    entity: 'inquiry', entityId: inq.id, eventId, personId, action: 'status',
    summary: `${user.display_name} hat die Anfrage bei ${person?.first_name} ${person?.last_name} auf «${INQUIRY_STATUS[status].label}» gesetzt · ${event?.name}`,
    details: { status: { alt: inq.status, neu: status } }, user,
  });
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

// Alles für eine Person und einen Einsatz zurücksetzen: Anfrage mit allen Kontaktversuchen und die Anmeldung
// (samt Schichtzuteilung). Der Formular-Eingang bleibt gespeichert. Danach gilt die Person als «offen».
function resetPerson(eventId, personId, user) {
  const event = db.one('SELECT * FROM events WHERE id = ?', eventId);
  const person = db.one('SELECT * FROM persons WHERE id = ?', personId);
  if (!event || !person) throw new ValidationError(['Einsatz oder Person nicht gefunden.']);
  if (event.status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);
  return db.tx(() => {
    const reg = db.one('SELECT id FROM registrations WHERE event_id = ? AND person_id = ?', eventId, personId);
    if (reg) registrations.remove(reg.id, user);
    const inq = db.one('SELECT id FROM inquiries WHERE event_id = ? AND person_id = ?', eventId, personId);
    const attempts = inq ? db.one('SELECT COUNT(*) AS n FROM contact_attempts WHERE inquiry_id = ?', inq.id).n : 0;
    if (inq) db.run('DELETE FROM inquiries WHERE id = ?', inq.id);
    if (reg || inq) {
      audit.log({
        entity: 'inquiry', entityId: inq?.id || null, eventId, personId, action: 'reset',
        summary: `${user.display_name} hat alles für ${person.first_name} ${person.last_name} zurückgesetzt · ${event.name}`,
        details: { anmeldung_geloescht: reg ? 'ja' : 'nein', kontaktversuche: attempts }, user,
      });
      live.notify(`event:${eventId}`, 'feedback', `person:${personId}`);
    }
    return { registration: Boolean(reg), inquiry: Boolean(inq), attempts };
  });
}

module.exports = { listForEvent, forPerson, addAttempt, setStatus, removeAttempt, resetPerson, attemptLabel };
