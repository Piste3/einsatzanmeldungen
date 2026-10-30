'use strict';
// Stammdaten: jede Person existiert genau einmal
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const { nameKey } = require('../lib/normalize');
const { nowIso, today } = require('../lib/dates');
const { ConflictError, ValidationError } = require('./errors');
const { rankOrder, NAME } = require('../lib/sorting');

const FIELDS = ['first_name', 'last_name', 'status', 'rank_id', 'birth_date', 'birth_year', 'mobile', 'email', 'diet_category', 'diet_text', 'internal_note'];
const FIELD_LABELS = {
  first_name: 'Vorname', last_name: 'Nachname', status: 'Status', rank_id: 'Rang', birth_date: 'Geburtsdatum',
  birth_year: 'Jahrgang', mobile: 'Mobilnummer', email: 'E-Mail', diet_category: 'Essenseinschränkung',
  diet_text: 'Essenseinschränkung (Text)', internal_note: 'Interne Bemerkung', teams: 'Mannschaft / Kader',
};

const BASE_SELECT = `
  SELECT p.*, r.short AS rank_short, r.name AS rank_name, r.sort AS rank_sort,
    (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams
  FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id`;

function get(id) {
  const p = db.one(`${BASE_SELECT} WHERE p.id = ?`, id);
  if (!p) return null;
  p.team_ids = db.all('SELECT team_id FROM person_teams WHERE person_id = ?', id).map((r) => r.team_id);
  p.aliases = db.all('SELECT * FROM person_aliases WHERE person_id = ? ORDER BY id', id);
  return p;
}

function list({ q = '', team = '', rank = '', status = 'aktiv', sort = 'rang' } = {}) {
  const where = [];
  const params = [];
  if (status && status !== 'alle') { where.push('p.status = ?'); params.push(status); }
  if (team) { where.push('EXISTS (SELECT 1 FROM person_teams pt WHERE pt.person_id = p.id AND pt.team_id = ?)'); params.push(Number(team)); }
  if (rank) { where.push('p.rank_id = ?'); params.push(Number(rank)); }
  if (q) {
    const like = `%${q.trim().toLowerCase()}%`;
    where.push(`(lower(p.first_name || ' ' || p.last_name) LIKE ? OR lower(p.last_name || ' ' || p.first_name) LIKE ? OR lower(coalesce(p.email,'')) LIKE ? OR replace(coalesce(p.mobile,''),' ','') LIKE ?
      OR EXISTS (SELECT 1 FROM person_aliases a WHERE a.person_id = p.id AND lower(a.first_name || ' ' || a.last_name) LIKE ?))`);
    params.push(like, like, like, `%${q.replace(/\s/g, '')}%`, like);
  }
  const order = sort === 'name' ? NAME : rankOrder(sort);
  return db.all(`${BASE_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order}`, ...params);
}

function clean(input) {
  const s = (v) => {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
  };
  const data = {
    first_name: s(input.first_name),
    last_name: s(input.last_name),
    status: ['aktiv', 'inaktiv', 'ausgetreten'].includes(input.status) ? input.status : 'aktiv',
    rank_id: input.rank_id ? Number(input.rank_id) : null,
    birth_date: s(input.birth_date),
    birth_year: input.birth_year ? Number(input.birth_year) : null,
    mobile: s(input.mobile),
    email: s(input.email)?.toLowerCase() || null,
    diet_category: s(input.diet_category),
    diet_text: s(input.diet_text),
    internal_note: s(input.internal_note),
  };
  if (data.birth_date) data.birth_year = Number(data.birth_date.slice(0, 4));
  const errors = [];
  if (!data.first_name) errors.push('Vorname fehlt.');
  if (!data.last_name) errors.push('Nachname fehlt.');
  if (data.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(data.birth_date)) errors.push('Geburtsdatum ungültig.');
  if (data.birth_year && (data.birth_year < 1900 || data.birth_year > 2100)) errors.push('Jahrgang ungültig.');
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push('E-Mail-Adresse ungültig.');
  if (errors.length) throw new ValidationError(errors);
  const teamIds = [].concat(input.team_ids || []).map(Number).filter(Boolean);
  return { data, teamIds };
}

