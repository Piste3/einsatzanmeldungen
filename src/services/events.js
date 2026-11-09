'use strict';
// Einsätze und Schichten
const db = require('../db');
const audit = require('./audit');
const externals = require('./externals');
const functions = require('./functions');
const shiftTeams = require('./shift-teams');
const live = require('../lib/live');
const { nowIso, localNow, isYmd, isHm, addDays, fmtDateShort, fmtEventDate, isMultiDay } = require('../lib/dates');
const { EVENT_STATUS, REG_COUNTING } = require('../lib/labels');
const { ConflictError, ValidationError, ReadOnlyError } = require('./errors');

const FIELDS = ['name', 'date', 'description', 'start_time', 'end_time', 'start_place', 'end_place', 'tenue', 'leader_person_id',
  'internal_note', 'question_template_id', 'question_text', 'help_text', 'extra'];
const FIELD_LABELS = {
  name: 'Name', date: 'Datum', description: 'Beschreibung', start_time: 'Beginn (Antreten)', end_time: 'Ende (Abtreten)',
  start_place: 'Antretensort', end_place: 'Abtretensort', tenue: 'Tenue', leader_person_id: 'Einsatzleitung',
  internal_note: 'Interne Bemerkung', question_template_id: 'Anmeldefrage (Vorlage)', question_text: 'Fragetext', help_text: 'Hilfetext',
  extra: 'Zusatzfelder', status: 'Status', show_in_form: 'Im Formular anzeigen',
};

function get(id) {
  const e = db.one(`SELECT e.*, p.first_name AS leader_first, p.last_name AS leader_last, p.mobile AS leader_mobile, r.short AS leader_rank
    FROM events e LEFT JOIN persons p ON p.id = e.leader_person_id LEFT JOIN ranks r ON r.id = p.rank_id WHERE e.id = ?`, id);
  if (!e) return null;
  e.extra = parseJson(e.extra, {});
  e.shifts = shiftsOf(id);
  return e;
}

function parseJson(s, fallback) {
  try { return typeof s === 'string' ? JSON.parse(s) : s ?? fallback; } catch { return fallback; }
}

// Schichten mit «targets» = Soll pro Funktion ({ id: Anzahl }); target_count ist die Summe davon.
// «teams» = vorgesehene Mannschaften (leer = alle)
function shiftsOf(eventId) {
  return db.all('SELECT * FROM shifts WHERE event_id = ? ORDER BY sort, starts_at, id', eventId)
    .map((s) => ({ ...s, targets: functions.parseTargets(s.function_targets), teams: shiftTeams.parse(s.team_ids) }));
}

// Formular -> vorgesehene Mannschaften; null = Feld war nicht im Formular (nichts ändern)
function teamsFromInput(input) {
  if (!input || input.teams_shown === undefined) return null;
  return shiftTeams.parse(input.teams);
}

// Soll pro Funktion einer Schicht speichern; das Soll der Schicht ist die Summe
function setShiftTargets(shiftId, targets) {
  const json = JSON.stringify(targets || {});
  const sum = functions.total(targets) || null;
  db.run('UPDATE shifts SET function_targets = ?, target_count = ? WHERE id = ?', json, sum, shiftId);
}

// Formular -> Soll pro Funktion; ältere Aufrufe mit nur «target_count» zählen als Standardfunktion (Einsatzteilnehmer)
function targetsFromInput(input, prefix = 'fn_target_') {
  const t = functions.readTargets(input, prefix);
  if (t) return t;
  const n = Number(input?.target_count);
  if (input && input.target_count !== undefined && input.target_count !== '' && Number.isInteger(n) && n > 0) return { [functions.defaultFn().id]: n };
  return input && input.target_count !== undefined ? {} : null;
}

// Reihenfolge nach erstem Tag; Einsätze ganz ohne Datum zuletzt
const ORDER = 'e.date_from IS NULL, e.date_from, e.start_time, e.id';

