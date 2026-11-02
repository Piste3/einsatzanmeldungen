'use strict';
// Funktionen an einem Einsatz: Einsatzleiter (EL), Sektorchef (SC), Busfahrer (BF), Einsatzteilnehmer (TN) …
// Pro Einsatz wird festgelegt, wie viele es von jeder Funktion braucht (Soll); jeder Anmeldung kann eine Funktion
// zugewiesen werden. Ohne Zuweisung zählt eine Anmeldung als Standardfunktion (Einsatzteilnehmer).
// Nicht zu verwechseln mit der Benutzer-Rolle «Einsatzleiter» (Login mit Lesezugriff auf freigegebene Einsätze).
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const { nowIso } = require('../lib/dates');
const { REG_COUNTING } = require('../lib/labels');
const { ValidationError } = require('./errors');

const MAX_TARGET = 9999;
const INACTIVE_REG = ['zurueckgezogen', 'abgesagt', 'ungueltig'];

function all({ activeOnly = false } = {}) {
  return db.all(`SELECT f.*, (SELECT COUNT(*) FROM registrations g WHERE g.function_id = f.id)
      + (SELECT COUNT(*) FROM event_externals x WHERE x.function_id = f.id) AS used
    FROM functions f ${activeOnly ? 'WHERE f.active = 1 OR f.is_default = 1' : ''} ORDER BY f.sort, f.name COLLATE NOCASE`);
}

function byId() {
  return new Map(all().map((f) => [f.id, f]));
}

function defaultFn(list = all()) {
  return list.find((f) => f.is_default) || list.at(-1) || { id: null, name: 'Einsatzteilnehmer', short: 'TN', sort: 999, is_default: 1 };
}

// Funktion einer Anmeldung / externen Abteilung (NULL = Standard)
function of(functionId, map = byId(), def = defaultFn([...map.values()])) {
  return (functionId && map.get(functionId)) || def;
}

// Soll pro Funktion aus dem gespeicherten JSON: { id: Anzahl }
function parseTargets(s) {
  let v = s;
  try { v = typeof s === 'string' ? JSON.parse(s) : s; } catch { v = {}; }
  const out = {};
  for (const [k, n] of Object.entries(v && typeof v === 'object' ? v : {})) {
    const num = Number(n);
    if (Number(k) > 0 && Number.isInteger(num) && num > 0) out[Number(k)] = num;
  }
  return out;
}

