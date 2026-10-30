'use strict';
// Schutz gegen das Durchprobieren von Passwörtern:
// - pro Konto: nach 5 Fehlversuchen 15 Minuten gesperrt
// - pro IP-Adresse: höchstens 20 Fehlversuche in 15 Minuten
const db = require('../db');
const { nowIso } = require('../lib/dates');

const ACCOUNT_MAX = 5;
const ACCOUNT_LOCK_MIN = 15;
const IP_MAX = 20;
const WINDOW_MIN = 15;

function ipBlocked(ip) {
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  const row = db.one('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND success = 0 AND created_at > ?', ip, since);
  return row.n >= IP_MAX;
}

function record(ip, username, success) {
  db.run('INSERT INTO login_attempts (ip, username, success, created_at) VALUES (?, ?, ?, ?)', ip, username, success ? 1 : 0, nowIso());
}

function accountLocked(user) {
  return user.locked_until && new Date(user.locked_until).getTime() > Date.now();
}

function registerFailure(user) {
  const failed = user.failed_logins + 1;
  const lockedUntil = failed >= ACCOUNT_MAX ? new Date(Date.now() + ACCOUNT_LOCK_MIN * 60000).toISOString() : null;
  db.run('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?', lockedUntil ? 0 : failed, lockedUntil, user.id);
}

function registerSuccess(user) {
  db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);
}

function purgeOld() {
  db.run('DELETE FROM login_attempts WHERE created_at < ?', new Date(Date.now() - 30 * 86400000).toISOString());
}

module.exports = { ipBlocked, record, accountLocked, registerFailure, registerSuccess, purgeOld, ACCOUNT_LOCK_MIN };