// Zeitraum-Filter: der Einsatz überschneidet sich mit [from, to]; undated = auch Einsätze ohne Datum
function list({ status = '', from = '', to = '', q = '', undated = false } = {}) {
  const where = [];
  const params = [];
  if (status === 'aktiv') where.push("e.status IN ('entwurf','veroeffentlicht')");
  else if (status && EVENT_STATUS[status]) { where.push('e.status = ?'); params.push(status); }
  const range = [];
  if (from && isYmd(from)) { range.push('e.date_to >= ?'); params.push(from); }
  if (to && isYmd(to)) { range.push('e.date_from <= ?'); params.push(to); }
  if (range.length) where.push(undated ? `(e.date_from IS NULL OR (${range.join(' AND ')}))` : range.join(' AND '));
  if (q) { where.push('lower(e.name) LIKE ?'); params.push(`%${q.toLowerCase()}%`); }
  const rows = db.all(`SELECT e.*, p.first_name AS leader_first, p.last_name AS leader_last, r.short AS leader_rank
    FROM events e LEFT JOIN persons p ON p.id = e.leader_person_id LEFT JOIN ranks r ON r.id = p.rank_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${ORDER}`, ...params);
  for (const e of rows) {
    e.extra = parseJson(e.extra, {});
    e.shifts = shiftsOf(e.id);
  }
  return rows;
}

// Lokale Zeitpunkte aus Datum + Uhrzeit; Ende vor Beginn = nächster Tag
function span(date, start, end) {
  if (!isYmd(date)) return { starts_at: null, ends_at: null };
  const s = isHm(start) ? `${date}T${start}` : null;
  let e = isHm(end) ? `${date}T${end}` : null;
  if (s && e && e <= s) e = `${addDays(date, 1)}T${end}`;
  return { starts_at: s, ends_at: e };
}

// Letzter Tag eines Einsatzes (Einsatzdatum oder späteste Schicht)
function lastDay(event) {
  return event.date_to || event.date || event.date_from || null;
}

// Ende der letzten Schicht (Einsatz ohne Schichten/Zeiten: Einsatzende bzw. Tagesende; ganz ohne Datum: null)
function lastEnd(event, shifts = event.shifts || shiftsOf(event.id)) {
  const ends = shifts.map((s) => s.ends_at || (s.starts_at ? `${s.starts_at.slice(0, 10)}T23:59` : null)).filter(Boolean);
  if (ends.length) return ends.sort().at(-1);
  const sp = span(event.date, event.start_time, event.end_time);
  const day = lastDay(event);
  return sp.ends_at || (day ? `${day}T23:59` : null);
}

function shiftEnded(shift, event, now = localNow()) {
  const day = lastDay(event);
  const end = shift.ends_at || (shift.starts_at ? `${shift.starts_at.slice(0, 10)}T23:59` : day ? `${day}T23:59` : null);
  return Boolean(end) && end <= now;
}

// Ohne jedes Datum erscheint ein Einsatz nicht im Formular
function isInForm(event, now = localNow()) {
  const end = lastEnd(event);
  return event.status === 'veroeffentlicht' && Boolean(event.show_in_form) && Boolean(end) && end > now;
}


// Alle Einsätze, die im Formular erscheinen – sortiert nach Datum, nur noch nicht vorbei Schichten
function openForForm(now = localNow()) {
  return list({ status: 'veroeffentlicht' })
    .filter((e) => isInForm(e, now))
    .map((e) => ({ ...e, openShifts: e.shifts.filter((s) => !shiftEnded(s, e, now)) }))
    .filter((e) => e.shifts.length === 0 || e.openShifts.length > 0);
}

function clean(input, extraDefs) {
  const s = (v) => {
    const t = String(v ?? '').trim();
    return t === '' ? null : t;
  };
  const extra = {};
  for (const def of extraDefs) {
    const raw = input[`extra_${def.id}`];
    if (def.field_type === 'checkbox') extra[def.name] = raw ? 'Ja' : '';
    else extra[def.name] = String(raw ?? '').trim();
  }
  const data = {
    name: s(input.name),
    date: s(input.date),
    description: s(input.description),
    start_time: s(input.start_time),
    end_time: s(input.end_time),
    start_place: s(input.start_place),
    end_place: s(input.end_place),
    tenue: s(input.tenue),
    leader_person_id: input.leader_person_id ? Number(input.leader_person_id) : null,
    internal_note: s(input.internal_note),
    question_template_id: input.question_template_id ? Number(input.question_template_id) : null,
    question_text: s(input.question_text),
    help_text: s(input.help_text),
    extra: JSON.stringify(extra),
  };
  const errors = [];
  if (!data.name) errors.push('Name des Einsatzes fehlt.');
  if (data.date && !isYmd(data.date)) errors.push('Datum ist ungültig.');
  if (data.start_time && !isHm(data.start_time)) errors.push('Beginn muss als HH:MM angegeben werden.');
  if (data.end_time && !isHm(data.end_time)) errors.push('Ende muss als HH:MM angegeben werden.');
  if (errors.length) throw new ValidationError(errors);
  return data;
}