// Formularfelder «fn_target_<id>» -> JSON (nur Werte > 0, nur bekannte Funktionen, sortiert nach Funktion)
function cleanTargets(input) {
  const out = {};
  for (const f of all()) {
    const raw = String(input?.[`fn_target_${f.id}`] ?? '').trim();
    if (raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new ValidationError([`Soll für «${f.name}»: bitte eine ganze Zahl angeben.`]);
    if (n > MAX_TARGET) throw new ValidationError([`Soll für «${f.name}» ist zu gross.`]);
    if (n > 0) out[f.id] = n;
  }
  return JSON.stringify(out);
}

function tone(ist, soll) {
  if (!soll) return 'gray';
  if (ist > soll) return 'orange';
  if (ist === soll) return 'green';
  if (ist / soll >= 0.5) return 'yellow';
  return 'red';
}

/**
 * Ist/Soll pro Funktion für einen Einsatz. Zählt alle Anmeldungen, die zur Besetzung zählen (neu, Rückfrage, bestätigt),
 * und externe Abteilungen mit ihrer Anzahl Personen. Angezeigt werden aktive Funktionen sowie alle mit Soll oder Ist.
 */
function summary(event) {
  const list = all();
  const map = new Map(list.map((f) => [f.id, f]));
  const def = defaultFn(list);
  const targets = parseTargets(event.function_targets);
  const ph = REG_COUNTING.map(() => '?').join(',');
  const regs = db.all(`SELECT g.id, g.person_id, g.function_id, p.first_name, p.last_name, r.short AS rank_short
    FROM registrations g JOIN persons p ON p.id = g.person_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE g.event_id = ? AND g.status IN (${ph}) ORDER BY r.sort IS NULL, r.sort DESC, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`, event.id, ...REG_COUNTING);
  const exts = db.all(`SELECT x.id, x.person_count, x.function_id, u.name AS unit_name FROM event_externals x JOIN external_units u ON u.id = x.unit_id
    WHERE x.event_id = ? ORDER BY u.sort, u.name COLLATE NOCASE`, event.id);
  const rows = list.map((f) => {
    const people = regs.filter((g) => of(g.function_id, map, def).id === f.id);
    const units = exts.filter((x) => of(x.function_id, map, def).id === f.id);
    const extern = units.reduce((a, x) => a + x.person_count, 0);
    const ist = people.length + extern;
    const soll = targets[f.id] || null;
    return {
      ...f, soll, ist, intern: people.length, extern, people, units, tone: tone(ist, soll),
      missing: soll ? Math.max(0, soll - ist) : null, over: soll && ist > soll ? ist - soll : 0,
    };
  }).filter((r) => r.active || r.is_default || r.soll || r.ist);
  const totalSoll = rows.reduce((a, r) => a + (r.soll || 0), 0);
  const totalIst = rows.reduce((a, r) => a + r.ist, 0);
  return { rows, totalSoll, totalIst, hasTargets: totalSoll > 0, def };
}

// Kurztext «EL 1/1 · SC 1/2 · …» für PDF, Exporte und Listen (nur Funktionen mit Soll oder Ist)
function line(sum) {
  return sum.rows.filter((r) => r.soll || r.ist).map((r) => `${r.short} ${r.ist}/${r.soll ?? '–'}`).join(' · ');
}

// Funktion einer Anmeldung setzen (Standardfunktion wird als NULL gespeichert)
function assign(regId, functionId, user, { silent = false } = {}) {
  const reg = db.one(`SELECT g.*, e.name AS event_name, e.status AS event_status, p.first_name, p.last_name
    FROM registrations g JOIN events e ON e.id = g.event_id LEFT JOIN persons p ON p.id = g.person_id WHERE g.id = ?`, Number(regId));
  if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
  if (!reg.person_id) throw new ValidationError(['Bitte die Anmeldung zuerst einer Person zuordnen (Klärungen).']);
  if (reg.event_status === 'abgeschlossen' && user.role !== 'admin') throw new ValidationError(['Der Einsatz ist abgeschlossen.']);
  if (INACTIVE_REG.includes(reg.status)) throw new ValidationError([`${reg.first_name} ${reg.last_name} ist abgemeldet – eine Funktion gibt es nur für Angemeldete.`]);
  const map = byId();
  const def = defaultFn([...map.values()]);
  const target = functionId ? map.get(Number(functionId)) : def;
  if (!target) throw new ValidationError(['Unbekannte Funktion.']);
  const before = of(reg.function_id, map, def);
  if (before.id === target.id) return { changed: false };
  db.run('UPDATE registrations SET function_id = ?, version = version + 1, updated_at = ?, updated_by = ? WHERE id = ?',
    target.is_default ? null : target.id, nowIso(), user.id, reg.id);
  if (!silent) {
    audit.log({
      entity: 'registration', entityId: reg.id, eventId: reg.event_id, personId: reg.person_id, action: 'function',
      summary: `${user.display_name} hat ${reg.first_name} ${reg.last_name} die Funktion ${target.name} (${target.short}) zugewiesen · ${reg.event_name}`,
      details: { funktion: { alt: before.short, neu: target.short } }, user,
    });
  }
  live.notify(`event:${reg.event_id}`);
  return { changed: true, reg, target, before };
}

function bulkAssign(ids, functionId, user) {
  let changed = 0;
  const errors = [];
  for (const id of ids) {
    try {
      if (assign(Number(id), functionId, user).changed) changed++;
    } catch (err) {
      errors.push(err.message);
    }
  }
  return { changed, errors };
}

module.exports = { all, byId, defaultFn, of, parseTargets, cleanTargets, summary, line, assign, bulkAssign, tone, INACTIVE_REG };
