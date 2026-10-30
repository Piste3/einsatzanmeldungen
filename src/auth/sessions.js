'use strict';
// Serverseitige Sitzungen. Der Browser erhält nur ein zufälliges Token (Cookie),
// in der Datenbank liegt dessen SHA-256-Hash. Unabhängig vom Anmeldeverfahren (lokal oder SSO).
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const { nowIso } = require('../lib/dates');

const COOKIE = 'kkb_session';

const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function create(userId, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionHours * 3600 * 1000);
  db.run(
    `INSERT INTO sessions (id, user_id, csrf_token, created_at, last_seen_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    hash(token), userId, crypto.randomBytes(24).toString('base64url'), now.toISOString(), now.toISOString(),
    expires.toISOString(), req?.ip || null, String(req?.headers?.['user-agent'] || '').slice(0, 200),
  );
  return { token, expires };
}

// Sitzung zum Token laden; abgelaufene oder inaktive Sitzungen werden entfernt
function lookup(token, { touch = true } = {}) {
  if (!token) return null;
  const id = hash(token);
  const s = db.one('SELECT * FROM sessions WHERE id = ?', id);
  if (!s) return null;
  const now = Date.now();
  const idleLimit = new Date(s.last_seen_at).getTime() + config.sessionIdleMinutes * 60000;
  if (new Date(s.expires_at).getTime() < now || idleLimit < now) {
    db.run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  const user = db.one('SELECT * FROM users WHERE id = ? AND active = 1', s.user_id);
  if (!user) {
    db.run('DELETE FROM sessions WHERE id = ?', id);
    return null;
  }
  // last_seen höchstens einmal pro Minute schreiben
  if (touch && now - new Date(s.last_seen_at).getTime() > 60000) {
    db.run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', nowIso(), id);
  }
  return { session: s, user };
}

function destroy(token) {
  if (token) db.run('DELETE FROM sessions WHERE id = ?', hash(token));
}

function destroyAllForUser(userId, exceptToken) {
  if (exceptToken) db.run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', userId, hash(exceptToken));
  else db.run('DELETE FROM sessions WHERE user_id = ?', userId);
}

function purgeExpired() {
  db.run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
}

function cookieOptions(expires) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    expires,
  };
}

module.exports = { COOKIE, create, lookup, destroy, destroyAllForUser, purgeExpired, cookieOptions };
