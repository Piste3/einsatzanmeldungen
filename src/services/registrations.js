'use strict';
// Anmeldungen: Status, Zuordnung, Schichtzuteilung
const db = require('../db');
const externals = require('./externals');
const audit = require('./audit');
const live = require('../lib/live');
const persons = require('./persons');
const { nowIso } = require('../lib/dates');
const { REG_STATUS, REG_STATUS_MANUAL, REG_COUNTING, SOURCE, DIET } = require('../lib/labels');
const { ValidationError, ConflictError } = require('./errors');
const { nameKey } = require('../lib/normalize');
const { rankOrder } = require('../lib/sorting');

const SELECT = `
  SELECT g.*, p.first_name, p.last_name, p.email, p.mobile, p.birth_date, p.birth_year, r.short AS rank_short,
    (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams,
    e.name AS event_name, e.date AS event_date, e.status AS event_status
  FROM registrations g
  JOIN events e ON e.id = g.event_id
  LEFT JOIN persons p ON p.id = g.person_id
  LEFT JOIN ranks r ON r.id = p.rank_id`;

function hydrate(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const assigns = db.all(`SELECT a.registration_id, s.id, s.name, s.starts_at, s.ends_at FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id
    WHERE a.registration_id IN (${ids.map(() => '?').join(',')}) ORDER BY s.sort, s.starts_at`, ...ids);
  const byReg = new Map();
  for (const a of assigns) {
    if (!byReg.has(a.registration_id)) byReg.set(a.registration_id, []);
    byReg.get(a.registration_id).push(a);
  }
  for (const r of rows) {
    r.assigned = byReg.get(r.id) || [];
    try { r.wishes = JSON.parse(r.shift_wishes || '[]'); } catch { r.wishes = []; }
    r.person_name = r.person_id ? `${r.first_name} ${r.last_name}` : null;
    r.entered_name = `${r.entered_first_name || ''} ${r.entered_last_name || ''}`.trim();
  }
  return rows;
}

function get(id) {
  return hydrate([db.one(`${SELECT} WHERE g.id = ?`, id)].filter(Boolean))[0] || null;
}