function extraDefs() {
  return db.all('SELECT * FROM extra_fields ORDER BY sort, name');
}

function create(input, user) {
  const data = clean(input, extraDefs());
  const targets = targetsFromInput(input);
  return db.tx(() => {
    const now = nowIso();
    const info = db.run(
      `INSERT INTO events (${FIELDS.join(', ')}, status, show_in_form, created_at, updated_at, created_by, updated_by)
       VALUES (${FIELDS.map(() => '?').join(', ')}, 'entwurf', 0, ?, ?, ?, ?)`,
      ...FIELDS.map((f) => data[f]), now, now, user.id, user.id,
    );
    const id = Number(info.lastInsertRowid);
    // Standardschicht für den ganzen Einsatz mit Soll pro Funktion; Soll der Schicht = Summe
    const sp = span(data.date, data.start_time, data.end_time);
    const sid = Number(db.run('INSERT INTO shifts (event_id, name, starts_at, ends_at, is_default, sort) VALUES (?, ?, ?, ?, 1, 0)',
      id, 'Ganzer Einsatz', sp.starts_at, sp.ends_at).lastInsertRowid);
    setShiftTargets(sid, targets || {});
    audit.log({ entity: 'event', entityId: id, eventId: id, action: 'create', summary: `${user.display_name} hat den Einsatz «${data.name}» angelegt`, user });
    live.notify('events');
    return id;
  });
}

function assertEditable(event, user, reason) {
  if (event.status !== 'abgeschlossen') return;
  if (user.role !== 'admin') throw new ReadOnlyError();
  if (!String(reason || '').trim()) throw new ReadOnlyError('Für Änderungen an einem abgeschlossenen Einsatz ist eine Begründung nötig.');
}

function update(id, input, expectedVersion, user, { reason } = {}) {
  const data = clean(input, extraDefs());
  // Soll pro Schicht und Funktion aus dem Formular (Felder fn_target_<schicht>_<funktion>)
  const shiftTargets = new Map();
  for (const sh of shiftsOf(id)) {
    const t = functions.readTargets(input, `fn_target_${sh.id}_`);
    if (t) shiftTargets.set(sh.id, t);
  }
  return db.tx(() => {
    const before = get(id);
    if (!before) throw new ValidationError(['Einsatz nicht gefunden.']);
    assertEditable(before, user, reason);
    if (Number(expectedVersion) !== before.version) throw new ConflictError(before, lastChange(id));
    db.run(
      `UPDATE events SET ${FIELDS.map((f) => `${f} = ?`).join(', ')}, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?`,
      ...FIELDS.map((f) => data[f]), nowIso(), user.id, id,
    );
    // Standardschicht folgt den Einsatzzeiten, solange es die einzige Schicht ist
    // (ohne Einsatzdatum bleibt sie an ihrem bisherigen Tag)
    if (before.shifts.length === 1 && before.shifts[0].is_default) {
      const sp = span(data.date || before.shifts[0].starts_at?.slice(0, 10), data.start_time, data.end_time);
      db.run('UPDATE shifts SET starts_at = ?, ends_at = ? WHERE id = ?', sp.starts_at, sp.ends_at, before.shifts[0].id);
    }
    let targetsChanged = false;
    for (const sh of before.shifts) {
      const t = shiftTargets.get(sh.id);
      if (t && JSON.stringify(t) !== JSON.stringify(sh.targets)) { setShiftTargets(sh.id, t); targetsChanged = true; }
    }
    if (targetsChanged) {
      audit.log({ entity: 'event', entityId: id, eventId: id, action: 'targets', summary: `${user.display_name} hat bei «${data.name}» das Soll pro Funktion geändert${reason ? ` – Begründung: ${reason}` : ''}`, user });
    }
    const beforeCmp = { ...before, extra: JSON.stringify(before.extra) };
    const changes = audit.diff(beforeCmp, data, FIELDS);
    if (Object.keys(changes).length) {
      audit.log({
        entity: 'event', entityId: id, eventId: id, action: 'update',
        summary: `${user.display_name} hat «${data.name}» geändert (${Object.keys(changes).map((k) => FIELD_LABELS[k] || k).join(', ')})${reason ? ` – Begründung: ${reason}` : ''}`,
        details: changes, user,
      });
    }
    live.notify('events', `event:${id}`, 'form');
  });
}

