'use strict';
// Zwei-Faktor-Anmeldung mit Authenticator-App (TOTP), Wiederherstellungscodes und «Gerät merken».
// Gilt für das eigene Login; bei Microsoft-Konten übernimmt Microsoft die zweite Stufe.
const crypto = require('node:crypto');
const db = require('../db');
const config = require('../config');
const totp = require('./totp');
const throttle = require('./throttle');
const { nowIso } = require('../lib/dates');

const CHALLENGE_COOKIE = 'kkb_2fa';
const DEVICE_COOKIE = 'kkb_device';
const CHALLENGE_MIN = 10;
const MAX_ATTEMPTS = 5;
const ISSUER = 'KKB-Einsatzplaner';
// Auswahl in der Benutzerverwaltung: wie oft der Code verlangt wird
const REMEMBER_OPTIONS = [[0, 'bei jedem Login'], [1, 'einmal pro Tag und Gerät'], [7, 'einmal pro Woche und Gerät'], [30, 'einmal pro Monat und Gerät'], [90, 'alle 3 Monate pro Gerät']];

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
const cookieBase = () => ({ httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/' });

const isEnabled = (user) => Boolean(user && user.auth_provider === 'local' && user.totp_enabled_at && user.totp_secret);
const mustSetUp = (user) => Boolean(user && user.auth_provider === 'local' && user.twofa_required && !user.totp_enabled_at);

// ---- Gemerkte Geräte ----
function deviceTrusted(user, req) {
  const token = req.cookies?.[DEVICE_COOKIE];
  if (!token || !user.twofa_remember_days) return false;
  const d = db.one('SELECT * FROM trusted_devices WHERE id = ? AND user_id = ?', hash(token), user.id);
  if (!d) return false;
  // Gilt höchstens so lange, wie die aktuelle Einstellung des Benutzers erlaubt
  const limit = Math.min(new Date(d.expires_at).getTime(), new Date(d.created_at).getTime() + user.twofa_remember_days * 86400000);
  return limit > Date.now();
}

function rememberDevice(user, req, res) {
  if (!user.twofa_remember_days) return;
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + user.twofa_remember_days * 86400000);
  db.run('INSERT INTO trusted_devices (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    hash(token), user.id, nowIso(), expires.toISOString(), String(req.headers['user-agent'] || '').slice(0, 200));
  res.cookie(DEVICE_COOKIE, token, { ...cookieBase(), expires });
}

function forgetDevices(userId) {
  db.run('DELETE FROM trusted_devices WHERE user_id = ?', userId);
}

// ---- Angefangenes Login (Passwort ok, Code fehlt) ----
function startChallenge(user, nextUrl, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + CHALLENGE_MIN * 60000);
  db.run('INSERT INTO login_challenges (id, user_id, next_url, expires_at) VALUES (?, ?, ?, ?)', hash(token), user.id, nextUrl, expires.toISOString());
  res.cookie(CHALLENGE_COOKIE, token, { ...cookieBase(), expires });
}

function getChallenge(req) {
  const token = req.cookies?.[CHALLENGE_COOKIE];
  if (!token) return null;
  const c = db.one('SELECT * FROM login_challenges WHERE id = ?', hash(token));
  if (!c || new Date(c.expires_at).getTime() < Date.now()) return null;
  const user = db.one('SELECT * FROM users WHERE id = ? AND active = 1', c.user_id);
  return user ? { challenge: c, user } : null;
}

function endChallenge(req, res) {
  const token = req.cookies?.[CHALLENGE_COOKIE];
  if (token) db.run('DELETE FROM login_challenges WHERE id = ?', hash(token));
  res.clearCookie(CHALLENGE_COOKIE, { path: '/' });
}

// Code (6 Ziffern) oder Wiederherstellungscode prüfen; bei Erfolg wird er verbraucht
function checkCode(user, input) {
  const raw = String(input || '').trim();
  const step = totp.verify(user.totp_secret, raw, { lastStep: user.totp_last_step ?? -1 });
  if (step !== null) {
    db.run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, user.id);
    return 'totp';
  }
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized.length === 10) {
    const codes = JSON.parse(user.recovery_codes || '[]');
    const h = hash(normalized);
    if (codes.includes(h)) {
      db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(codes.filter((c) => c !== h)), user.id);
      return 'recovery';
    }
  }
  return null;
}

