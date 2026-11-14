'use strict';
// JSON-Schnittstelle für die Browser-App (Vue). Schritt 1 des Umbaus «Frontend und Backend trennen».
//
// Die Schnittstelle nutzt dieselben Routen wie die Seiten. Sie liegt unter /api/v1 und antwortet mit JSON:
//  - res.render(vorlage, daten) liefert { view, title, data, … } statt HTML.
//  - res.redirect(url) liefert { redirect, flashes } statt einer Weiterleitung.
//  - Fehler liefern { error, messages } mit dem passenden Statuscode.
// Dateien (PDF, Excel, CSV, ICS) kommen unverändert zurück. So bleibt die Logik an einer Stelle,
// bis die alten Seiten (EJS) in Schritt 5 wegfallen.
const express = require('express');
const auth = require('./auth');
const helpers = require('./lib/view-helpers');
const { ValidationError, ConflictError, ReadOnlyError } = require('./services/errors');

// Felder, die nie das Backend verlassen
const PRIVATE_USER_FIELDS = ['password_hash', 'totp_secret', 'totp_last_step', 'recovery_codes', 'external_id', 'failed_logins', 'locked_until'];

function safeUser(user) {
  if (!user) return null;
  const out = { ...user };
  for (const k of PRIVATE_USER_FIELDS) delete out[k];
  return out;
}

// Funktionen weglassen, grosse Zahlen als Zahl senden, geheime Felder an jeder Stelle entfernen
function replacer(key, value) {
  if (typeof value === 'function') return undefined;
  if (PRIVATE_USER_FIELDS.includes(key)) return undefined;
  if (typeof value === 'bigint') return Number(value);
  return value;
}

// Namen, die nicht in «data» landen
const META = new Set(['h', '_api', 'user', 'nav', 'flashes', 'csrfToken', 'title', 'path', 'query', 'isAdmin', 'isLeader', 'liveTopics', '_flashOut', 'settings', 'cache', '_locals']);

function envelope(req, res, view, data) {
  const merged = { ...res.locals, ...data };
  const rest = {};
  for (const [k, v] of Object.entries(merged)) if (!META.has(k)) rest[k] = v;
  return {
    view,
    title: merged.title || '',
    user: safeUser(req.user),
    csrf: req.session?.csrf_token || '',
    nav: merged.nav || {},
    flashes: res.locals._flashOut || [],
    liveTopics: merged.liveTopics || [],
    data: rest,
  };
}

function prepare(req, res, next) {
  res.locals._api = true;
  res.render = function apiRender(view, options, cb) {
    const data = typeof options === 'function' ? {} : options || {};
    const body = JSON.stringify(envelope(req, this, view, data), replacer);
    this.type('application/json').send(body);
    if (typeof cb === 'function') cb(null, body);
  };
  res.redirect = function apiRedirect(a, b) {
    const status = typeof a === 'number' ? a : 302;
    const url = typeof a === 'number' ? b : a;
    void status;
    this.status(200).json({ redirect: String(url), flashes: this.locals._flashOut || [] });
  };
  next();
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof ValidationError || err instanceof ReadOnlyError) {
    return res.status(err instanceof ReadOnlyError ? 403 : 400).json({ error: err.message, messages: err.messages || [err.message] });
  }
  if (err instanceof ConflictError) {
    return res.status(409).json({
      error: 'Der Datensatz wurde inzwischen von jemand anderem geändert.',
      conflict: { current: err.current || null, lastChange: err.lastChange || null },
    });
  }
  console.error(err);
  return res.status(500).json({ error: 'Ein unerwarteter Fehler ist aufgetreten.' });
}

function requireLoginJson(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Nicht angemeldet', login: true });
  return auth.requireLogin(req, res, next);
}

function createApi() {
  const api = express.Router();
  api.use(prepare);

  // Öffentliches Anmeldeformular
  api.use('/forms', require('./routes/public-form'));

  api.use(auth.loadSession);
  api.use(helpers.flashMiddleware);
  api.use(helpers.localsMiddleware);

  // Start der Browser-App: wer ist angemeldet? Brauchbar auch ohne Login.
  api.get('/session', (req, res) => {
    if (req.user) res.locals.nav = req.user.role === 'einsatzleiter' ? {} : require('./services/cockpit').navCounts();
    res.json({
      user: safeUser(req.user),
      csrf: req.session?.csrf_token || '',
      nav: res.locals.nav || {},
      flashes: res.locals.flashes || [],
      providers: auth.providers().map((p) => ({ id: p.id, label: p.label || p.id })),
      ...require('./routes/handy').phoneState(req),
    });
  });

  api.use(require('./routes/auth'));

  // Ab hier nur mit Login
  api.use(requireLoginJson);
  api.use(auth.csrfProtect);
  api.use(helpers.navMiddleware);
  api.use(require('./services/user-filters').middleware);
  api.use(require('./routes/leader'));
  api.use(require('./routes/handy'));
  api.use(require('./routes/cockpit'));
  api.use(require('./routes/events'));
  api.use(require('./routes/registrations'));
  api.use(require('./routes/clarifications'));
  api.use(require('./routes/feedback'));
  api.use(require('./routes/persons'));
  api.use(require('./routes/forms'));
  api.use(require('./routes/handbook'));
  api.use(require('./routes/admin'));

  api.use((req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
  api.use(errorHandler);
  return api;
}

module.exports = { createApi, safeUser };
