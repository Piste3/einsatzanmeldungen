'use strict';
// Einschränkungen pro Schicht: vorgesehene Mannschaften (z. B. nur Kader) und Mindestalter (16+ / 18+).
// Leer = alle. Die Einstellung ist ein Hinweis: Anmelden und Einteilen bleiben für alle möglich,
// die Rückmeldungen zeigen nicht vorgesehene Personen mit einem eigenen Symbol.
const db = require('../db');

const MIN_AGES = [16, 18];

// JSON oder Liste -> sortierte Liste eindeutiger Mannschafts-IDs
function parse(value) {
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value || '[]'); } catch { list = []; }
  }
  return [...new Set([].concat(list || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

// Formular -> Mindestalter (16, 18) oder null
function parseMinAge(value) {
  const n = Number(value);
  return MIN_AGES.includes(n) ? n : null;
}

// Angaben pro Person für die Prüfung: Map(personId -> { teams: Set, birth_date, birth_year })
function personInfo(personIds) {
  const ids = [...new Set(personIds.filter(Boolean))];
  const map = new Map();
  if (!ids.length) return map;
  const ph = ids.map(() => '?').join(',');
  for (const p of db.all(`SELECT id, birth_date, birth_year FROM persons WHERE id IN (${ph})`, ...ids)) {
    map.set(p.id, { teams: new Set(), birth_date: p.birth_date, birth_year: p.birth_year });
  }
  for (const r of db.all(`SELECT person_id, team_id FROM person_teams WHERE person_id IN (${ph})`, ...ids)) map.get(r.person_id)?.teams.add(r.team_id);
  return map;
}

// Alter am Tag «day» (YYYY-MM-DD): aus dem Geburtsdatum, sonst aus dem Jahrgang; unbekannt = null
function ageOn(person, day) {
  if (!person || !day) return null;
  const y = Number(day.slice(0, 4));
  if (/^\d{4}-\d{2}-\d{2}$/.test(person.birth_date || '')) {
    const b = person.birth_date;
    return y - Number(b.slice(0, 4)) - (day.slice(5) < b.slice(5) ? 1 : 0);
  }
  if (person.birth_year) return y - Number(person.birth_year);
  return null;
}

// Tag einer Schicht für die Altersprüfung
function shiftDay(shift, event) {
  return shift?.starts_at?.slice(0, 10) || event?.date || event?.date_from || null;
}

// Hat die Schicht eine Einschränkung?
function restricted(shift) {
  return Boolean(shift && ((shift.teams && shift.teams.length) || shift.min_age));
}

// Ist die Person für die Schicht vorgesehen? Unbekanntes Alter zählt als vorgesehen.
function allows(shift, person, day) {
  if (!restricted(shift)) return true;
  if (shift.teams && shift.teams.length && !(person && shift.teams.some((t) => person.teams.has(t)))) return false;
  if (shift.min_age) {
    const age = ageOn(person, day);
    if (age !== null && age < shift.min_age) return false;
  }
  return true;
}

// Namen der Mannschaften, z. B. «Kader, Zug 1»; leer = alle
function label(teamIds, teams = db.all('SELECT id, name, sort FROM teams ORDER BY sort, name')) {
  if (!teamIds || !teamIds.length) return '';
  return teams.filter((t) => teamIds.includes(t.id)).map((t) => t.name).join(', ');
}

// Text der Einschränkung, z. B. «Kader · 18+»; leer = keine
function ruleText(shift, teams) {
  if (!restricted(shift)) return '';
  return [label(shift.teams || [], teams), shift.min_age ? `${shift.min_age}+` : ''].filter(Boolean).join(' · ');
}

module.exports = { MIN_AGES, parse, parseMinAge, personInfo, ageOn, shiftDay, restricted, allows, label, ruleText };
