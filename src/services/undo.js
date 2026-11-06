'use strict';
// «Rückgängig» und «Wiederholen» in der Handy-App: die letzten eigenen Aktionen spurlos zurücknehmen und wiederherstellen.
// Vor jeder Aktion wird der Stand dieser Person bei diesem Einsatz gemerkt (Anmeldung, Schichten, Anfrage,
// Kontaktversuche). Rückgängig stellt diesen Stand wieder her und löscht die Einträge der Aktion im Verlauf.
// Wiederholen stellt den Stand nach der Aktion samt Verlaufseinträgen wieder her. Eine neue Aktion leert «Wiederholen».
const db = require('../db');
const live = require('../lib/live');
const { nowIso } = require('../lib/dates');
const { ValidationError } = require('./errors');

const KEEP_MS = 30 * 60 * 1000;
const MAX_PER_USER = 20;

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
  return Number(db.run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${list(cols)})`, ...cols.map((c) => row[c])).lastInsertRowid);
}

// Aktuellen Stand der Person beim Einsatz durch einen gemerkten Stand ersetzen
function restore(scope, snap, { mailFrom = null } = {}) {
  const now = rowsOf(scope);
  const regIds = [...new Set([...now.registrations, ...snap.registrations].map((r) => r.id))];
  const inqIds = [...new Set([...now.inquiries, ...snap.inquiries].map((i) => i.id))];
  let mailSent = 0;
  if (inqIds.length) {
    db.run(`DELETE FROM contact_attempts WHERE inquiry_id IN (${list(inqIds)})`, ...inqIds);
    db.run(`DELETE FROM inquiries WHERE id IN (${list(inqIds)})`, ...inqIds);
  }
  if (regIds.length) {
    db.run(`DELETE FROM shift_assignments WHERE registration_id IN (${list(regIds)})`, ...regIds);
    if (mailFrom !== null) {
      // Mails der Aktion: noch nicht verschickte löschen, verschickte lassen sich nicht zurückholen
      mailSent = db.one(`SELECT COUNT(*) AS n FROM mail_outbox WHERE id > ? AND registration_id IN (${list(regIds)}) AND status = 'gesendet'`, mailFrom, ...regIds).n;
      db.run(`DELETE FROM mail_outbox WHERE id > ? AND registration_id IN (${list(regIds)}) AND status <> 'gesendet'`, mailFrom, ...regIds);
    }
    db.run(`DELETE FROM registrations WHERE id IN (${list(regIds)})`, ...regIds);
  }
  for (const r of snap.registrations) insertRow('registrations', r);
  for (const r of snap.shift_assignments) insertRow('shift_assignments', r);
  for (const r of snap.inquiries) insertRow('inquiries', r);
  for (const r of snap.contact_attempts) insertRow('contact_attempts', r);
  for (const m of snap.mails) db.run('UPDATE mail_outbox SET registration_id = ? WHERE id = ?', m.registration_id, m.id);
  return { mailSent };
}

// Hat seit «since» jemand anderes (oder eine andere Seite) dieselbe Person bei diesem Einsatz geändert?
function changedSince(step, since, ownIds = []) {
  const regIds = [...new Set(rowsOf({ eventId: step.event_id, personId: step.person_id, regId: step.reg_id }).registrations.map((r) => r.id).concat(step.reg_id ? [step.reg_id] : []))];
  return Boolean(db.one(`SELECT 1 AS x FROM audit_log WHERE created_at > ? AND event_id = ?
      AND (person_id = ?${regIds.length ? ` OR (entity_type = 'registration' AND entity_id IN (${list(regIds)}))` : ''})
      ${ownIds.length ? `AND id NOT IN (${list(ownIds)})` : ''} LIMIT 1`,
  since, step.event_id, step.person_id ?? -1, ...regIds, ...ownIds));
}

function prune(userId) {
  db.run('DELETE FROM handy_steps WHERE created_ms < ?', Date.now() - KEEP_MS);
  db.run(`DELETE FROM handy_steps WHERE user_id = ? AND id NOT IN (SELECT id FROM handy_steps WHERE user_id = ? ORDER BY id DESC LIMIT ${MAX_PER_USER})`, userId, userId);
}

// Aktion ausführen und merken. Ändert sie nichts (kein Eintrag im Verlauf), wird nichts gemerkt.
function record(user, scope, label, fn) {
  const before = rowsOf(scope);
  const auditFrom = maxId('audit_log');
  const mailFrom = maxId('mail_outbox');
  const startedAt = nowIso();
  const out = fn();
  const auditIds = db.all('SELECT id FROM audit_log WHERE id > ? ORDER BY id', auditFrom).map((r) => r.id);
  if (auditIds.length) {
    db.run('DELETE FROM handy_steps WHERE user_id = ? AND undone = 1', user.id); // neue Aktion: nichts mehr zum Wiederholen
    db.run(`INSERT INTO handy_steps (user_id, label, event_id, person_id, reg_id, before_snap, audit_ids, mail_from, done_at, created_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, user.id, label, scope.eventId, scope.personId ?? null, scope.regId ?? null,
    JSON.stringify(before), JSON.stringify(auditIds), mailFrom, startedAt, Date.now());
    prune(user.id);
  }
  return out;
}

