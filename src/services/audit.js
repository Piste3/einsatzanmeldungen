'use strict';
// Protokoll: jede Änderung mit Person und Zeitpunkt (Verlauf, «Letzte Aktivität»)
const db = require('../db');
const live = require('../lib/live');
const { nowIso } = require('../lib/dates');

function log({ entity, entityId = null, eventId = null, personId = null, action, summary, details = null, user = null }) {
  db.run(
    `INSERT INTO audit_log (entity_type, entity_id, event_id, person_id, action, summary, details, user_id, user_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entity, entityId, eventId, personId, action, summary, details ? JSON.stringify(details) : null,
    user?.id || null, user?.display_name || (user ? null : 'System'), nowIso(),
  );
  live.notify('cockpit', eventId ? `event:${eventId}` : null, personId ? `person:${personId}` : null);
}

function recent(limit = 15) {
  return db.all('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?', limit);
}

function forEvent(eventId, limit = 300) {
  return db.all('SELECT * FROM audit_log WHERE event_id = ? ORDER BY id DESC LIMIT ?', eventId, limit);
}

function forPerson(personId, limit = 200) {
  return db.all('SELECT * FROM audit_log WHERE person_id = ? OR (entity_type = ? AND entity_id = ?) ORDER BY id DESC LIMIT ?', personId, 'person', personId, limit);
}

// Unterschiede zweier Datensätze für die Historie
function diff(before, after, fields) {
  const changes = {};
  for (const f of fields) {
    const a = before?.[f] ?? null;
    const b = after?.[f] ?? null;
    if (String(a ?? '') !== String(b ?? '')) changes[f] = { alt: a, neu: b };
  }
  return changes;
}

module.exports = { log, recent, forEvent, forPerson, diff };
