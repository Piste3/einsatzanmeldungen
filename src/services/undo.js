'use strict';
// «Rückgängig» in der Handy-App: macht die letzte eigene Aktion spurlos rückgängig.
// Vor jeder Aktion wird der Stand dieser Person bei diesem Einsatz gemerkt (Anmeldung, Schichten, Anfrage,
// Kontaktversuche). Rückgängig stellt diesen Stand wieder her und löscht die Einträge der Aktion im Verlauf.
const db = require('../db');
const live = require('../lib/live');
const { ValidationError } = require('./errors');

const KEEP_MS = 30 * 60 * 1000;
const MAX_PER_USER = 10;

const maxId = (table) => db.one(`SELECT coalesce(max(id), 0) AS n FROM ${table}`).n;
const list = (ids) => ids.map(() => '?').join(',');

function rowsOf({ eventId, personId = null, regId = null }) {
  const regs = db.all('SELECT * FROM registrations WHERE event_id = ? AND (person_id = ? OR id = ?)', eventId, personId ?? -1, regId ?? -1);
  const regIds = regs.map((r) => r.id);
  const inqs = personId ? db.all('SELECT * FROM inquiries WHERE event_id = ? AND person_id = ?', eventId, personId) : [];
  const inqIds = inqs.map((i) => i.id);
  return {
    registrations: regs,
    shift_assignments: regIds.length ? db.all(`SELECT * FROM shift_assignments WHERE registration_id IN (${list(regIds)})`, ...regIds) : [],
    inquiries: inqs,
    contact_attempts: inqIds.length ? db.all(`SELECT * FROM contact_attempts WHERE inquiry_id IN (${list(inqIds)})`, ...inqIds) : [],
    mails: regIds.length ? db.all(`SELECT id, registration_id FROM mail_outbox WHERE registration_id IN (${list(regIds)})`, ...regIds) : [],
  };
}

function insertRow(table, row) {
  const cols = Object.keys(row);
  db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${list(cols)})`, ...cols.map((c) => row[c]));
}

function prune(userId) {
  db.run('DELETE FROM handy_undo WHERE created_ms < ?', Date.now() - KEEP_MS);
  db.run(`DELETE FROM handy_undo WHERE user_id = ? AND id NOT IN (SELECT id FROM handy_undo WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_PER_USER})`, userId, userId);
}

// Aktion ausführen und merken. Ändert sie nichts (kein Eintrag im Verlauf), wird nichts gemerkt.
function record(user, scope, label, fn) {
  const snapshot = rowsOf(scope);
  const auditFrom = maxId('audit_log');
  const mailFrom = maxId('mail_outbox');
  const out = fn();
  const auditTo = maxId('audit_log');
  if (auditTo > auditFrom) {
    db.run(`INSERT INTO handy_undo (user_id, label, event_id, person_id, reg_id, snapshot, audit_from, audit_to, mail_from, created_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, user.id, label, scope.eventId, scope.personId ?? null, scope.regId ?? null,
    JSON.stringify(snapshot), auditFrom, auditTo, mailFrom, Date.now());
    prune(user.id);
  }
  return out;
}

function last(user) {
  if (!user) return null;
  return db.one('SELECT id, label, event_id, person_id, created_ms FROM handy_undo WHERE user_id = ? AND created_ms >= ? ORDER BY id DESC LIMIT 1',
    user.id, Date.now() - KEEP_MS) || null;
}

function undoLast(user) {
  const u = db.one('SELECT * FROM handy_undo WHERE user_id = ? AND created_ms >= ? ORDER BY id DESC LIMIT 1', user.id, Date.now() - KEEP_MS);
  if (!u) throw new ValidationError(['Es gibt nichts mehr zum Rückgängigmachen.']);
  const scope = { eventId: u.event_id, personId: u.person_id, regId: u.reg_id };
  const snap = JSON.parse(u.snapshot);
  const now = rowsOf(scope);
  const regIds = [...new Set([...now.registrations, ...snap.registrations].map((r) => r.id))];
  const inqIds = [...new Set([...now.inquiries, ...snap.inquiries].map((i) => i.id))];

  // Hat danach jemand anderes (oder eine andere Seite) dieselbe Person bei diesem Einsatz geändert, nicht überschreiben
  const later = db.one(`SELECT 1 AS x FROM audit_log WHERE id > ? AND event_id = ? AND (person_id = ?${regIds.length ? ` OR (entity_type = 'registration' AND entity_id IN (${list(regIds)}))` : ''}) LIMIT 1`,
    u.audit_to, u.event_id, u.person_id ?? -1, ...regIds);
  if (later) {
    db.run('DELETE FROM handy_undo WHERE id = ?', u.id);
    throw new ValidationError([`Rückgängig geht nicht mehr: Inzwischen wurde dort etwas anderes geändert (${u.label}).`]);
  }

  let mailSent = 0;
  db.tx(() => {
    if (inqIds.length) {
      db.run(`DELETE FROM contact_attempts WHERE inquiry_id IN (${list(inqIds)})`, ...inqIds);
      db.run(`DELETE FROM inquiries WHERE id IN (${list(inqIds)})`, ...inqIds);
    }
    if (regIds.length) {
      db.run(`DELETE FROM shift_assignments WHERE registration_id IN (${list(regIds)})`, ...regIds);
      // Mails dieser Aktion: noch nicht verschickte löschen, verschickte lassen sich nicht zurückholen
      mailSent = db.one(`SELECT COUNT(*) AS n FROM mail_outbox WHERE id > ? AND registration_id IN (${list(regIds)}) AND status = 'gesendet'`, u.mail_from, ...regIds).n;
      db.run(`DELETE FROM mail_outbox WHERE id > ? AND registration_id IN (${list(regIds)}) AND status <> 'gesendet'`, u.mail_from, ...regIds);
      db.run(`DELETE FROM registrations WHERE id IN (${list(regIds)})`, ...regIds);
    }
    for (const r of snap.registrations) insertRow('registrations', r);
    for (const r of snap.shift_assignments) insertRow('shift_assignments', r);
    for (const r of snap.inquiries) insertRow('inquiries', r);
    for (const r of snap.contact_attempts) insertRow('contact_attempts', r);
    for (const m of snap.mails) db.run('UPDATE mail_outbox SET registration_id = ? WHERE id = ?', m.registration_id, m.id);
    db.run('DELETE FROM audit_log WHERE id > ? AND id <= ?', u.audit_from, u.audit_to);
    db.run('DELETE FROM handy_undo WHERE id = ?', u.id);
  });
  live.notify('cockpit', `event:${u.event_id}`, 'feedback', u.person_id ? `person:${u.person_id}` : null);
  return { label: u.label, mailSent };
}

module.exports = { record, last, undoLast };
