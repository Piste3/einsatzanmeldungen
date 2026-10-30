'use strict';
// Eigenes Login: Benutzername + Passwort
const db = require('../../db');
const passwords = require('../passwords');
const throttle = require('../throttle');

const GENERIC_ERROR = 'Benutzername oder Passwort ist falsch.';

module.exports = {
  id: 'local',
  type: 'password',
  label: 'Benutzername und Passwort',
  enabled: () => true,

  async authenticate({ username, password, ip }) {
    username = String(username || '').trim();
    if (!username || !password) return { ok: false, error: 'Bitte Benutzername und Passwort eingeben.' };
    if (throttle.ipBlocked(ip)) {
      return { ok: false, error: 'Zu viele Fehlversuche von dieser Adresse. Bitte in 15 Minuten erneut versuchen.' };
    }
    const user = db.one('SELECT * FROM users WHERE username = ?', username);
    if (!user || !user.password_hash || !user.active) {
      await passwords.verifyDummy(password);
      throttle.record(ip, username, false);
      return { ok: false, error: GENERIC_ERROR };
    }
    if (throttle.accountLocked(user)) {
      throttle.record(ip, username, false);
      return { ok: false, error: `Das Konto ist wegen zu vieler Fehlversuche für ${throttle.ACCOUNT_LOCK_MIN} Minuten gesperrt.` };
    }
    const valid = await passwords.verifyPassword(password, user.password_hash);
    throttle.record(ip, username, valid);
    if (!valid) {
      throttle.registerFailure(user);
      return { ok: false, error: GENERIC_ERROR };
    }
    // Mit 2FA zählt das Login erst nach dem richtigen Code als erfolgreich
    // (sonst könnte man den Fehlversuchszähler mit dem Passwort immer wieder zurücksetzen)
    if (!user.totp_enabled_at) throttle.registerSuccess(user);
    if (passwords.needsRehash(user.password_hash)) {
      db.run('UPDATE users SET password_hash = ? WHERE id = ?', await passwords.hashPassword(password), user.id);
    }
    return { ok: true, user };
  },
};
