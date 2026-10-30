'use strict';
// Einmaliger Stammdaten-Import aus einem ClubDesk-Export (Excel/CSV) mit Vorschau, Dublettenprüfung und Fehlerliste
const crypto = require('node:crypto');
const db = require('../db');
const persons = require('./persons');
const audit = require('./audit');
const { readCsv } = require('../lib/csv');
const { readXlsx, excelDate } = require('../lib/xlsx');
const { nameKey, normalizeName } = require('../lib/normalize');
const { parseDateInput, nowIso } = require('../lib/dates');

const FIELDS = {
  first_name: { label: 'Vorname', synonyms: ['vorname', 'first name', 'firstname', 'rufname'] },
  last_name: { label: 'Nachname', synonyms: ['nachname', 'name', 'familienname', 'last name', 'lastname'] },
  birth_date: { label: 'Geburtsdatum', synonyms: ['geburtsdatum', 'geburtstag', 'birthday', 'geb datum'] },
  birth_year: { label: 'Jahrgang', synonyms: ['jahrgang', 'geburtsjahr'] },
  mobile: { label: 'Mobilnummer', synonyms: ['mobil', 'mobile', 'handy', 'natel', 'telefon mobil', 'mobiltelefon', 'tel mobil'] },
  email: { label: 'E-Mail', synonyms: ['e mail', 'email', 'mail', 'e mail adresse', 'e mail 1'] },
  rank: { label: 'Rang', synonyms: ['rang', 'grad', 'dienstgrad'] },
  teams: { label: 'Mannschaft / Kader', synonyms: ['mannschaft', 'kader', 'gruppe', 'gruppen', 'team', 'zug'] },
  status: { label: 'Status', synonyms: ['status'] },
  internal_note: { label: 'Interne Bemerkung', synonyms: ['bemerkung', 'bemerkungen', 'notiz', 'kommentar'] },
};

const previews = new Map(); // Vorschau zwischenspeichern (30 Minuten)

function parseFile(buffer, filename) {
  const isXlsx = /\.xlsx$/i.test(filename) || buffer.subarray(0, 2).toString() === 'PK';
  const rows = isXlsx ? readXlsx(buffer) : readCsv(buffer);
  if (rows.length < 2) throw new Error('Die Datei enthält keine Datenzeilen.');
  return { headers: rows[0].map((h) => String(h).trim()), rows: rows.slice(1) };
}

function guessMapping(headers) {
  const mapping = {};
  headers.forEach((h, i) => {
    const n = normalizeName(h);
    for (const [key, def] of Object.entries(FIELDS)) {
      if (mapping[key] === undefined && def.synonyms.includes(n)) mapping[key] = i;
    }
  });
  return mapping;
}

function toDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 1000 && Number(s) < 80000) return excelDate(s);
  return parseDateInput(s) || parseDateInput(s.slice(0, 10));
}

function lookupRank(value, ranks) {
  const n = normalizeName(value);
  if (!n) return null;
  return ranks.find((r) => normalizeName(r.name) === n || normalizeName(r.short) === n) || null;
}

function analyse(parsed, mapping) {
  const ranks = db.all('SELECT * FROM ranks');
  const teams = db.all('SELECT * FROM teams');
  const seen = new Map();
  const existing = new Map(db.all('SELECT id, norm_key, birth_date, birth_year FROM persons').map((p) => [p.norm_key, p]));
  const col = (row, key) => (mapping[key] === undefined || mapping[key] === '' ? '' : String(row[Number(mapping[key])] ?? '').trim());
  const newRanks = new Set();
  const newTeams = new Set();
  const out = parsed.rows.map((row, idx) => {
    const errors = [];
    const warnings = [];
    const data = {
      first_name: col(row, 'first_name'),
      last_name: col(row, 'last_name'),
      birth_date: null,
      birth_year: null,
      mobile: col(row, 'mobile') || null,
      email: col(row, 'email').toLowerCase() || null,
      internal_note: col(row, 'internal_note') || null,
      status: 'aktiv',
    };
    if (!data.first_name) errors.push('Vorname fehlt');
    if (!data.last_name) errors.push('Nachname fehlt');
    const bd = col(row, 'birth_date');
    if (bd) {
      data.birth_date = toDate(bd);
      if (!data.birth_date) errors.push(`Geburtsdatum «${bd}» nicht lesbar`);
    }
    const by = col(row, 'birth_year');
    if (by && !data.birth_date) {
      data.birth_year = Number(by);
      if (!(data.birth_year > 1900 && data.birth_year < 2100)) errors.push(`Jahrgang «${by}» ungültig`);
    }
    if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.push(`E-Mail «${data.email}» ungültig`);
    const st = normalizeName(col(row, 'status'));
    if (st) data.status = ['inaktiv', 'ausgetreten'].includes(st) ? st : 'aktiv';
    const rankRaw = col(row, 'rank');
    let rank = null;
    if (rankRaw) {
      rank = lookupRank(rankRaw, ranks);
      if (!rank) { newRanks.add(rankRaw); warnings.push(`Rang «${rankRaw}» wird neu angelegt`); }
    }
    const teamNames = col(row, 'teams').split(/[,;/]/).map((t) => t.trim()).filter(Boolean);
    for (const t of teamNames) {
      if (!teams.some((x) => normalizeName(x.name) === normalizeName(t))) { newTeams.add(t); warnings.push(`Mannschaft «${t}» wird neu angelegt`); }
    }
    const key = data.first_name && data.last_name ? nameKey(data.first_name, data.last_name) : null;
    let duplicate = null;
    if (key && existing.has(key)) {
      const ex = existing.get(key);
      const sameBirth = (ex.birth_date && ex.birth_date === data.birth_date) || (ex.birth_year && ex.birth_year === (data.birth_year || Number(data.birth_date?.slice(0, 4))));
      duplicate = { type: 'stammdaten', personId: ex.id, text: sameBirth ? 'existiert bereits (gleicher Jahrgang)' : 'gleicher Name existiert bereits' };
    } else if (key && seen.has(key)) {
      duplicate = { type: 'datei', text: `doppelt in der Datei (Zeile ${seen.get(key) + 2})` };
    }
    if (key && !seen.has(key)) seen.set(key, idx);
    return {
      line: idx + 2, data, rankRaw, rankId: rank?.id || null, teamNames, errors, warnings, duplicate,
      action: errors.length ? 'skip' : duplicate ? 'skip' : 'create',
    };
  });
  return { rows: out, newRanks: [...newRanks], newTeams: [...newTeams] };
}

