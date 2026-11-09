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

// Formularfelder «<prefix><id>» (z. B. fn_target_3 oder fn_target_<schicht>_3) -> { id: Anzahl } (nur > 0).
// null, wenn das Formular gar keine solchen Felder enthält.
function readTargets(input, prefix = 'fn_target_') {
  const out = {};
  let seen = false;
  for (const f of all()) {
    const key = `${prefix}${f.id}`;
    if (!input || !(key in input)) continue;
    seen = true;
    const raw = String(input[key] ?? '').trim();
    if (raw === '') continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new ValidationError([`Soll für «${f.name}»: bitte eine ganze Zahl angeben.`]);
    if (n > MAX_TARGET) throw new ValidationError([`Soll für «${f.name}» ist zu gross.`]);
    if (n > 0) out[f.id] = n;
  }
  return seen ? out : null;
}

const total = (targets) => Object.values(targets || {}).reduce((a, n) => a + n, 0);

function tone(ist, soll) {
  if (!soll) return 'gray';
  if (ist > soll) return 'orange';
  if (ist === soll) return 'green';
  if (ist / soll >= 0.5) return 'yellow';
  return 'red';
}

/**
 * Ist/Soll pro Schicht und Funktion. Gezählt werden Anmeldungen, die zur Besetzung zählen (Neu, Rückfrage, Bestätigt)
 * und dieser Schicht zugeteilt sind, sowie externe Abteilungen dieser Schicht mit ihrer Anzahl Personen.
 * Die Funktion einer Person gilt für den ganzen Einsatz. Optional nur eine Schicht (shiftId).
 */
function summary(event, { shiftId = null } = {}) {
  const list = all();
  const map = new Map(list.map((f) => [f.id, f]));
  const def = defaultFn(list);
  const allShifts = event.shifts || db.all('SELECT * FROM shifts WHERE event_id = ? ORDER BY sort, starts_at, id', event.id);
  const multi = allShifts.length > 1;
  const shifts = shiftId ? allShifts.filter((s) => s.id === Number(shiftId)) : allShifts;
  const ph = REG_COUNTING.map(() => '?').join(',');
  const regs = db.all(`SELECT g.id, g.person_id, g.function_id, a.shift_id, p.first_name, p.last_name, r.short AS rank_short
    FROM registrations g JOIN shift_assignments a ON a.registration_id = g.id JOIN persons p ON p.id = g.person_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE g.event_id = ? AND g.status IN (${ph}) ORDER BY r.sort IS NULL, r.sort DESC, p.last_name COLLATE NOCASE, p.first_name COLLATE NOCASE`, event.id, ...REG_COUNTING);
  const exts = require('./externals').forEvent(event.id, allShifts);
  const out = shifts.map((sh) => {
    const targets = parseTargets(sh.function_targets);
    const inShift = regs.filter((g) => g.shift_id === sh.id);
    const units = exts.filter((x) => x.allShifts || x.shiftIds.includes(sh.id));
    const rows = list.map((f, pos) => {
      const people = inShift.filter((g) => of(g.function_id, map, def).id === f.id);
      const us = units.filter((x) => x.func.id === f.id);
      const extern = us.reduce((a, x) => a + x.person_count, 0);
      const ist = people.length + extern;
      const soll = targets[f.id] || null;
      return {
        ...f, pos, soll, ist, intern: people.length, extern, people, units: us, tone: tone(ist, soll),
        missing: soll ? Math.max(0, soll - ist) : null, over: soll && ist > soll ? ist - soll : 0,
      };
    }).filter((r) => r.soll || r.ist || (!multi && (r.active || r.is_default)));
    const totalSoll = total(targets);
    return { id: sh.id, name: sh.name, starts_at: sh.starts_at, ends_at: sh.ends_at, rows, totalSoll, totalIst: rows.reduce((a, r) => a + r.ist, 0), hasTargets: totalSoll > 0 };
  });
  // «usesFunctions»: mehr als nur Einsatzteilnehmer – erst dann lohnen sich Spalte und Zeile «Funktion» in Listen
  const res = {
    shifts: out, multi: multi && !shiftId, hasTargets: out.some((x) => x.hasTargets), anyAssigned: out.some((x) => x.rows.some((r) => !r.is_default && r.ist)),
    usesFunctions: out.some((x) => x.rows.some((r) => !r.is_default && (r.soll || r.ist))), def,
  };
  res.grid = grid(res);
  return res;
}

// Kurztext «EL 1/1 · SC 1/2 · …» (bei mehreren Schichten mit Schichtnamen) für PDF, Exporte und Listen
const oneLine = (x) => x.rows.filter((r) => r.soll || r.ist).map((r) => `${r.short} ${r.ist}/${r.soll ?? '–'}`).join(' · ') || '–';
function line(sum) {
  return sum.shifts.map((x) => (sum.multi ? `${x.name}: ${oneLine(x)}` : oneLine(x))).join('  |  ');
}

// Wie line(), aber eine Zeile pro Schicht (PDF): bleibt bei vielen Schichten lesbar
function lines(sum) {
  return sum.shifts.map((x) => (sum.multi ? `${x.name}: ${oneLine(x)}` : oneLine(x)));
}

/**
 * Raster für die Ansicht «Funktionen Ist/Soll»: eine Spalte pro Schicht, eine Zeile pro Funktion.
 * Funktionen ohne Soll und ohne Ist in allen Schichten fallen weg.
 */
function grid(sum) {
  const fns = new Map();
  for (const sh of sum.shifts) for (const r of sh.rows) if ((r.soll || r.ist) && !fns.has(r.id)) fns.set(r.id, r);
  const order = [...fns.values()].sort((a, b) => a.pos - b.pos);
  const rows = order.map((f) => ({
    id: f.id, short: f.short, name: f.name, is_default: f.is_default,
    cells: sum.shifts.map((sh) => sh.rows.find((r) => r.id === f.id) || null),
  }));
  return { shifts: sum.shifts, rows, showTotal: sum.hasTargets && rows.length > 1 };
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

module.exports = { all, byId, defaultFn, of, parseTargets, readTargets, total, summary, line, lines, grid, assign, bulkAssign, tone, INACTIVE_REG };