const fresh = () => Date.now() - KEEP_MS;
const nextUndo = (user) => db.one('SELECT * FROM handy_steps WHERE user_id = ? AND undone = 0 AND created_ms >= ? ORDER BY id DESC LIMIT 1', user.id, fresh());
const nextRedo = (user) => db.one('SELECT * FROM handy_steps WHERE user_id = ? AND undone = 1 AND created_ms >= ? ORDER BY id ASC LIMIT 1', user.id, fresh());

// Für die Kopfleiste: was «Rückgängig» und «Wiederholen» gerade tun würden
function state(user) {
  if (!user) return { undo: null, redo: null };
  const u = nextUndo(user);
  const r = nextRedo(user);
  return { undo: u ? u.label : null, redo: r ? r.label : null };
}

function undoLast(user) {
  const step = nextUndo(user);
  if (!step) throw new ValidationError(['Es gibt nichts mehr zum Rückgängigmachen.']);
  const scope = { eventId: step.event_id, personId: step.person_id, regId: step.reg_id };
  const auditIds = JSON.parse(step.audit_ids);
  if (changedSince(step, step.done_at, auditIds)) {
    db.run('DELETE FROM handy_steps WHERE id = ?', step.id);
    throw new ValidationError([`Rückgängig geht nicht mehr: Inzwischen wurde dort etwas anderes geändert (${step.label}).`]);
  }
  let result;
  db.tx(() => {
    const after = rowsOf(scope);
    const auditRows = auditIds.length ? db.all(`SELECT * FROM audit_log WHERE id IN (${list(auditIds)}) ORDER BY id`, ...auditIds) : [];
    result = restore(scope, JSON.parse(step.before_snap), { mailFrom: step.mail_from });
    if (auditIds.length) db.run(`DELETE FROM audit_log WHERE id IN (${list(auditIds)})`, ...auditIds);
    db.run('UPDATE handy_steps SET undone = 1, after_snap = ?, audit_rows = ?, done_at = ?, created_ms = ? WHERE id = ?',
      JSON.stringify(after), JSON.stringify(auditRows), nowIso(), Date.now(), step.id);
  });
  live.notify('cockpit', `event:${step.event_id}`, 'feedback', step.person_id ? `person:${step.person_id}` : null);
  return { label: step.label, mailSent: result.mailSent };
}

function redoNext(user) {
  const step = nextRedo(user);
  if (!step) throw new ValidationError(['Es gibt nichts zum Wiederholen.']);
  const scope = { eventId: step.event_id, personId: step.person_id, regId: step.reg_id };
  if (changedSince(step, step.done_at)) {
    db.run('DELETE FROM handy_steps WHERE user_id = ? AND undone = 1', user.id);
    throw new ValidationError([`Wiederholen geht nicht mehr: Inzwischen wurde dort etwas anderes geändert (${step.label}).`]);
  }
  try {
    db.tx(() => {
      restore(scope, JSON.parse(step.after_snap));
      // Verlaufseinträge zurück, wenn möglich unter derselben Nummer
      const ids = [];
      for (const row of JSON.parse(step.audit_rows || '[]')) {
        const taken = db.one('SELECT 1 AS x FROM audit_log WHERE id = ?', row.id);
        const { id, ...rest } = row;
        ids.push(taken ? insertRow('audit_log', rest) : insertRow('audit_log', row));
      }
      db.run('UPDATE handy_steps SET undone = 0, after_snap = NULL, audit_rows = NULL, audit_ids = ?, done_at = ?, created_ms = ? WHERE id = ?',
        JSON.stringify(ids), nowIso(), Date.now(), step.id);
    });
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    db.run('DELETE FROM handy_steps WHERE user_id = ? AND undone = 1', user.id);
    throw new ValidationError(['Wiederholen geht nicht mehr. Bitte die Antwort neu eintragen.']);
  }
  live.notify('cockpit', `event:${step.event_id}`, 'feedback', step.person_id ? `person:${step.person_id}` : null);
  return { label: step.label };
}

module.exports = { record, state, undoLast, redoNext };
