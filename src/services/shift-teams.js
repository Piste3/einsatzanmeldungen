'use strict';
// Vorgesehene Mannschaften pro Schicht (z. B. eine Schicht nur für Kader).
// Leer = alle Mannschaften. Die Einstellung ist ein Hinweis: Anmelden und Einteilen bleiben für alle möglich,
// die Rückmeldungen zeigen nicht vorgesehene Personen mit einem eigenen Symbol.
const db = require('../db');

// JSON oder Liste -> sortierte Liste eindeutiger Mannschafts-IDs
function parse(value) {
  let list = value;
  if (typeof value === 'string') {
    try { list = JSON.parse(value || '[]'); } catch { list = []; }
  }
  return [...new Set([].concat(list || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b);
}

// Mannschaften pro Person: Map(personId -> Set(teamId)); ohne Liste = alle Personen
function personTeams(personIds = null) {
  const rows = personIds
    ? (personIds.length ? db.all(`SELECT person_id, team_id FROM person_teams WHERE person_id IN (${personIds.map(() => '?').join(',')})`, ...personIds) : [])
    : db.all('SELECT person_id, team_id FROM person_teams');
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.person_id)) map.set(r.person_id, new Set());
    map.get(r.person_id).add(r.team_id);
  }
  return map;
}

// Ist eine Person mit diesen Mannschaften für die Schicht vorgesehen?
function allows(teamIds, personTeamSet) {
  if (!teamIds || !teamIds.length) return true;
  return Boolean(personTeamSet) && teamIds.some((t) => personTeamSet.has(t));
}

// Namen der Mannschaften, z. B. «Kader, Zug 1»; leer = «alle»
function label(teamIds, teams = db.all('SELECT id, name, sort FROM teams ORDER BY sort, name')) {
  if (!teamIds || !teamIds.length) return '';
  return teams.filter((t) => teamIds.includes(t.id)).map((t) => t.name).join(', ');
}

module.exports = { parse, personTeams, allows, label };