function setTeams(personId, teamIds) {
  db.run('DELETE FROM person_teams WHERE person_id = ?', personId);
  for (const t of new Set(teamIds)) db.run('INSERT INTO person_teams (person_id, team_id) VALUES (?, ?)', personId, t);
}

function teamNames(teamIds) {
  if (!teamIds.length) return '';
  return db.all(`SELECT name FROM teams WHERE id IN (${teamIds.map(() => '?').join(',')}) ORDER BY sort, name`, ...teamIds).map((t) => t.name).join(', ');
}

function create(input, user) {
  const { data, teamIds } = clean(input);
  return db.tx(() => {
    const now = nowIso();
    const info = db.run(
      `INSERT INTO persons (${FIELDS.join(', ')}, norm_key, created_at, updated_at, updated_by)
       VALUES (${FIELDS.map(() => '?').join(', ')}, ?, ?, ?, ?)`,
      ...FIELDS.map((f) => data[f]), nameKey(data.first_name, data.last_name), now, now, user?.id || null,
    );
    const id = Number(info.lastInsertRowid);
    setTeams(id, teamIds);
    audit.log({ entity: 'person', entityId: id, personId: id, action: 'create', summary: `${user?.display_name || 'System'} hat ${data.first_name} ${data.last_name} angelegt`, user });
    live.notify('persons');
    return id;
  });
}

