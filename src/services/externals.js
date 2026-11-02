'use strict';
// Externe Abteilungen: andere Abteilungen/Vereine, die an einem Einsatz mit einer Anzahl Personen mithelfen (ohne Namen)
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const { nowIso } = require('../lib/dates');
const { ValidationError } = require('./errors');
const { DIET } = require('../lib/labels');

const MAX_COUNT = 9999;
const MAX_DIET_LINES = 20;

// Essenseinschränkungen einer externen Abteilung: [{ count, category, text }] (nur Anzahl, ohne Namen)
function parseDiets(s) {
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return Array.isArray(v) ? v.filter((d) => d && Number(d.count) > 0).map((d) => ({ count: Number(d.count), category: DIET[d.category] ? d.category : 'andere', text: String(d.text || '') })) : [];
  } catch { return []; }
}

const dietLine = (d) => `${d.count}× ${[DIET[d.category], d.text].filter(Boolean).join(': ')}`;

function units({ activeOnly = false } = {}) {
  return db.all(`SELECT u.*, (SELECT COUNT(DISTINCT x.event_id) FROM event_externals x WHERE x.unit_id = u.id) AS used
    FROM external_units u ${activeOnly ? 'WHERE u.active = 1' : ''} ORDER BY u.sort, u.name COLLATE NOCASE`);
}

function parseIds(s) {
  try {
    const v = typeof s === 'string' ? JSON.parse(s) : s;
    return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
  } catch { return []; }
}

// Alle externen Abteilungen eines Einsatzes; shiftIds nur mit noch vorhandenen Schichten, leer = alle Schichten
function forEvent(eventId, shifts = null) {
  const list = shifts || db.all('SELECT id, name FROM shifts WHERE event_id = ? ORDER BY sort, starts_at, id', eventId);
  const known = new Set(list.map((s) => s.id));
  return db.all(`SELECT x.*, u.name AS unit_name FROM event_externals x JOIN external_units u ON u.id = x.unit_id
    WHERE x.event_id = ? ORDER BY u.sort, u.name COLLATE NOCASE, x.id`, eventId).map((x) => {
    const ids = parseIds(x.shift_ids).filter((id) => known.has(id));
    const dietList = parseDiets(x.diets).map((d) => ({ ...d, label: DIET[d.category] }));
    return {
      ...x, shiftIds: ids, allShifts: ids.length === 0, shiftNames: list.filter((s) => ids.includes(s.id)).map((s) => s.name),
      dietList, dietLabel: dietList.map(dietLine).join(', '),
    };
  });
}

// Zählt die externe Abteilung für diese Schicht?
const coversShift = (x, shiftId) => x.allShifts || x.shiftIds.includes(shiftId);

// Summe der externen Personen pro Schicht (für Ist/Soll)
function countsByShift(eventId, shifts) {
  const list = forEvent(eventId, shifts);
  return Object.fromEntries(shifts.map((s) => [s.id, list.filter((x) => coversShift(x, s.id)).reduce((a, x) => a + x.person_count, 0)]));
}

// Beitrag der externen Abteilungen zur Verpflegungs-Zusammenfassung: Map Bezeichnung -> Anzahl.
// Wer bei einer Abteilung mit Angaben nicht aufgeführt ist, isst ohne Einschränkung; Abteilungen ganz ohne Angaben = «extern (keine Angaben)»
function dietCounts(exts) {
  const counts = new Map();
  const add = (k, n) => { if (n > 0) counts.set(k, (counts.get(k) || 0) + n); };
  for (const x of exts) {
    if (!x.dietList.length) { add('extern (keine Angaben)', x.person_count); continue; }
    for (const d of x.dietList) add(DIET[d.category], d.count);
    add('ohne Einschränkung', x.person_count - x.dietList.reduce((a, d) => a + d.count, 0));
  }
  return counts;
}

// Text für die Schichtspalte
function shiftLabel(x, shifts) {
  if (shifts.length <= 1) return '';
  return x.allShifts ? 'alle Schichten' : x.shiftNames.join(' + ');
}