function lastChange(id) {
  return db.one("SELECT * FROM audit_log WHERE entity_type = 'event' AND entity_id = ? ORDER BY id DESC LIMIT 1", id);
}

const TRANSITIONS = {
  veroeffentlicht: ['entwurf'],
  abgeschlossen: ['veroeffentlicht', 'entwurf'],
  abgesagt: ['entwurf', 'veroeffentlicht'],
  entwurf: ['veroeffentlicht', 'abgesagt'],
};

// Statuswechsel als Einzelaktion mit Prüfung des erwarteten Vorzustands
function setStatus(id, status, user, { reason } = {}) {
  const e = get(id);
  if (!e) throw new ValidationError(['Einsatz nicht gefunden.']);
  if (!TRANSITIONS[status]) throw new ValidationError(['Unbekannter Status.']);
  if (e.status === 'abgeschlossen') assertEditable(e, user, reason);
  else if (!TRANSITIONS[status].includes(e.status)) {
    throw new ValidationError([`Wechsel von «${EVENT_STATUS[e.status].label}» zu «${EVENT_STATUS[status].label}» ist nicht möglich.`]);
  }
  if (status === 'veroeffentlicht' && !e.date_from) {
    throw new ValidationError(['Der Einsatz hat noch kein Datum. Bitte beim Einsatz ein Datum eintragen oder den Schichten ein Datum geben.']);
  }
  // Beim Veröffentlichen automatisch ins Formular, bei Absage/Abschluss heraus
  const showInForm = status === 'veroeffentlicht' ? 1 : 0;
  const info = db.run('UPDATE events SET status = ?, show_in_form = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ? AND status = ?',
    status, showInForm, nowIso(), user.id, id, e.status);
  if (!info.changes) throw new ValidationError(['Der Einsatz wurde soeben von jemand anderem geändert. Bitte neu laden.']);
  const verbs = { veroeffentlicht: 'veröffentlicht', abgeschlossen: 'abgeschlossen', abgesagt: 'abgesagt', entwurf: 'auf Entwurf zurückgesetzt' };
  audit.log({
    entity: 'event', entityId: id, eventId: id, action: 'status',
    summary: `${user.display_name} hat «${e.name}» ${verbs[status]}${reason ? ` – Begründung: ${reason}` : ''}`,
    details: { status: { alt: e.status, neu: status } }, user,
  });
  live.notify('events', `event:${id}`, 'form');
}

function setShowInForm(id, on, user) {
  const e = get(id);
  if (!e) throw new ValidationError(['Einsatz nicht gefunden.']);
  if (on && e.status !== 'veroeffentlicht') throw new ValidationError(['Nur veröffentlichte Einsätze können im Formular angezeigt werden.']);
  db.run('UPDATE events SET show_in_form = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?', on ? 1 : 0, nowIso(), user.id, id);
  audit.log({
    entity: 'event', entityId: id, eventId: id, action: 'form',
    summary: `${user.display_name} hat «${e.name}» ${on ? 'ins Formular aufgenommen' : 'aus dem Formular genommen'}`, user,
  });
  live.notify('events', `event:${id}`, 'form');
}