// Speichern mit Versionsprüfung (optimistisches Sperren)
function update(id, input, expectedVersion, user) {
  const { data, teamIds } = clean(input);
  return db.tx(() => {
    const before = get(id);
    if (!before) throw new ValidationError(['Person nicht gefunden.']);
    if (Number(expectedVersion) !== before.version) {
      throw new ConflictError(before, lastChange('person', id));
    }
    db.run(
      `UPDATE persons SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, norm_key = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
      ...FIELDS.map((f) => data[f]), nameKey(data.first_name, data.last_name), nowIso(), user?.id || null, id,
    );
    setTeams(id, teamIds);
    const changes = audit.diff(before, data, FIELDS);
    const beforeTeams = before.teams || '';
    const afterTeams = teamNames(teamIds);
    if (beforeTeams !== afterTeams) changes.teams = { alt: beforeTeams, neu: afterTeams };
    if (Object.keys(changes).length) {
      audit.log({
        entity: 'person', entityId: id, personId: id, action: 'update',
        summary: `${user?.display_name} hat Stammdaten von ${data.first_name} ${data.last_name} geändert (${Object.keys(changes).map((k) => FIELD_LABELS[k] || k).join(', ')})`,
        details: changes, user,
      });
    }
    live.notify('persons', `person:${id}`);
  });
}

function lastChange(entity, id) {
  return db.one('SELECT * FROM audit_log WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1', entity, id);
}

function addAlias(personId, firstName, lastName, user) {
  const key = nameKey(firstName, lastName);
  const person = db.one('SELECT * FROM persons WHERE id = ?', personId);
  if (!person || key === person.norm_key) return false;
  if (db.one('SELECT 1 FROM person_aliases WHERE person_id = ? AND norm_key = ?', personId, key)) return false;
  db.run('INSERT INTO person_aliases (person_id, first_name, last_name, norm_key, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
    personId, String(firstName).trim(), String(lastName).trim(), key, nowIso(), user?.id || null);
  audit.log({
    entity: 'person', entityId: personId, personId, action: 'alias',
    summary: `${user?.display_name || 'System'} hat «${String(firstName).trim()} ${String(lastName).trim()}» als Namensvariante von ${person.first_name} ${person.last_name} gespeichert`, user,
  });
  return true;
}

function removeAlias(aliasId, user) {
  const a = db.one('SELECT * FROM person_aliases WHERE id = ?', aliasId);
  if (!a) return;
  db.run('DELETE FROM person_aliases WHERE id = ?', aliasId);
  audit.log({ entity: 'person', entityId: a.person_id, personId: a.person_id, action: 'alias_remove', summary: `${user.display_name} hat Namensvariante «${a.first_name} ${a.last_name}» entfernt`, user });
}

// Sensible Angaben (Essenseinschränkungen): vollständig nur für Admins,
// für die Aufgebotsstelle nur bei Personen, die bei einem anstehenden Einsatz angemeldet sind.
function canSeeDiet(user, personId) {
  if (user?.role === 'admin') return true;
  return Boolean(db.one(
    `SELECT 1 FROM registrations r JOIN events e ON e.id = r.event_id
     WHERE r.person_id = ? AND r.status IN ('neu','rueckfrage','warteliste','bestaetigt') AND e.date >= ? AND e.status IN ('entwurf','veroeffentlicht') LIMIT 1`,
    personId, today(),
  ));
}

function displayName(p) {
  if (!p) return '';
  return `${p.rank_short ? `${p.rank_short} ` : ''}${p.first_name} ${p.last_name}`;
}

// Was beim Löschen einer Person mit verschwindet (für die Rückfrage)
function deletionImpact(id) {
  const n = (sql) => db.one(sql, id).n;
  return {
    registrations: n('SELECT COUNT(*) AS n FROM registrations WHERE person_id = ?'),
    inquiries: n('SELECT COUNT(*) AS n FROM inquiries WHERE person_id = ?'),
    leaderOf: n('SELECT COUNT(*) AS n FROM events WHERE leader_person_id = ?'),
    user: db.one('SELECT username FROM users WHERE person_id = ?', id)?.username || null,
  };
}

/**
 * Person endgültig löschen, inkl. ihrer Anmeldungen, Schichtzuteilungen und Anfragen.
 * Einsatzleitung und Benutzerverknüpfung werden geleert; der Verlauf bleibt als Text erhalten.
 */
function remove(id, user) {
  const p = get(id);
  if (!p) throw new ValidationError(['Diese Person existiert nicht mehr.']);
  const name = `${p.first_name} ${p.last_name}`;
  const eventIds = db.all('SELECT DISTINCT event_id FROM registrations WHERE person_id = ? UNION SELECT event_id FROM inquiries WHERE person_id = ?', id, id).map((r) => r.event_id);
  db.tx(() => {
    db.run('DELETE FROM inquiries WHERE person_id = ?', id);
    db.run('UPDATE inquiries SET registration_id = NULL WHERE registration_id IN (SELECT id FROM registrations WHERE person_id = ?)', id);
    db.run('UPDATE mail_outbox SET registration_id = NULL WHERE registration_id IN (SELECT id FROM registrations WHERE person_id = ?)', id);
    db.run('DELETE FROM registrations WHERE person_id = ?', id);
    db.run('UPDATE events SET leader_person_id = NULL WHERE leader_person_id = ?', id);
    db.run('UPDATE users SET person_id = NULL WHERE person_id = ?', id);
    db.run('UPDATE audit_log SET person_id = NULL WHERE person_id = ?', id);
    db.run('DELETE FROM persons WHERE id = ?', id);
    audit.log({ entity: 'person', entityId: id, action: 'delete', summary: `${user.display_name} hat ${name} gelöscht`, user });
  });
  live.notify('persons', 'cockpit', 'feedback', 'clarifications', ...eventIds.map((e) => `event:${e}`));
  return name;
}

module.exports = { get, list, create, update, remove, deletionImpact, addAlias, removeAlias, canSeeDiet, displayName, setTeams, FIELD_LABELS, lastChange };
