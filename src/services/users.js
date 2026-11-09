'use strict';
// Benutzerkonten und Rollen
const db = require('../db');
const audit = require('./audit');
const passwords = require('../auth/passwords');
const sessions = require('../auth/sessions');
const { nowIso } = require('../lib/dates');
const { ROLES } = require('../lib/labels');
const { ValidationError } = require('./errors');

function list() {
  return db.all(`SELECT u.*, p.first_name, p.last_name FROM users u LEFT JOIN persons p ON p.id = u.person_id ORDER BY u.active DESC, u.display_name COLLATE NOCASE`);
}

function get(id) {
  return db.one('SELECT * FROM users WHERE id = ?', id);
}

function validate(input, { isNew }) {
  const errors = [];
  const username = String(input.username || '').trim().toLowerCase();
  const displayName = String(input.display_name || '').trim();
  if (isNew && !/^[a-z0-9._@-]{3,60}$/.test(username)) errors.push('Benutzername: 3–60 Zeichen, nur Buchstaben, Ziffern, Punkt, Bindestrich, @.');
  if (!displayName) errors.push('Anzeigename fehlt.');
  if (!ROLES[input.role]) errors.push('Rolle wählen.');
  const email = String(input.email || '').trim().toLowerCase() || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('E-Mail-Adresse ungültig.');
  // Anmeldeverfahren: Fehlen die Felder im Formular (Microsoft auf dem Server aus), bleibt alles wie es war
  const loginFields = Boolean(input.login_fields);
  const msLogin = loginFields ? (input.ms_login ? 1 : 0) : Number(input.before?.ms_login || 0);
  const passwordLogin = loginFields ? (input.password_login ? 1 : 0) : Number(input.before?.password_login ?? 1);
  if (msLogin && !email) errors.push('Für die Microsoft-Anmeldung braucht es die E-Mail-Adresse des Microsoft-Kontos.');
  if (!passwordLogin && !msLogin) errors.push('Mindestens eine Anmeldeart muss erlaubt sein (Passwort oder Microsoft).');
  if (errors.length) throw new ValidationError(errors);
  return { username, display_name: displayName, role: input.role, email, person_id: input.person_id ? Number(input.person_id) : null, ms_login: msLogin, password_login: passwordLogin };
}

// 2FA-Vorgaben aus dem Formular: Pflicht ja/nein und wie oft der Code verlangt wird
function twofaSettings(input) {
  const allowed = require('../auth/twofa').REMEMBER_OPTIONS.map(([d]) => d);
  const days = Number(input.twofa_remember_days);
  return { twofa_required: input.twofa_required ? 1 : 0, twofa_remember_days: allowed.includes(days) ? days : 0 };
}

// Admin: 2FA eines Kontos zurücksetzen (z. B. Handy verloren); bei Pflicht muss sie neu eingerichtet werden
function resetTwofa(id, actor) {
  const user = get(id);
  if (!user) throw new ValidationError(['Benutzer nicht gefunden.']);
  require('../auth/twofa').disable(id);
  sessions.destroyAllForUser(id);
  audit.log({ entity: 'user', entityId: id, action: '2fa', summary: `${actor.display_name} hat die Zwei-Faktor-Anmeldung von «${user.username}» zurückgesetzt`, user: actor });
}

// Benutzerkonto ganz löschen. Erfasste Daten (Anmeldungen, Kontaktversuche, Verlauf) bleiben mit dem Namen erhalten.
function remove(id, actor) {
  const user = get(id);
  if (!user) throw new ValidationError(['Benutzer nicht gefunden.']);
  if (actor && actor.id === id) throw new ValidationError(['Das eigene Konto kann man nicht löschen.']);
  if (user.role === 'admin' && user.active && db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n <= 1) {
    throw new ValidationError(['Das ist der letzte aktive Admin – zuerst einen anderen Admin anlegen.']);
  }
  db.tx(() => {
    sessions.destroyAllForUser(id);
    db.run('UPDATE contact_attempts SET sent_by_user_id = NULL WHERE sent_by_user_id = ?', id);
    db.run('DELETE FROM users WHERE id = ?', id);
    audit.log({ entity: 'user', entityId: id, action: 'delete', summary: `${actor.display_name} hat das Benutzerkonto «${user.username}» (${user.display_name}) gelöscht`, user: actor });
  });
}