function listForEvent(eventId, { status = '', q = '', sort = 'rang' } = {}) {
  const where = ['g.event_id = ?'];
  const params = [eventId];
  if (status === 'zu_pruefen') where.push("g.status IN ('unsicher','rueckfrage')");
  else if (status && REG_STATUS[status]) { where.push('g.status = ?'); params.push(status); }
  if (q) {
    where.push("(lower(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) LIKE ? OR lower(coalesce(g.entered_first_name,'') || ' ' || coalesce(g.entered_last_name,'')) LIKE ?)");
    params.push(`%${q.toLowerCase()}%`, `%${q.toLowerCase()}%`);
  }
  return hydrate(db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${sort === 'neu' ? 'g.registered_at DESC, g.id DESC' : `p.id IS NULL, ${rankOrder(sort)}, g.id`}`, ...params));
}

// Teilnehmerliste eines Einsatzes: wer kommt, mit Mobil und Essenseinschränkungen.
// Umfang: «angemeldet» (zählt zur Besetzung), «bestaetigt» oder «warteliste» (angemeldet + Warteliste).
// Essenseinschränkungen nur, wo der Benutzer sie sehen darf (sonst «Hinweis vorhanden»).
const PARTICIPANT_SCOPES = {
  angemeldet: { label: 'Angemeldete', statuses: REG_COUNTING },
  bestaetigt: { label: 'Nur bestätigte', statuses: ['bestaetigt'] },
  warteliste: { label: 'Angemeldete + Warteliste', statuses: [...REG_COUNTING, 'warteliste'] },
};

function participants(eventId, { scope = 'angemeldet', shiftId = null, sort = 'rang' } = {}, user = null) {
  const statuses = (PARTICIPANT_SCOPES[scope] || PARTICIPANT_SCOPES.angemeldet).statuses;
  const where = ['g.event_id = ?', 'g.person_id IS NOT NULL', `g.status IN (${statuses.map(() => '?').join(',')})`];
  const params = [eventId, ...statuses];
  if (shiftId) {
    where.push('EXISTS (SELECT 1 FROM shift_assignments a WHERE a.registration_id = g.id AND a.shift_id = ?)');
    params.push(Number(shiftId));
  }
  const rows = hydrate(db.all(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY ${rankOrder(sort)}, g.id`, ...params));
  const diets = new Map();
  if (rows.length) {
    const ids = rows.map((r) => r.person_id);
    for (const p of db.all(`SELECT id, diet_category, diet_text FROM persons WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids)) diets.set(p.id, p);
  }
  return rows.map((r) => {
    const d = diets.get(r.person_id) || {};
    const has = Boolean(d.diet_category || d.diet_text);
    const visible = has && persons.canSeeDiet(user, r.person_id);
    r.diet = {
      has, visible,
      category: visible && d.diet_category ? DIET[d.diet_category] || d.diet_category : '',
      text: visible ? d.diet_text || '' : '',
    };
    r.diet.label = !has ? '' : visible ? [r.diet.category, r.diet.text].filter(Boolean).join(': ') : 'Hinweis vorhanden';
    return r;
  });
}

// Teilnehmerliste mit Auswahl aus der Adresszeile (Umfang, Schicht, Sortierung) – für Seite und Export
function participantView(e, query, user) {
  const shift = e.shifts.length > 1 ? e.shifts.find((s) => s.id === Number(query.schicht)) || null : null;
  const filters = {
    umfang: PARTICIPANT_SCOPES[query.umfang] ? query.umfang : 'angemeldet',
    schicht: shift ? shift.id : '',
    sort: query.sort === 'rang_auf' ? 'rang_auf' : 'rang',
  };
  const list = participants(e.id, { scope: filters.umfang, shiftId: shift?.id, sort: filters.sort }, user);
  const shiftOf = (r) => (r.assigned.length ? r.assigned.map((a) => a.name).join(' + ')
    : r.wishes.length ? `Wunsch: ${e.shifts.filter((s) => r.wishes.includes(s.id)).map((s) => s.name).join(' + ')}` : 'noch keine');
  // Externe Abteilungen (nur Anzahl) – bei gewählter Schicht nur die, die in dieser Schicht helfen
  const exts = externals.forEvent(e.id, e.shifts).filter((x) => !shift || externals.coversShift(x, shift.id));
  const extTotal = exts.reduce((a, x) => a + x.person_count, 0);
  return {
    shift, filters, list, showShift: e.shifts.length > 1 && !shift, showStatus: filters.umfang !== 'bestaetigt', shiftOf,
    exts, extTotal, extShift: (x) => externals.shiftLabel(x, e.shifts),
  };
}

// Zusammenfassung der Essenseinschränkungen für die Küche: [[Bezeichnung, Anzahl]], inkl. externe Abteilungen
function dietSummary(list, exts = []) {
  const counts = externals.dietCounts(exts);
  for (const r of list) {
    const key = !r.diet.has ? 'ohne Einschränkung' : !r.diet.visible ? 'Hinweis vorhanden' : r.diet.category || 'andere';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const last = ['Hinweis vorhanden', 'ohne Einschränkung', 'extern (keine Angaben)'];
  return [...counts].sort((a, b) => (last.indexOf(a[0]) - last.indexOf(b[0])) || b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
}

function listForPerson(personId) {
  return hydrate(db.all(`${SELECT} WHERE g.person_id = ? ORDER BY e.date DESC`, personId));
}

function unresolved() {
  return hydrate(db.all(`${SELECT} WHERE g.person_id IS NULL AND g.status = 'unsicher' ORDER BY g.registered_at DESC`));
}

function personLabel(reg) {
  if (reg.person_id) {
    const p = reg.first_name ? reg : db.one('SELECT first_name, last_name FROM persons WHERE id = ?', reg.person_id);
    return `${p.first_name} ${p.last_name}`;
  }
  return `«${reg.entered_first_name || ''} ${reg.entered_last_name || ''}»`.replace('« ', '«').replace(' »', '»');
}

/**
 * Neue Anmeldung anlegen. Bei nur einer Schicht gilt sie automatisch für diese Schicht,
 * bei mehreren werden die Schichtwünsche direkt als Zuteilung übernommen.
 */
function create({ eventId, personId = null, enteredFirst = null, enteredLast = null, matchType = null, matchInfo = null, source,
  submissionId = null, answer = 'ja', wishes = [], remark = null, status = null, user = null }) {
  const event = db.one('SELECT * FROM events WHERE id = ?', eventId);
  if (!event) throw new ValidationError(['Einsatz nicht gefunden.']);
  if (personId && db.one("SELECT 1 FROM registrations WHERE event_id = ? AND person_id = ?", eventId, personId)) {
    throw new ValidationError(['Diese Person hat für diesen Einsatz bereits eine Anmeldung.']);
  }
  const finalStatus = status || (!personId ? 'unsicher' : answer === 'nein' ? 'abgesagt' : 'neu');
  const now = nowIso();
  const info = db.run(
    `INSERT INTO registrations (event_id, person_id, entered_first_name, entered_last_name, match_type, match_info, source, submission_id,
      answer, shift_wishes, remark, status, registered_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eventId, personId, enteredFirst, enteredLast, matchType, matchInfo, source, submissionId, answer, JSON.stringify(wishes),
    remark, finalStatus, now, now, user?.id || null,
  );
  const id = Number(info.lastInsertRowid);
  if (answer !== 'nein') applyWishes(id, eventId, wishes, user);
  const who = personId ? personLabel({ person_id: personId }) : personLabel({ entered_first_name: enteredFirst, entered_last_name: enteredLast });
  const text = answer === 'nein'
    ? `${who} hat für «${event.name}» abgesagt · ${SOURCE[source]}`
    : `${who} hat sich für «${event.name}» angemeldet · ${SOURCE[source]}${!personId ? ' (Zuordnung unsicher)' : ''}`;
  audit.log({ entity: 'registration', entityId: id, eventId, personId, action: 'create', summary: user ? `${text} (erfasst von ${user.display_name})` : text, user });
  live.notify(`event:${eventId}`, 'clarifications', 'feedback');
  return id;
}

function applyWishes(regId, eventId, wishes, user) {
  const shifts = db.all('SELECT id FROM shifts WHERE event_id = ? ORDER BY sort, starts_at', eventId);
  let target = [];
  if (shifts.length === 1) target = [shifts[0].id];
  else target = wishes.map(Number).filter((id) => shifts.some((s) => s.id === id));
  for (const sid of target) {
    db.run('INSERT OR IGNORE INTO shift_assignments (registration_id, shift_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)', regId, sid, nowIso(), user?.id || null);
  }
}

// Statuswechsel als Einzelaktion: prüft den erwarteten Vorzustand statt der ganzen Version
function setStatus(id, to, user, { expected = null, silent = false } = {}) {
  if (!REG_STATUS_MANUAL.includes(to) && to !== 'ungueltig') throw new ValidationError(['Dieser Status kann nicht von Hand gesetzt werden.']);
  const reg = get(id);
  if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
  if (!reg.person_id && to !== 'ungueltig') throw new ValidationError(['Bitte die Anmeldung zuerst einer Person zuordnen (Klärungen).']);
  if (reg.event_status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);
  if (reg.status === to) return { changed: false, reg };
  const from = expected || reg.status;
  const info = db.run('UPDATE registrations SET status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = ?',
    to, nowIso(), user.id, id, from);
  if (!info.changes) {
    const now = get(id);
    if (now.status === to) return { changed: false, reg: now };
    const last = db.one("SELECT * FROM audit_log WHERE entity_type = 'registration' AND entity_id = ? ORDER BY id DESC LIMIT 1", id);
    throw new ValidationError([`Diese Anmeldung wurde soeben${last?.user_name ? ` von ${last.user_name}` : ''} geändert (Status → ${REG_STATUS[now.status].label}). Bitte prüfen.`]);
  }
  // Abmeldung: aus allen Schichten entfernen
  if (['zurueckgezogen', 'abgesagt', 'ungueltig'].includes(to)) db.run('DELETE FROM shift_assignments WHERE registration_id = ?', id);
  // Wieder aktiv: Standardschicht/Wünsche erneut zuteilen
  if (['zurueckgezogen', 'abgesagt'].includes(reg.status) && !['zurueckgezogen', 'abgesagt', 'ungueltig'].includes(to)) {
    applyWishes(id, reg.event_id, reg.wishes, user);
  }
  const verbs = {
    bestaetigt: 'bestätigt', zurueckgezogen: 'als zurückgezogen markiert', warteliste: 'auf die Warteliste gesetzt',
    rueckfrage: 'auf «Rückfrage nötig» gesetzt', neu: 'auf «Neu eingegangen» zurückgesetzt', abgesagt: 'als abgesagt markiert', ungueltig: 'als ungültig markiert',
  };
  if (!silent) {
    audit.log({
      entity: 'registration', entityId: id, eventId: reg.event_id, personId: reg.person_id, action: 'status',
      summary: `${user.display_name} hat die Anmeldung von ${personLabel(reg)} ${verbs[to]} · ${reg.event_name}`,
      details: { status: { alt: reg.status, neu: to } }, user,
    });
  }
  if (to === 'bestaetigt') {
    // Automatische Anmeldebestätigung per E-Mail (sofern hinterlegt)
    require('./calendar').sendConfirmation(id, user).catch((err) => console.error('Bestätigung fehlgeschlagen:', err));
  }
  live.notify(`event:${reg.event_id}`, 'feedback', `person:${reg.person_id}`);
  return { changed: true, reg };
}

function bulkStatus(ids, to, user) {
  let changed = 0;
  const errors = [];
  for (const id of ids) {
    try {
      if (setStatus(Number(id), to, user).changed) changed++;
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { changed, errors };
}

// Interne Bemerkung mit Versionsprüfung
function updateNote(id, note, expectedVersion, user) {
  const reg = get(id);
  if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
  if (Number(expectedVersion) !== reg.version) {
    const last = db.one("SELECT * FROM audit_log WHERE entity_type = 'registration' AND entity_id = ? ORDER BY id DESC LIMIT 1", id);
    throw new ConflictError(reg, last);
  }
  db.run('UPDATE registrations SET internal_note = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
    String(note || '').trim() || null, nowIso(), user.id, id);
  audit.log({
    entity: 'registration', entityId: id, eventId: reg.event_id, personId: reg.person_id, action: 'note',
    summary: `${user.display_name} hat die interne Bemerkung zu ${personLabel(reg)} geändert`, details: { internal_note: { alt: reg.internal_note, neu: note } }, user,
  });
  live.notify(`event:${reg.event_id}`);
}

/**
 * Zuordnen / Umhängen (Konzept 7.2/7.3). Historie: vorherige Person, neue Person, Benutzer, Zeitpunkt, Art.
 */
function assignPerson(id, personId, user, { saveAlias = false, keepShifts = true } = {}) {
  return db.tx(() => {
    const reg = get(id);
    if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
    const person = db.one("SELECT * FROM persons WHERE id = ?", personId);
    if (!person) throw new ValidationError(['Person nicht gefunden.']);
    if (reg.person_id === person.id) return { changed: false };
    const existing = db.one('SELECT id FROM registrations WHERE event_id = ? AND person_id = ? AND id <> ?', reg.event_id, personId, id);
    if (existing) {
      throw new ValidationError([`${person.first_name} ${person.last_name} hat für diesen Einsatz bereits eine Anmeldung. Diese Anmeldung kann als ungültig (doppelt) markiert werden.`]);
    }
    const newStatus = reg.status === 'unsicher' ? (reg.answer === 'nein' ? 'abgesagt' : 'neu') : reg.status;
    db.run(`UPDATE registrations SET person_id = ?, match_type = 'manuell', match_info = NULL, status = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
      personId, newStatus, nowIso(), user.id, id);
    if (!keepShifts) db.run('DELETE FROM shift_assignments WHERE registration_id = ?', id);
    let aliasSaved = false;
    if (saveAlias && reg.entered_first_name && reg.entered_last_name) {
      aliasSaved = persons.addAlias(personId, reg.entered_first_name, reg.entered_last_name, user);
    }
    const prev = reg.person_id ? `${reg.first_name} ${reg.last_name}` : null;
    audit.log({
      entity: 'registration', entityId: id, eventId: reg.event_id, personId, action: 'assign',
      summary: prev
        ? `${user.display_name} hat die Anmeldung von ${prev} zu ${person.first_name} ${person.last_name} umgehängt · ${reg.event_name}`
        : `${user.display_name} hat «${reg.entered_name}» ${person.first_name} ${person.last_name} zugeordnet · ${reg.event_name}`,
      details: { vorher_person_id: reg.person_id, vorher: prev, neu_person_id: personId, neu: `${person.first_name} ${person.last_name}`, art: 'manuell', schichten_behalten: keepShifts },
      user,
    });
    if (reg.person_id) {
      audit.log({ entity: 'registration', entityId: id, eventId: reg.event_id, personId: reg.person_id, action: 'unassign', summary: `${user.display_name} hat die Anmeldung zu «${reg.event_name}» von ${prev} weg umgehängt`, user });
    }
    live.notify(`event:${reg.event_id}`, 'clarifications', 'feedback');
    return { changed: true, aliasSaved };
  });
}

// Schichtzuteilung setzen (Umteilen über das Auswahlfeld)
function setShifts(id, shiftIds, user) {
  const reg = get(id);
  if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
  if (reg.event_status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);
  const valid = db.all('SELECT id, name FROM shifts WHERE event_id = ?', reg.event_id);
  const ids = [...new Set(shiftIds.map(Number))].filter((sid) => valid.some((s) => s.id === sid));
  db.tx(() => {
    db.run('DELETE FROM shift_assignments WHERE registration_id = ?', id);
    for (const sid of ids) db.run('INSERT INTO shift_assignments (registration_id, shift_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?)', id, sid, nowIso(), user.id);
  });
  const before = reg.assigned.map((a) => a.name).join(' + ') || 'keine';
  const after = valid.filter((s) => ids.includes(s.id)).map((s) => s.name).join(' + ') || 'keine';
  if (before !== after) {
    audit.log({
      entity: 'registration', entityId: id, eventId: reg.event_id, personId: reg.person_id, action: 'shifts',
      summary: `${user.display_name} hat ${personLabel(reg)} umgeteilt: ${before} → ${after}`, user,
    });
  }
  live.notify(`event:${reg.event_id}`);
}

// Hinweis bei Überschneidung (nicht blockierend)
function overlaps(eventId) {
  const rows = db.all(`SELECT a.registration_id, s.id, s.name, s.starts_at, s.ends_at, p.first_name, p.last_name, r.short AS rank_short
    FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id JOIN registrations g ON g.id = a.registration_id
    LEFT JOIN persons p ON p.id = g.person_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE s.event_id = ? AND g.status NOT IN ('zurueckgezogen','abgesagt','ungueltig') AND s.starts_at IS NOT NULL AND s.ends_at IS NOT NULL
    ORDER BY a.registration_id, s.starts_at`, eventId);
  const byReg = new Map();
  for (const r of rows) {
    if (!byReg.has(r.registration_id)) byReg.set(r.registration_id, []);
    byReg.get(r.registration_id).push(r);
  }
  const out = [];
  for (const list of byReg.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.starts_at < b.ends_at && b.starts_at < a.ends_at) {
          const from = a.starts_at > b.starts_at ? a.starts_at : b.starts_at;
          const to = a.ends_at < b.ends_at ? a.ends_at : b.ends_at;
          out.push({ person: `${a.rank_short ? `${a.rank_short} ` : ''}${a.first_name} ${a.last_name}`, shifts: [a.name, b.name], from: from.slice(11), to: to.slice(11) });
        }
      }
    }
  }
  return out;
}

// Gleicher eingegebener Name ohne Zuordnung beim selben Einsatz -> fachliches Duplikat
function findUnresolvedDuplicate(eventId, first, last) {
  const key = nameKey(first, last);
  return db.all("SELECT * FROM registrations WHERE event_id = ? AND person_id IS NULL AND status = 'unsicher'", eventId)
    .find((r) => nameKey(r.entered_first_name, r.entered_last_name) === key) || null;
}

/**
 * Anmeldung/Abmeldung ganz entfernen, als wäre sie nie eingegangen.
 * Schichtzuteilungen verschwinden mit; eine daraus entstandene Anfrage wird wieder «offen»
 * (die Kontaktversuche bleiben stehen). Der rohe Formular-Eingang bleibt unter «Formulare» erhalten.
 */
function remove(id, user) {
  const reg = get(id);
  if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
  if (reg.event_status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);
  db.tx(() => {
    db.run("UPDATE inquiries SET registration_id = NULL, status = CASE WHEN status = 'zugesagt' THEN 'offen' ELSE status END, version = version + 1, updated_at = ?, updated_by = ? WHERE registration_id = ?",
      nowIso(), user.id, id);
    db.run('UPDATE mail_outbox SET registration_id = NULL WHERE registration_id = ?', id);
    db.run('DELETE FROM registrations WHERE id = ?', id);
    audit.log({
      entity: 'registration', entityId: id, eventId: reg.event_id, personId: reg.person_id, action: 'delete',
      summary: `${user.display_name} hat die ${['zurueckgezogen', 'abgesagt'].includes(reg.status) ? 'Abmeldung' : 'Anmeldung'} von ${personLabel(reg)} gelöscht · ${reg.event_name}`,
      details: { status: reg.status }, user,
    });
  });
  live.notify(`event:${reg.event_id}`, 'feedback', 'cockpit', 'clarifications', ...(reg.person_id ? [`person:${reg.person_id}`] : []));
  return reg;
}

module.exports = {
  remove, get, listForEvent, listForPerson, unresolved, create, setStatus, bulkStatus, updateNote, assignPerson, setShifts, overlaps,
  applyWishes, personLabel, findUnresolvedDuplicate, hydrate, participants, participantView, dietSummary, PARTICIPANT_SCOPES,
};
