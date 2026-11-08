'use strict';
// Filter pro Benutzer merken: Die App speichert die zuletzt gewählten Filter einer Seite auf dem Server.
// Beim nächsten Besuch (auch auf einem anderen Gerät) setzt sie die Filter wieder ein.
// Das Namen-Suchfeld (q) speichert sie nie. «?filter=zuruecksetzen» löscht die gespeicherten Filter der Seite.
const db = require('../db');
const { nowIso } = require('../lib/dates');

// keys = gespeicherte Filter. full = Feld, das das Filterformular immer mitschickt.
// Steht es in der Adresse, ist die Adresse der ganze Stand (fehlendes Häkchen = aus) und die App speichert ihn.
// Fehlt es (z. B. Link aus dem Cockpit), ergänzt die App nur die fehlenden Filter aus dem gespeicherten Stand.
// plainExports: Direkte PDF-/Excel-Links von anderen Seiten (z. B. Knopf «Teilnehmerliste») liefern immer den Standard.
const PAGES = [
  { page: 'rueckmeldungen', re: /^\/rueckmeldungen$/, keys: ['period', 'team', 'only', 'sort', 'drafts', 'view'], full: 'period' },
  { page: 'einsaetze', re: /^\/einsaetze$/, keys: ['status', 'from', 'to'], full: 'status' },
  { page: 'personen', re: /^\/personen$/, keys: ['team', 'rank', 'status', 'sort'], full: 'status' },
  { page: 'anmeldungen', re: /^\/einsaetze\/\d+\/anmeldungen$/, keys: ['sort'], full: 'sort' },
  { page: 'anfragen', re: /^\/einsaetze\/\d+\/anfragen$/, keys: ['team', 'sort'], full: 'sort' },
  { page: 'listen', re: /^\/einsaetze\/\d+\/(teilnehmerliste|verpflegungsliste)$/, keys: ['umfang', 'sort'], full: 'umfang', plainExports: true },
  { page: 'handy-anfragen', re: /^\/handy\/einsatz\/\d+$/, keys: ['team'], full: 'team' },
];

const pageFor = (path) => PAGES.find((p) => p.re.test(path)) || null;

function get(userId, page) {
  const row = userId ? db.one('SELECT data FROM user_filters WHERE user_id = ? AND page = ?', userId, page) : null;
  if (!row) return null;
  try { const d = JSON.parse(row.data); return d && typeof d === 'object' ? d : null; } catch { return null; }
}

function set(userId, page, data) {
  if (!userId) return;
  const json = JSON.stringify(data);
  const old = db.one('SELECT data FROM user_filters WHERE user_id = ? AND page = ?', userId, page);
  if (old && old.data === json) return;
  db.run(`INSERT INTO user_filters (user_id, page, data, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, page) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`, userId, page, json, nowIso());
}

function clear(userId, page) {
  if (userId) db.run('DELETE FROM user_filters WHERE user_id = ? AND page = ?', userId, page);
}

const clean = (v) => (typeof v === 'string' && v.length <= 100 ? v : null);

// Middleware für alle angemeldeten GET-Seiten
function middleware(req, res, next) {
  if (req.method !== 'GET' || !req.user) return next();
  const p = pageFor(req.path);
  if (!p) return next();
  if (req.query.filter === 'zuruecksetzen') {
    clear(req.user.id, p.page);
    return res.redirect(req.path);
  }
  if (req.query[p.full] !== undefined) {
    // Ganzer Stand: speichern (Exporte nicht, die übernehmen nur den Stand der Seite)
    if (!req.query.format) {
      const data = {};
      for (const k of p.keys) { const v = clean(req.query[k]); if (v !== null) data[k] = v; }
      set(req.user.id, p.page, data);
    }
    return next();
  }
  if (p.plainExports && req.query.format) return next();
  const saved = get(req.user.id, p.page);
  if (saved) for (const k of p.keys) if (req.query[k] === undefined && clean(saved[k]) !== null) req.query[k] = saved[k];
  next();
}

module.exports = { PAGES, pageFor, get, set, clear, middleware };
