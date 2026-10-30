'use strict';
const express = require('express');
const auth = require('../auth');
const users = require('../services/users');
const audit = require('../services/audit');
const { flash } = require('../lib/view-helpers');
const { ValidationError } = require('../services/errors');

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
    auth.login(req, res, result.user);
    res.redirect(result.user.must_change_password ? '/konto/passwort' : safeNext(req.body.next));
  } catch (err) { next(err); }
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
    flash(res, 'success', 'Willkommen! Das Admin-Konto ist eingerichtet.');
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

module.exports = router;