/** Zweite Stufe prüfen. Gibt { ok, user, nextUrl, used, remaining } oder { ok:false, error } zurück. */
function completeChallenge(req, res, code) {
  const found = getChallenge(req);
  if (!found) return { ok: false, expired: true, error: 'Die Anmeldung ist abgelaufen. Bitte erneut mit Passwort anmelden.' };
  const { challenge, user } = found;
  if (throttle.accountLocked(user)) {
    endChallenge(req, res);
    return { ok: false, expired: true, error: `Das Konto ist wegen zu vieler Fehlversuche für ${throttle.ACCOUNT_LOCK_MIN} Minuten gesperrt.` };
  }
  const used = checkCode(user, code);
  throttle.record(req.ip, user.username, Boolean(used));
  if (!used) {
    throttle.registerFailure(user);
    db.run('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?', challenge.id);
    if (challenge.attempts + 1 >= MAX_ATTEMPTS) {
      endChallenge(req, res);
      return { ok: false, expired: true, error: 'Zu viele falsche Codes. Bitte erneut mit Passwort anmelden.' };
    }
    return { ok: false, error: 'Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.' };
  }
  throttle.registerSuccess(user);
  endChallenge(req, res);
  const remaining = JSON.parse(db.one('SELECT recovery_codes FROM users WHERE id = ?', user.id).recovery_codes || '[]').length;
  return { ok: true, user, nextUrl: challenge.next_url, used, remaining };
}

// ---- Einrichten / Abschalten ----
function newRecoveryCodes(userId) {
  // 10 Zeichen aus einem gut lesbaren Alphabet (ohne 0/o, 1/l/i)
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const plain = Array.from({ length: 10 }, () => {
    const s = [...crypto.randomBytes(10)].map((b) => alphabet[b % alphabet.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
  db.run('UPDATE users SET recovery_codes = ? WHERE id = ?', JSON.stringify(plain.map((c) => hash(c.replace('-', '')))), userId);
  return plain;
}

// Neues Geheimnis vorbereiten (noch nicht aktiv, bis ein Code bestätigt ist)
function beginSetup(user) {
  if (isEnabled(user)) throw new Error('2FA ist bereits eingerichtet.');
  const secret = totp.generateSecret();
  db.run('UPDATE users SET totp_secret = ?, totp_enabled_at = NULL WHERE id = ?', secret, user.id);
  return { secret, url: totp.otpauthUrl(secret, user.username, ISSUER) };
}

function confirmSetup(user, code) {
  const fresh = db.one('SELECT * FROM users WHERE id = ?', user.id);
  if (!fresh.totp_secret || fresh.totp_enabled_at) return null;
  const step = totp.verify(fresh.totp_secret, code);
  if (step === null) return null;
  db.run('UPDATE users SET totp_enabled_at = ?, totp_last_step = ?, updated_at = ? WHERE id = ?', nowIso(), step, nowIso(), user.id);
  return newRecoveryCodes(user.id);
}

function disable(userId) {
  db.run('UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL, recovery_codes = NULL, updated_at = ? WHERE id = ?', nowIso(), userId);
  forgetDevices(userId);
}

function recoveryCount(user) {
  return JSON.parse(user.recovery_codes || '[]').length;
}

function purgeExpired() {
  db.run('DELETE FROM login_challenges WHERE expires_at < ?', nowIso());
  db.run('DELETE FROM trusted_devices WHERE expires_at < ?', nowIso());
}

module.exports = {
  CHALLENGE_COOKIE, DEVICE_COOKIE, REMEMBER_OPTIONS, ISSUER, isEnabled, mustSetUp, deviceTrusted, rememberDevice, forgetDevices,
  startChallenge, getChallenge, completeChallenge, endChallenge, beginSetup, confirmSetup, disable, newRecoveryCodes, recoveryCount, purgeExpired,
};
