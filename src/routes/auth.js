'use strict';
const express = require('express');
const auth = require('../auth');
const users = require('../services/users');
const audit = require('../services/audit');
const { flash } = require('../lib/view-helpers');
const { ValidationError } = require('../services/errors');
const twofa = require('../auth/twofa');
const throttle = require('../auth/throttle');
const passwords = require('../auth/passwords');

const router = express.Router();

// Nur interne Weiterleitungen zulassen
function safeNext(next) {
  const n = String(next || '');
  return n.startsWith('/') && !n.startsWith('//') && !n.startsWith('/\\') ? n : '/';
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/');
  if (req.app.locals.setupToken) return res.render('auth/login', { title: 'Anmelden', error: 'Es ist noch kein Benutzerkonto eingerichtet. Den Einrichtungs-Link findest du in der Server-Ausgabe.', providers: [], next: '/', username: '' });
  res.render('auth/login', { title: 'Anmelden', error: null, providers: auth.providers(), next: safeNext(req.query.next), username: '' });
});

router.post('/login', async (req, res, next) => {
  try {
    const local = auth.provider('local');
    if (!local) return res.status(404).send('Lokales Login ist deaktiviert.');
    const result = await local.authenticate({ username: req.body.username, password: req.body.password, ip: req.ip });
    if (!result.ok) {
      return res.status(401).render('auth/login', {
        title: 'Anmelden', error: result.error, providers: auth.providers(), next: safeNext(req.body.next), username: req.body.username || '',
      });
    }
    const user = result.user;
    const target = user.must_change_password ? '/konto/passwort' : safeNext(req.body.next);
    // Zweite Stufe: Code aus der Authenticator-App, ausser das Gerät ist gemerkt
    if (twofa.isEnabled(user)) {
      if (!twofa.deviceTrusted(user, req)) {
        twofa.startChallenge(user, target, res);
        return res.redirect(303, '/login/2fa');
      }
      throttle.registerSuccess(user);
    }
    auth.login(req, res, user);
    res.redirect(target);
  } catch (err) { next(err); }
});

router.get('/login/2fa', (req, res) => {
  const found = twofa.getChallenge(req);
  if (!found) return res.redirect('/login');
  res.render('auth/twofa', { title: 'Bestätigungscode', error: null, rememberDays: found.user.twofa_remember_days });
});

router.post('/login/2fa', (req, res) => {
  const r = twofa.completeChallenge(req, res, req.body.code);
  if (!r.ok) {
    if (r.expired) return res.status(401).render('auth/login', { title: 'Anmelden', error: r.error, providers: auth.providers(), next: '/', username: '' });
    const found = twofa.getChallenge(req);
    return res.status(401).render('auth/twofa', { title: 'Bestätigungscode', error: r.error, rememberDays: found?.user.twofa_remember_days || 0 });
  }
  auth.login(req, res, r.user);
  if (req.body.remember === '1') twofa.rememberDevice(r.user, req, res);
  if (r.used === 'recovery') {
    flash(res, r.remaining > 2 ? 'info' : 'error', `Du hast dich mit einem Wiederherstellungscode angemeldet. Es bleiben noch ${r.remaining}. Neue Codes erzeugst du unter «Konto › Zwei-Faktor».`);
  }
  res.redirect(r.nextUrl || '/');
});

router.post('/logout', (req, res) => {
  // Abmelden ohne CSRF-Prüfung ist unkritisch, aber nur per POST
  auth.logout(req, res);
  res.redirect('/login');
});

// Microsoft SSO (sobald aktiviert)
router.get('/auth/microsoft', async (req, res, next) => {
  try {
    const p = auth.provider('microsoft');
    if (!p) return res.status(404).render('pages/error', { title: 'Nicht verfügbar', message: 'Microsoft-Anmeldung ist nicht eingerichtet.' });
    await p.start(req, res);
  } catch (err) { next(err); }
});