function cleanShift(event, input) {
  const name = String(input.name || '').trim();
  const date = isYmd(input.date) ? input.date : event.date;
  if (!name) throw new ValidationError(['Name der Schicht fehlt.']);
  if (input.start && !isHm(input.start)) throw new ValidationError(['Beginn als HH:MM angeben.']);
  if (input.end && !isHm(input.end)) throw new ValidationError(['Ende als HH:MM angeben.']);
  if (!date && (input.start || input.end)) throw new ValidationError(['Datum fehlt (der Einsatz hat kein eigenes Datum).']);
  const sp = span(date, input.start, input.end);
  return {
    name, starts_at: sp.starts_at, ends_at: sp.ends_at,
    start_place: String(input.start_place || '').trim() || null, internal_note: String(input.internal_note || '').trim() || null,
  };
}

function addShift(eventId, input, user, { reason } = {}) {
  const e = get(eventId);
  assertEditable(e, user, reason);
  insertShift(e, cleanShift(e, input), targetsFromInput(input) || {}, user);
  live.notify(`event:${eventId}`, 'form');
}

function updateShift(shiftId, input, user, { reason } = {}) {
  const shift = db.one('SELECT * FROM shifts WHERE id = ?', shiftId);
  if (!shift) throw new ValidationError(['Schicht nicht gefunden.']);
  const e = get(shift.event_id);
  assertEditable(e, user, reason);
  const s = cleanShift(e, input);
  const targets = targetsFromInput(input);
  db.run('UPDATE shifts SET name = ?, starts_at = ?, ends_at = ?, start_place = ?, internal_note = ?, is_default = 0, version = version + 1 WHERE id = ?',
    s.name, s.starts_at, s.ends_at, s.start_place, s.internal_note, shiftId);
  if (targets) setShiftTargets(shiftId, targets);
  const details = audit.diff(shift, s, Object.keys(s));
  if (targets && JSON.stringify(targets) !== JSON.stringify(functions.parseTargets(shift.function_targets))) details.soll = { alt: shift.target_count, neu: functions.total(targets) || null };
  audit.log({ entity: 'shift', entityId: shiftId, eventId: e.id, action: 'update', summary: `${user.display_name} hat die Schicht «${s.name}» bei «${e.name}» geändert`, details, user });
  live.notify(`event:${e.id}`, 'form');
}