// Abteilung per Name finden oder neu anlegen (Gross-/Kleinschreibung egal)
function unitFor(input) {
  if (input.unit_id && !String(input.unit_name || '').trim()) {
    const u = db.one('SELECT * FROM external_units WHERE id = ?', Number(input.unit_id));
    if (u) return u;
  }
  const name = String(input.unit_name || '').trim().replace(/\s+/g, ' ');
  if (!name) throw new ValidationError(['Bitte die Abteilung angeben.']);
  if (name.length > 120) throw new ValidationError(['Der Name der Abteilung ist zu lang.']);
  const found = db.one('SELECT * FROM external_units WHERE lower(name) = lower(?) ORDER BY active DESC, id LIMIT 1', name);
  if (found) return found;
  const sort = (db.one('SELECT max(sort) AS m FROM external_units').m ?? 0) + 1;
  const id = Number(db.run('INSERT INTO external_units (name, sort) VALUES (?, ?)', name, sort).lastInsertRowid);
  return { id, name, created: true };
}

function clean(event, input) {
  const count = Number(String(input.person_count ?? '').trim());
  if (!Number.isInteger(count) || count < 1) throw new ValidationError(['Bitte die Anzahl Personen angeben (mindestens 1).']);
  if (count > MAX_COUNT) throw new ValidationError(['Die Anzahl Personen ist zu gross.']);
  const known = new Set(event.shifts.map((s) => s.id));
  let shiftIds = [...new Set([].concat(input.shift_ids || []).map(Number).filter((id) => known.has(id)))];
  if (known.size > 1 && !shiftIds.length) throw new ValidationError(['Bitte mindestens eine Schicht ankreuzen.']);
  if (shiftIds.length === known.size) shiftIds = []; // alle angekreuzt = ganzer Einsatz (gilt auch für später neue Schichten)
  const s = (v) => String(v ?? '').trim().slice(0, 500) || null;
  return { person_count: count, shift_ids: JSON.stringify(shiftIds), contact: s(input.contact), note: s(input.note), diets: JSON.stringify(cleanDiets(input, count)) };
}

// Zeilen aus dem Formular (diet_count[], diet_category[], diet_text[]); leere Zeilen fallen weg
function cleanDiets(input, personCount) {
  const arr = (v) => [].concat(v ?? []);
  const counts = arr(input.diet_count); const cats = arr(input.diet_category); const texts = arr(input.diet_text);
  const out = [];
  for (let i = 0; i < Math.max(counts.length, cats.length, texts.length); i++) {
    const rawCount = String(counts[i] ?? '').trim();
    const category = String(cats[i] ?? '').trim();
    const text = String(texts[i] ?? '').trim().replace(/\s+/g, ' ').slice(0, 200);
    if (!rawCount && !category && !text) continue;
    const count = rawCount ? Number(rawCount) : 1;
    if (!Number.isInteger(count) || count < 1) throw new ValidationError(['Bitte bei jeder Essenseinschränkung die Anzahl Personen angeben (mindestens 1).']);
    if (!category && !text) throw new ValidationError(['Bitte bei jeder Essenseinschränkung angeben, welche es ist.']);
    if (category && !DIET[category]) throw new ValidationError(['Unbekannte Art der Essenseinschränkung.']);
    const same = out.find((d) => d.category === (category || 'andere') && d.text.toLowerCase() === text.toLowerCase());
    if (same) same.count += count; else out.push({ count, category: category || 'andere', text });
  }
  if (out.length > MAX_DIET_LINES) throw new ValidationError([`Bitte höchstens ${MAX_DIET_LINES} Essenseinschränkungen erfassen.`]);
  const total = out.reduce((a, d) => a + d.count, 0);
  if (total > personCount) throw new ValidationError([`Es sind mehr Essenseinschränkungen (${total}) als Personen (${personCount}) erfasst.`]);
  return out;
}

const persons = (n) => `${n} ${n === 1 ? 'Person' : 'Personen'}`;

