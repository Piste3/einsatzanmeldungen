'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const helpers = require('./lib/view-helpers');
const { ValidationError, ConflictError, ReadOnlyError } = require('./services/errors');

// Version der CSS/JS-Dateien für die URL (?v=…), damit Browser nach einem Update nicht alte Dateien aus dem Cache nehmen
function assetVersion() {
  const fs = require('node:fs');
  const hash = require('node:crypto').createHash('sha1');
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(path.join(__dirname, '..', 'public'));
  return hash.digest('hex').slice(0, 10);
}

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.locals.h = helpers;
  app.locals.v = assetVersion();

  // Sicherheits-Header. Das öffentliche Formular darf nur von ClubDesk eingebettet werden.
  app.use((req, res, next) => {
    const isForm = req.path.startsWith('/forms/');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "script-src 'self'", "connect-src 'self'",
      "form-action 'self'", "base-uri 'none'", "object-src 'none'",
      `frame-ancestors ${isForm ? config.formFrameAncestors : "'none'"}`,
      ...(isForm ? ['report-uri /forms/csp-bericht'] : []),
    ].join('; '));
    if (!isForm) res.setHeader('X-Frame-Options', 'DENY');
    if (config.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    next();
  });

  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: config.isProd ? '7d' : 0 }));
  app.use(express.urlencoded({ extended: false, limit: '2mb', parameterLimit: 5000 }));
  app.use(express.json({ limit: '1mb' }));

  // Öffentliches Anmeldeformular (ohne Login)
  app.use('/forms', require('./routes/public-form'));
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.use(auth.loadSession);
  app.use(helpers.flashMiddleware);
  app.use(helpers.localsMiddleware);
  app.use(require('./routes/auth'));

  // Ab hier nur mit Login
  app.use(auth.requireLogin);
  app.use(auth.csrfProtect);
  app.use(helpers.navMiddleware);
  app.use(require('./routes/cockpit'));
  app.use(require('./routes/events'));
  app.use(require('./routes/registrations'));
  app.use(require('./routes/clarifications'));
  app.use(require('./routes/feedback'));
  app.use(require('./routes/persons'));
  app.use(require('./routes/forms'));
  app.use(require('./routes/admin'));

  app.use((req, res) => res.status(404).render('pages/error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' }));

  // Fehler: Eingabefehler zurück zur vorherigen Seite, Rest als Fehlerseite
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ValidationError || err instanceof ReadOnlyError) {
      helpers.flash(res, 'error', err.messages ? err.messages.join(' ') : err.message);
      return res.redirect(safeBack(req));
    }
    if (err instanceof ConflictError) {
      helpers.flash(res, 'error', 'Der Datensatz wurde inzwischen von jemand anderem geändert. Bitte neu laden.');
      return res.redirect(safeBack(req));
    }
    console.error(err);
    res.status(500).render('pages/error', { title: 'Fehler', message: 'Ein unerwarteter Fehler ist aufgetreten. Bitte erneut versuchen.' });
  });
  return app;
}

function safeBack(req) {
  const ref = req.get('referer');
  try {
    const u = new URL(ref);
    if (u.host === req.get('host')) return u.pathname + u.search;
  } catch { /* ignorieren */ }
  return '/';
}

module.exports = { createApp, safeBack };