router.get('/auth/microsoft/callback', async (req, res) => {
  const p = auth.provider('microsoft');
  if (!p) return res.redirect('/login');
  try {
    const result = await p.callback(req, res);
    if (!result.ok) return res.status(401).render('auth/login', { title: 'Anmelden', error: result.error, providers: auth.providers(), next: '/', username: '' });
    auth.login(req, res, result.user);
    res.redirect('/');
  } catch (err) {
    console.error('Microsoft-Login:', err);
    res.status(401).render('auth/login', { title: 'Anmelden', error: 'Microsoft-Anmeldung fehlgeschlagen.', providers: auth.providers(), next: '/', username: '' });
  }
});

// Ersteinrichtung: ersten Admin anlegen (nur mit Token aus der Server-Ausgabe)
function checkSetup(req, res) {
  const token = req.app.locals.setupToken;
  if (!token || users.count() > 0 || String(req.query.token || req.body?.token || '') !== token) {
    res.status(404).render('pages/error', { title: 'Nicht gefunden', message: 'Die Einrichtung ist bereits abgeschlossen oder der Link ist ungültig.' });
    return false;
  }
  return true;
}

router.get('/setup', (req, res) => {
  if (!checkSetup(req, res)) return;
  res.render('auth/setup', { title: 'Einrichtung', token: req.query.token, errors: [], values: {} });
});

router.post('/setup', async (req, res, next) => {
  if (!checkSetup(req, res)) return;
  try {
    if (req.body.password !== req.body.password_confirm) throw new ValidationError(['Die Passwörter stimmen nicht überein.']);
    const { id } = await users.create({ ...req.body, role: 'admin', must_change_password: false }, null);
    req.app.locals.setupToken = null;
    const user = users.get(id);
    audit.log({ entity: 'user', entityId: id, action: 'setup', summary: `${user.display_name} hat den KKB-Einsatzplaner eingerichtet`, user });
    auth.login(req, res, user);
    flash(res, 'success', 'Das Admin-Konto ist eingerichtet');
    res.redirect('/');
  } catch (err) {
    if (err instanceof ValidationError) return res.render('auth/setup', { title: 'Einrichtung', token: req.body.token, errors: err.messages, values: req.body });
    next(err);
  }
});

// Eigenes Passwort ändern (auch erzwungen nach Zurücksetzen)
router.get('/konto/passwort', auth.requireLogin, (req, res) => {
  res.locals.nav = require('../services/cockpit').navCounts();
  res.render('auth/password', { title: 'Passwort ändern', errors: [] });
});

// Darstellung (Hell / Dunkel / wie System) pro Benutzer
router.post('/konto/darstellung', auth.requireLogin, auth.csrfProtect, (req, res) => {
  const theme = ['system', 'light', 'dark'].includes(req.body.theme) ? req.body.theme : 'system';
  require('../db').run('UPDATE users SET theme = ? WHERE id = ?', theme, req.user.id);
  const back = String(req.get('referer') || '/');
  let target = '/';
  try { const u = new URL(back); if (u.host === req.get('host')) target = u.pathname + u.search; } catch { /* Standard */ }
  res.redirect(target);
});

router.post('/konto/passwort', auth.requireLogin, auth.csrfProtect, async (req, res, next) => {
  try {
    await users.changePassword(req.user, req.body.current, req.body.password, req.body.password_confirm, req.sessionToken);
    flash(res, 'success', 'Das Passwort wurde geändert.');
    res.redirect('/');
  } catch (err) {
    if (err instanceof ValidationError) {
      res.locals.nav = require('../services/cockpit').navCounts();
      return res.status(400).render('auth/password', { title: 'Passwort ändern', errors: err.messages });
    }
    next(err);
  }
});