function add(event, input, user) {
  return db.tx(() => {
    const unit = unitFor(input);
    const data = clean(event, input);
    const now = nowIso();
    const id = Number(db.run(`INSERT INTO event_externals (event_id, unit_id, person_count, shift_ids, contact, note, diets, created_at, updated_at, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, event.id, unit.id, data.person_count, data.shift_ids, data.contact, data.note, data.diets, now, now, user.id).lastInsertRowid);
    audit.log({
      entity: 'external', entityId: id, eventId: event.id, action: 'create',
      summary: `${user.display_name} hat bei «${event.name}» die externe Abteilung «${unit.name}» mit ${persons(data.person_count)} hinzugefügt`,
      user,
    });
    if (unit.created) audit.log({ entity: 'settings', action: 'lists', summary: `${user.display_name} hat die externe Abteilung «${unit.name}» neu in die Liste aufgenommen`, user });
    live.notify('events', `event:${event.id}`);
    return id;
  });
}

function getRow(id) {
  return db.one('SELECT x.*, u.name AS unit_name FROM event_externals x JOIN external_units u ON u.id = x.unit_id WHERE x.id = ?', id);
}

function update(event, id, input, user) {
  return db.tx(() => {
    const before = getRow(id);
    if (!before || before.event_id !== event.id) throw new ValidationError(['Externe Abteilung nicht gefunden.']);
    const unit = unitFor(input);
    const data = clean(event, input);
    db.run('UPDATE event_externals SET unit_id = ?, person_count = ?, shift_ids = ?, contact = ?, note = ?, diets = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
      unit.id, data.person_count, data.shift_ids, data.contact, data.note, data.diets, nowIso(), user.id, id);
    const what = [];
    if (unit.id !== before.unit_id) what.push(`Abteilung ${before.unit_name} → ${unit.name}`);
    if (data.person_count !== before.person_count) what.push(`Anzahl ${before.person_count} → ${data.person_count}`);
    if (data.shift_ids !== before.shift_ids) what.push('Schichten');
    if (data.contact !== before.contact) what.push('Kontakt');
    if (data.note !== before.note) what.push('Bemerkung');
    if (data.diets !== JSON.stringify(parseDiets(before.diets))) what.push('Essenseinschränkungen');
    if (what.length) {
      audit.log({
        entity: 'external', entityId: id, eventId: event.id, action: 'update',
        summary: `${user.display_name} hat bei «${event.name}» die externe Abteilung «${unit.name}» geändert (${what.join(', ')})`,
        user,
      });
    }
    if (unit.created) audit.log({ entity: 'settings', action: 'lists', summary: `${user.display_name} hat die externe Abteilung «${unit.name}» neu in die Liste aufgenommen`, user });
    live.notify('events', `event:${event.id}`);
  });
}

function remove(event, id, user) {
  const before = getRow(id);
  if (!before || before.event_id !== event.id) return;
  db.run('DELETE FROM event_externals WHERE id = ?', id);
  audit.log({
    entity: 'external', entityId: id, eventId: event.id, action: 'delete',
    summary: `${user.display_name} hat bei «${event.name}» die externe Abteilung «${before.unit_name}» (${persons(before.person_count)}) entfernt`,
    user,
  });
  live.notify('events', `event:${event.id}`);
}

// Eine Schicht wird gelöscht: aus den Auswahlen entfernen; bleibt keine übrig, gilt die Abteilung für alle Schichten
function dropShift(eventId, shiftId) {
  for (const x of db.all('SELECT id, shift_ids FROM event_externals WHERE event_id = ?', eventId)) {
    const ids = parseIds(x.shift_ids);
    if (ids.includes(shiftId)) db.run('UPDATE event_externals SET shift_ids = ? WHERE id = ?', JSON.stringify(ids.filter((i) => i !== shiftId)), x.id);
  }
}

module.exports = { units, forEvent, countsByShift, coversShift, shiftLabel, dietCounts, add, update, remove, dropShift, persons };