function createPreview(buffer, filename, mapping = null) {
  const parsed = parseFile(buffer, filename);
  const map = mapping || guessMapping(parsed.headers);
  const id = crypto.randomBytes(12).toString('hex');
  previews.set(id, { parsed, filename, created: Date.now() });
  for (const [k, v] of previews) if (Date.now() - v.created > 30 * 60000) previews.delete(k);
  return { id, headers: parsed.headers, mapping: map, ...analyse(parsed, map) };
}

function getPreview(id, mapping) {
  const p = previews.get(id);
  if (!p) return null;
  return { id, headers: p.parsed.headers, mapping, filename: p.filename, ...analyse(p.parsed, mapping) };
}

function commit(id, mapping, actions, user) {
  const p = previews.get(id);
  if (!p) throw new Error('Die Vorschau ist abgelaufen. Bitte die Datei erneut hochladen.');
  const result = analyse(p.parsed, mapping);
  const stats = { created: 0, updated: 0, skipped: 0 };
  db.tx(() => {
    const rankId = (raw) => {
      if (!raw) return null;
      const found = lookupRank(raw, db.all('SELECT * FROM ranks'));
      if (found) return found.id;
      const sort = (db.one('SELECT max(sort) AS m FROM ranks').m || 0) + 1;
      return Number(db.run('INSERT INTO ranks (name, short, sort) VALUES (?, ?, ?)', raw, raw, sort).lastInsertRowid);
    };
    const teamId = (name) => {
      const found = db.all('SELECT * FROM teams').find((t) => normalizeName(t.name) === normalizeName(name));
      if (found) return found.id;
      const sort = (db.one('SELECT max(sort) AS m FROM teams').m || 0) + 1;
      return Number(db.run('INSERT INTO teams (name, sort) VALUES (?, ?)', name, sort).lastInsertRowid);
    };
    for (const row of result.rows) {
      const action = row.errors.length ? 'skip' : (actions[row.line] || row.action);
      if (action === 'skip') { stats.skipped++; continue; }
      const input = { ...row.data, rank_id: rankId(row.rankRaw), team_ids: row.teamNames.map(teamId) };
      if (action === 'update' && row.duplicate?.personId) {
        const current = persons.get(row.duplicate.personId);
        // Nur leere Felder ergänzen, nichts überschreiben
        const merged = { ...current, team_ids: current.team_ids.length ? current.team_ids : input.team_ids };
        for (const k of ['birth_date', 'birth_year', 'mobile', 'email', 'rank_id', 'internal_note']) if (!merged[k] && input[k]) merged[k] = input[k];
        persons.update(current.id, merged, current.version, user);
        stats.updated++;
      } else {
        persons.create(input, user);
        stats.created++;
      }
    }
  });
  previews.delete(id);
  audit.log({ entity: 'person', action: 'import', summary: `${user.display_name} hat ${stats.created} Personen importiert (${stats.updated} ergänzt, ${stats.skipped} übersprungen) aus «${p.filename}»`, user });
  return stats;
}

module.exports = { FIELDS, createPreview, getPreview, commit, guessMapping };
