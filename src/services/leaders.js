'use strict';
// Rolle «Einsatzleiter»: Die Aufgebotsstelle gibt einzelne Einsätze für einzelne Konten frei.
// Freigegebene Einsätze sieht der Einsatzleiter nur lesend (Angaben + Teilnehmerliste).
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const { nowIso } = require('../lib/dates');
const { ValidationError } = require('./errors');

const ROLE = 'einsatzleiter';

function isLeader(user) {
  return user?.role === ROLE;
}

// Wer ist für diesen Einsatz freigegeben?
function forEvent(eventId) {
  return db.all(`SELECT u.id, u.display_name, u.username, u.active, l.granted_at, l.granted_by,
      (SELECT display_name FROM users g WHERE g.id = l.granted_by) AS granted_by_name
    FROM event_leaders l JOIN users u ON u.id = l.user_id
    WHERE l.event_id = ? AND u.role = ? ORDER BY u.display_name COLLATE NOCASE`, eventId, ROLE);
}

// Konten, die man noch freigeben kann (aktive Einsatzleiter ohne Freigabe für diesen Einsatz)
function candidates(eventId) {
  return db.all(`SELECT u.id, u.display_name, u.username, u.person_id FROM users u
    WHERE u.role = ? AND u.active = 1 AND NOT EXISTS (SELECT 1 FROM event_leaders l WHERE l.event_id = ? AND l.user_id = u.id)
    ORDER BY u.display_name COLLATE NOCASE`, ROLE, eventId);
}

function hasAccess(user, eventId) {
  if (!isLeader(user)) return false;
  return Boolean(db.one('SELECT 1 FROM event_leaders WHERE event_id = ? AND user_id = ?', Number(eventId), user.id));
}

// Freigegebene Einsätze eines Einsatzleiters, nächste zuerst; vergangene am Schluss
function eventsFor(userId) {
  return db.all(`SELECT e.*, p.first_name AS leader_first, p.last_name AS leader_last, r.short AS leader_rank, l.granted_at
    FROM event_leaders l JOIN events e ON e.id = l.event_id
    LEFT JOIN persons p ON p.id = e.leader_person_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE l.user_id = ? ORDER BY e.date_from IS NULL, e.date_from, e.start_time, e.id`, userId);
}

function grant(eventId, userId, actor) {
  const event = db.one('SELECT id, name FROM events WHERE id = ?', eventId);
  const user = db.one('SELECT id, display_name, role, active FROM users WHERE id = ?', Number(userId));
  if (!event) throw new ValidationError(['Einsatz nicht gefunden.']);
  if (!user || user.role !== ROLE) throw new ValidationError(['Bitte ein Konto mit der Rolle «Einsatzleiter» wählen.']);
  if (!user.active) throw new ValidationError(['Dieses Konto ist deaktiviert.']);
  const info = db.run('INSERT OR IGNORE INTO event_leaders (event_id, user_id, granted_at, granted_by) VALUES (?, ?, ?, ?)', event.id, user.id, nowIso(), actor?.id || null);
  if (!info.changes) return false;
  audit.log({ entity: 'event', entityId: event.id, eventId: event.id, action: 'leader_grant', summary: `${actor.display_name} hat «${event.name}» für Einsatzleiter ${user.display_name} freigegeben`, user: actor });
  live.notify(`leader:${user.id}`);
  return true;
}

function revoke(eventId, userId, actor) {
  const event = db.one('SELECT id, name FROM events WHERE id = ?', eventId);
  const user = db.one('SELECT id, display_name FROM users WHERE id = ?', Number(userId));
  if (!event || !user) return false;
  const info = db.run('DELETE FROM event_leaders WHERE event_id = ? AND user_id = ?', event.id, user.id);
  if (!info.changes) return false;
  audit.log({ entity: 'event', entityId: event.id, eventId: event.id, action: 'leader_revoke', summary: `${actor.display_name} hat die Freigabe von «${event.name}» für ${user.display_name} entfernt`, user: actor });
  live.notify(`leader:${user.id}`);
  return true;
}

// Rolle gewechselt: Freigaben gelten nur für Einsatzleiter
function clearForUser(userId) {
  db.run('DELETE FROM event_leaders WHERE user_id = ?', userId);
}

// Welche Live-Themen darf ein Einsatzleiter abonnieren?
function allowTopic(user, topic) {
  if (!isLeader(user)) return true;
  if (topic === `leader:${user.id}`) return true;
  const m = /^event:(\d+)$/.exec(topic);
  return Boolean(m && hasAccess(user, Number(m[1])));
}

module.exports = { ROLE, isLeader, forEvent, candidates, hasAccess, eventsFor, grant, revoke, clearForUser, allowTopic };