// Tabelle «Schichten verwalten»: alle Zeilen mit einem Klick speichern. Gespeichert werden nur
// Zeilen, die sich geändert haben; ist in der leeren Zeile ein Name eingetragen, kommt eine neue
// Schicht dazu. Alles oder nichts: ist eine Zeile ungültig, wird nichts gespeichert.
// rows: { <shiftId>: { name, date, start, end, start_place, internal_note, fn_target_<fid> } }
function saveShifts(eventId, rows, newRow, user, { reason } = {}) {
  const e = get(eventId);
  if (!e) throw new ValidationError(['Einsatz nicht gefunden.']);
  assertEditable(e, user, reason);
  const updates = [];
  for (const shift of db.all('SELECT * FROM shifts WHERE event_id = ? ORDER BY sort, id', eventId)) {
    const input = rows && rows[shift.id];
    if (!input) continue;
    let s;
    let targets;
    try {
      s = cleanShift(e, input);
      targets = targetsFromInput(input);
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(err.messages.map((m) => `Schicht «${shift.name}»: ${m}`));
      throw err;
    }
    const oldTargets = functions.parseTargets(shift.function_targets);
    const targetsChanged = Boolean(targets) && JSON.stringify(functions.parseTargets(targets)) !== JSON.stringify(oldTargets);
    const teams = teamsFromInput(input);
    const oldTeams = shiftTeams.parse(shift.team_ids);
    const teamsChanged = Boolean(teams) && JSON.stringify(teams) !== JSON.stringify(oldTeams);
    const details = audit.diff(shift, s, Object.keys(s));
    if (!Object.keys(details).length && !targetsChanged && !teamsChanged) continue;
    if (targetsChanged) details.soll = { alt: shift.target_count, neu: functions.total(targets) || null };
    if (teamsChanged) details.mannschaften = { alt: shiftTeams.label(oldTeams) || 'alle', neu: shiftTeams.label(teams) || 'alle' };
    updates.push({ shift, s, targets: targetsChanged ? targets : null, teams: teamsChanged ? teams : null, details });
  }
  let added = null;
  const hasNew = newRow && ['name', 'start', 'end', 'start_place', 'internal_note'].some((k) => String(newRow[k] || '').trim())
    || (newRow && Object.keys(newRow).some((k) => k.startsWith('fn_target_') && String(newRow[k] || '').trim()));
  if (hasNew) {
    if (!String(newRow.name || '').trim()) throw new ValidationError(['Neue Schicht: Name fehlt.']);
    try {
      added = { s: cleanShift(e, newRow), targets: targetsFromInput(newRow) || {}, teams: teamsFromInput(newRow) || [] };
    } catch (err) {
      if (err instanceof ValidationError) throw new ValidationError(err.messages.map((m) => `Neue Schicht: ${m}`));
      throw err;
    }
  }
  if (!updates.length && !added) return { updated: 0, added: false };
  db.tx(() => {
    for (const u of updates) {
      db.run('UPDATE shifts SET name = ?, starts_at = ?, ends_at = ?, start_place = ?, internal_note = ?, is_default = 0, version = version + 1 WHERE id = ?',
        u.s.name, u.s.starts_at, u.s.ends_at, u.s.start_place, u.s.internal_note, u.shift.id);
      if (u.targets) setShiftTargets(u.shift.id, u.targets);
      if (u.teams) db.run('UPDATE shifts SET team_ids = ? WHERE id = ?', JSON.stringify(u.teams), u.shift.id);
      audit.log({ entity: 'shift', entityId: u.shift.id, eventId: e.id, action: 'update', summary: `${user.display_name} hat die Schicht «${u.s.name}» bei «${e.name}» geändert${reason ? ` – Begründung: ${reason}` : ''}`, details: u.details, user });
    }
    if (added) insertShift(e, added.s, added.targets, user, added.teams);
  });
  live.notify(`event:${e.id}`, 'form');
  return { updated: updates.length, added: Boolean(added) };
}