// ---- Eigene Zwei-Faktor-Anmeldung ----
async function renderTwofa(req, res, extra = {}) {
  res.locals.nav = require('../services/cockpit').navCounts();
  const user = users.get(req.user.id);
  let setup = null;
  if (!twofa.isEnabled(user) && user.auth_provider === 'local') {
    // Neues Geheimnis für die Einrichtung (wird erst mit einem gültigen Code aktiv)
    const { secret, url } = extra.keepSecret && user.totp_secret ? { secret: user.totp_secret, url: require('../auth/totp').otpauthUrl(user.totp_secret, user.username, twofa.ISSUER) } : twofa.beginSetup(user);
    const qr = await require('qrcode').toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
    setup = { secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr };
  }
  const devices = require('../db').one('SELECT COUNT(*) AS n FROM trusted_devices WHERE user_id = ? AND expires_at > ?', user.id, new Date().toISOString()).n;
  res.render('auth/twofa-account', {
    title: 'Zwei-Faktor-Anmeldung', u: user, enabled: twofa.isEnabled(user), required: Boolean(user.twofa_required), setup,
    remaining: twofa.recoveryCount(user), devices, rememberLabel: (twofa.REMEMBER_OPTIONS.find(([d]) => d === user.twofa_remember_days) || [0, ''])[1],
    codes: null, errors: [], ...extra,
  });
}

router.get('/konto/2fa', auth.requireLogin, (req, res, next) => renderTwofa(req, res).catch(next));

router.post('/konto/2fa/einrichten', auth.requireLogin, auth.csrfProtect, async (req, res, next) => {
  try {
    const codes = twofa.confirmSetup(req.user, req.body.code);
    if (!codes) return renderTwofa(req, res, { errors: ['Der Code stimmt nicht. Prüfe, ob die Uhrzeit auf dem Handy stimmt, und gib den aktuellen Code ein.'], keepSecret: true });
    audit.log({ entity: 'user', entityId: req.user.id, action: '2fa', summary: `${req.user.display_name} hat die Zwei-Faktor-Anmeldung eingerichtet`, user: req.user });
    await renderTwofa(req, res, { codes, justEnabled: true });
  } catch (err) { next(err); }
});

// Für heikle Schritte: aktuellen Code (oder Passwort beim Abschalten) verlangen
router.post('/konto/2fa/codes', auth.requireLogin, auth.csrfProtect, async (req, res, next) => {
  try {
    const user = users.get(req.user.id);
    const totp = require('../auth/totp');
    const step = totp.verify(user.totp_secret, req.body.code, { lastStep: user.totp_last_step ?? -1 });
    if (step === null) return renderTwofa(req, res, { errors: ['Der Code stimmt nicht.'] });
    require('../db').run('UPDATE users SET totp_last_step = ? WHERE id = ?', step, user.id);
    const codes = twofa.newRecoveryCodes(user.id);
    audit.log({ entity: 'user', entityId: user.id, action: '2fa', summary: `${user.display_name} hat neue Wiederherstellungscodes erzeugt`, user: req.user });
    await renderTwofa(req, res, { codes });
  } catch (err) { next(err); }
});

router.post('/konto/2fa/aus', auth.requireLogin, auth.csrfProtect, async (req, res, next) => {
  try {
    const user = users.get(req.user.id);
    if (user.twofa_required) return renderTwofa(req, res, { errors: ['Für dein Konto ist die Zwei-Faktor-Anmeldung vorgeschrieben. Abschalten kann nur ein Admin (Zurücksetzen).'] });
    if (!(await passwords.verifyPassword(req.body.password, user.password_hash))) return renderTwofa(req, res, { errors: ['Das Passwort ist falsch.'] });
    twofa.disable(user.id);
    audit.log({ entity: 'user', entityId: user.id, action: '2fa', summary: `${user.display_name} hat die Zwei-Faktor-Anmeldung abgeschaltet`, user: req.user });
    flash(res, 'success', 'Die Zwei-Faktor-Anmeldung ist abgeschaltet.');
    res.redirect('/konto/2fa');
  } catch (err) { next(err); }
});

router.post('/konto/2fa/geraete', auth.requireLogin, auth.csrfProtect, (req, res) => {
  twofa.forgetDevices(req.user.id);
  res.clearCookie(twofa.DEVICE_COOKIE, { path: '/' });
  flash(res, 'success', 'Alle gemerkten Geräte wurden vergessen. Beim nächsten Login wird überall wieder ein Code verlangt.');
  res.redirect('/konto/2fa');
});

module.exports = router;