async function create(input, actor) {
  const data = validate({ ...input, before: undefined }, { isNew: true });
  if (db.one('SELECT 1 FROM users WHERE username = ?', data.username)) throw new ValidationError(['Dieser Benutzername ist bereits vergeben.']);
  const password = input.password ? String(input.password) : passwords.randomPassword();
  const policy = passwords.checkPolicy(password, { username: data.username });
  if (policy.length) throw new ValidationError(policy);
  const now = nowIso();
  const twofa = twofaSettings(input);
  const info = db.run(`INSERT INTO users (username, display_name, email, role, person_id, password_hash, must_change_password, twofa_required, twofa_remember_days, ms_login, password_login, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, data.username, data.display_name, data.email, data.role, data.person_id,
  await passwords.hashPassword(password), input.must_change_password === false ? 0 : 1, twofa.twofa_required, twofa.twofa_remember_days, data.ms_login, data.password_login, now, now);
  const id = Number(info.lastInsertRowid);
  if (actor) audit.log({ entity: 'user', entityId: id, action: 'create', summary: `${actor.display_name} hat das Benutzerkonto «${data.username}» (${ROLES[data.role]}) angelegt`, user: actor });
  return { id, password };
}

function update(id, input, actor) {
  const before = get(id);
  if (!before) throw new ValidationError(['Benutzer nicht gefunden.']);
  const data = validate({ ...input, username: before.username, before }, { isNew: false });
  // Nicht aussperren: das eigene Passwort-Login erst abschalten, wenn Microsoft bei dir schon einmal geklappt hat
  if (before.id === actor.id && !data.password_login && (!before.external_id || !data.ms_login || data.email !== before.email)) {
    throw new ValidationError(['Melde dich zuerst einmal erfolgreich mit Microsoft an, bevor du dein eigenes Passwort-Login abschaltest.']);
  }
  const active = input.active ? 1 : 0;
  if (before.id === actor.id && (data.role !== 'admin' || !active)) throw new ValidationError(['Du kannst dir die Admin-Rolle nicht selbst entziehen oder dich deaktivieren.']);
  if (before.role === 'admin' && (data.role !== 'admin' || !active)) {
    const admins = db.one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").n;
    if (admins <= 1) throw new ValidationError(['Es muss mindestens ein aktiver Admin bestehen bleiben.']);
  }
  const twofa = twofaSettings(input);
  // Neue E-Mail oder Freigabe entzogen: Verknüpfung mit dem Microsoft-Konto lösen
  const unlink = before.external_id && (!data.ms_login || data.email !== before.email);
  db.run('UPDATE users SET display_name = ?, email = ?, role = ?, person_id = ?, active = ?, twofa_required = ?, twofa_remember_days = ?, ms_login = ?, password_login = ?, external_id = CASE WHEN ? THEN NULL ELSE external_id END, updated_at = ? WHERE id = ?',
    data.display_name, data.email, data.role, data.person_id, active, twofa.twofa_required, twofa.twofa_remember_days, data.ms_login, data.password_login, unlink ? 1 : 0, nowIso(), id);
  if (!active) sessions.destroyAllForUser(id);
  // Einsatz-Freigaben gelten nur für Einsatzleiter
  if (before.role === 'einsatzleiter' && data.role !== 'einsatzleiter') require('./leaders').clearForUser(id);
  audit.log({ entity: 'user', entityId: id, action: 'update', summary: `${actor.display_name} hat das Benutzerkonto «${before.username}» geändert`, details: audit.diff(before, { ...data, active, ...twofa }, ['display_name', 'email', 'role', 'person_id', 'active', 'twofa_required', 'twofa_remember_days', 'ms_login', 'password_login']), user: actor });
}

// Lokales Login ausgeschaltet («nur Microsoft»): dann darf niemand das Passwort ändern oder zurücksetzen
const passwordLocked = (user) => Boolean(user) && !Number(user.password_login ?? 1);
const LOCKED_MSG = 'Für dieses Konto ist die Anmeldung mit Benutzername und Passwort ausgeschaltet. Das Passwort lässt sich nicht ändern.';

// Admin setzt ein neues Startpasswort; beim nächsten Login muss es geändert werden
async function resetPassword(id, actor) {
  const user = get(id);
  if (!user) throw new ValidationError(['Benutzer nicht gefunden.']);
  if (passwordLocked(user)) throw new ValidationError([LOCKED_MSG]);
  const password = passwords.randomPassword();
  db.run('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
    await passwords.hashPassword(password), nowIso(), id);
  sessions.destroyAllForUser(id);
  audit.log({ entity: 'user', entityId: id, action: 'reset', summary: `${actor.display_name} hat das Passwort von «${user.username}» zurückgesetzt`, user: actor });
  return password;
}

async function changePassword(user, current, next, confirm, sessionToken) {
  // Frisch aus der Datenbank lesen: die Sitzung kann einen alten Stand haben
  if (passwordLocked(get(user.id) || user)) throw new ValidationError([LOCKED_MSG]);
  const errors = [];
  if (!(await passwords.verifyPassword(current, user.password_hash))) errors.push('Das aktuelle Passwort ist falsch.');
  if (next !== confirm) errors.push('Die neuen Passwörter stimmen nicht überein.');
  if (current && next === current) errors.push('Das neue Passwort muss sich vom bisherigen unterscheiden.');
  errors.push(...passwords.checkPolicy(next, { username: user.username }));
  if (errors.length) throw new ValidationError(errors);
  db.run('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?', await passwords.hashPassword(next), nowIso(), user.id);
  // Alle anderen Sitzungen dieses Benutzers beenden
  sessions.destroyAllForUser(user.id, sessionToken);
  audit.log({ entity: 'user', entityId: user.id, action: 'password', summary: `${user.display_name} hat das eigene Passwort geändert`, user });
}

function unlock(id, actor) {
  db.run('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?', id);
  audit.log({ entity: 'user', entityId: id, action: 'unlock', summary: `${actor.display_name} hat ein Benutzerkonto entsperrt`, user: actor });
}

function count() {
  return db.one('SELECT COUNT(*) AS n FROM users').n;
}

module.exports = { list, get, create, update, remove, resetTwofa, resetPassword, changePassword, passwordLocked, unlock, count };