function insertShift(e, s, targets, user, teams = []) {
  const sort = (db.one('SELECT max(sort) AS m FROM shifts WHERE event_id = ?', e.id).m ?? 0) + 1;
  const info = db.run('INSERT INTO shifts (event_id, name, starts_at, ends_at, start_place, internal_note, team_ids, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    e.id, s.name, s.starts_at, s.ends_at, s.start_place, s.internal_note, JSON.stringify(shiftTeams.parse(teams)), sort);
  setShiftTargets(Number(info.lastInsertRowid), targets || {});
  // Sobald es mehrere Schichten gibt, ist die Standardschicht eine normale Schicht
  db.run('UPDATE shifts SET is_default = 0 WHERE event_id = ?', e.id);
  audit.log({ entity: 'shift', entityId: Number(info.lastInsertRowid), eventId: e.id, action: 'create', summary: `${user.display_name} hat bei «${e.name}» die Schicht «${s.name}» hinzugefügt`, user });
}

function deleteShift(shiftId, user, { reason } = {}) {
  const shift = db.one('SELECT * FROM shifts WHERE id = ?', shiftId);
  if (!shift) return;
  const e = get(shift.event_id);
  assertEditable(e, user, reason);
  if (e.shifts.length <= 1) throw new ValidationError(['Ein Einsatz braucht mindestens eine Schicht.']);
  db.tx(() => {
    db.run('DELETE FROM shift_assignments WHERE shift_id = ?', shiftId);
    externals.dropShift(e.id, shiftId);
    db.run('DELETE FROM shifts WHERE id = ?', shiftId);
  });
  audit.log({ entity: 'shift', entityId: shiftId, eventId: e.id, action: 'delete', summary: `${user.display_name} hat die Schicht «${shift.name}» bei «${e.name}» gelöscht`, user });
  live.notify(`event:${e.id}`, 'form');
}

// Was fehlt noch? (Checkliste in der Übersicht)
function checklist(e) {
  const items = [
    { label: 'Name und Datum (Einsatz oder Schichten)', done: Boolean(e.name && e.date_from) },
    { label: 'Antreten (Zeit und Ort)', done: Boolean(e.start_time && e.start_place) },
    { label: 'Abtreten (Zeit)', done: Boolean(e.end_time) },
    { label: 'Einsatzleitung', done: Boolean(e.leader_person_id) },
    { label: 'Tenue', done: Boolean(e.tenue) },
    { label: e.shifts.length > 1 ? 'Soll pro Schicht und Funktion' : 'Soll pro Funktion (EL, SC, BF, TN …)', done: e.shifts.every((s) => s.target_count) },
    { label: 'Anmeldefrage', done: Boolean(e.question_text) },
    { label: 'Veröffentlicht', done: e.status !== 'entwurf' },
  ];
  for (const def of extraDefs().filter((d) => d.required)) items.push({ label: def.name, done: Boolean(e.extra?.[def.name]) });
  return items;
}

// Zähler und Besetzung je Schicht
function stats(e) {
  const counts = Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM registrations WHERE event_id = ? GROUP BY status', e.id).map((r) => [r.status, r.n]));
  const ph = REG_COUNTING.map(() => '?').join(',');
  // Externe Abteilungen zählen mit ihrer Anzahl Personen zur Besetzung
  const ext = externals.countsByShift(e.id, e.shifts);
  const shifts = e.shifts.map((s) => {
    const intern = db.one(`SELECT COUNT(*) AS n FROM shift_assignments a JOIN registrations r ON r.id = a.registration_id
      WHERE a.shift_id = ? AND r.status IN (${ph})`, s.id, ...REG_COUNTING).n;
    const extern = ext[s.id] || 0;
    const ist = intern + extern;
    const soll = s.target_count || null;
    return { ...s, ist, intern, extern, soll, tone: occupancyTone(ist, soll), missing: soll ? Math.max(0, soll - ist) : null };
  });
  const inquiryOpen = db.one(`SELECT COUNT(*) AS n FROM inquiries i WHERE i.event_id = ? AND i.status IN ('nicht_erreicht','whatsapp','unsicher')
    AND NOT EXISTS (SELECT 1 FROM registrations g WHERE g.event_id = i.event_id AND g.person_id = i.person_id AND g.status <> 'ungueltig')`, e.id).n;
  const activePersons = db.one("SELECT COUNT(*) AS n FROM persons WHERE status = 'aktiv'").n;
  const responded = db.one(`SELECT COUNT(DISTINCT person_id) AS n FROM (
      SELECT person_id FROM registrations WHERE event_id = ? AND person_id IS NOT NULL AND status <> 'ungueltig'
      UNION SELECT person_id FROM inquiries WHERE event_id = ? AND status <> 'offen')`, e.id, e.id).n;
  return {
    counts,
    neu: counts.neu || 0,
    unsicher: counts.unsicher || 0,
    rueckfrage: counts.rueckfrage || 0,
    bestaetigt: counts.bestaetigt || 0,
    zuPruefen: (counts.unsicher || 0) + (counts.rueckfrage || 0),
    total: Object.entries(counts).filter(([k]) => k !== 'ungueltig').reduce((a, [, n]) => a + n, 0),
    shifts,
    inquiryOpen,
    offen: Math.max(0, activePersons - responded),
    full: shifts.length > 0 && shifts.every((s) => s.soll && s.ist >= s.soll),
  };
}

function occupancyTone(ist, soll) {
  if (!soll) return 'gray';
  if (ist >= soll) return 'green';
  if (ist / soll >= 0.5) return 'yellow';
  return 'red';
}

// Datum oder Zeitraum für Listen und Mails: 07.11.2026 bzw. 07.11.–09.11.2026; ohne Datum «Datum offen»
function dateRange(e) {
  return fmtEventDate(e);
}

function label(e) {
  return `${e.name} (${dateRange(e)})`;
}

module.exports = {
  get, list, create, update, isMultiDay, lastDay, dateRange, ORDER, setStatus, setShowInForm, addShift, updateShift, saveShifts, deleteShift, checklist, stats, span, lastEnd,
  shiftEnded, isInForm, openForForm, shiftsOf, extraDefs, assertEditable, occupancyTone, label, FIELD_LABELS, lastChange, parseJson,
  fmtDateShort, setShiftTargets,
};
