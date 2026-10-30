'use strict';
// Automatische Zuordnung (Konzept 7): nur Eindeutiges wird verknüpft, alles andere landet in den Klärungen.
const db = require('../db');
const { normalizeName, nameKey } = require('../lib/normalize');

const PERSON_SELECT = `SELECT p.*, r.short AS rank_short,
  (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams
  FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id`;

/**
 * Ergebnis:
 *  { status: 'match', person, type: 'auto'|'alias' }
 *  { status: 'ambiguous', candidates, info }
 *  { status: 'unknown', candidates, info }
 */
function match(firstName, lastName) {
  const key = nameKey(firstName, lastName);
  const swapped = nameKey(lastName, firstName);
  const keys = key === swapped ? [key] : [key, swapped];
  const ph = keys.map(() => '?').join(',');

  const direct = db.all(`${PERSON_SELECT} WHERE p.status = 'aktiv' AND p.norm_key IN (${ph})`, ...keys);
  const viaAlias = db.all(
    `${PERSON_SELECT} WHERE p.status = 'aktiv' AND p.id IN (SELECT person_id FROM person_aliases WHERE norm_key IN (${ph}))`, ...keys,
  );
  const byId = new Map();
  for (const p of direct) byId.set(p.id, { ...p, via: 'auto' });
  for (const p of viaAlias) if (!byId.has(p.id)) byId.set(p.id, { ...p, via: 'alias' });
  const found = [...byId.values()];

  if (found.length === 1) return { status: 'match', person: found[0], type: found[0].via };
  if (found.length > 1) {
    return { status: 'ambiguous', candidates: found, info: `${found.length} Personen mit diesem Namen` };
  }
  return { status: 'unknown', candidates: suggest(firstName, lastName), info: 'keine passende Person' };
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Vorschläge für die Klärungsliste: gleicher Nachname, gleicher Vorname oder ähnliche Schreibweise
function suggest(firstName, lastName, limit = 8) {
  const f = normalizeName(firstName);
  const l = normalizeName(lastName);
  const people = db.all(`${PERSON_SELECT} WHERE p.status = 'aktiv'`);
  const scored = [];
  for (const p of people) {
    const [pf, pl] = p.norm_key.split('|');
    let score = 0;
    if (pl === l || pl === f) score += 50;
    if (pf === f || pf === l) score += 30;
    if (pf && f && (pf.startsWith(f.slice(0, 3)) || f.startsWith(pf.slice(0, 3)))) score += 10;
    const dist = Math.min(levenshtein(`${f} ${l}`, `${pf} ${pl}`), levenshtein(`${l} ${f}`, `${pf} ${pl}`));
    if (dist <= 3) score += 40 - dist * 5;
    if (score >= 30) scored.push({ ...p, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.last_name.localeCompare(b.last_name)).slice(0, limit);
}

module.exports = { match, suggest, levenshtein };
