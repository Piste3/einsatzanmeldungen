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
  app.set('trust proxy', config.trustProxy ? 1 : false);
  // Änderung unter Einstellungen › Server wirkt sofort
  config.onChange(() => app.set('trust proxy', config.trustProxy ? 1 : false));
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
  // Seiten nie aus dem Browser-Cache zeigen: Beim Zurückgehen lädt der Browser sie neu und zeigt den aktuellen Stand
  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.urlencoded({ extended: false, limit: '2mb', parameterLimit: 5000 }));
  app.use(express.json({ limit: '1mb' }));

  // Öffentliches Anmeldeformular (ohne Login)
  app.use('/forms', require('./routes/public-form'));
  app.get('/health', (req, res) => res.json({ ok: true }));
  // Handy-App: Manifest und Service Worker ohne Login (der Browser lädt sie ohne Cookies)
  app.get('/manifest.webmanifest', (req, res) => {
    res.type('application/manifest+json').setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'public', 'manifest.webmanifest'));
  });
  app.get('/sw.js', (req, res) => {
    res.type('application/javascript').setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, '..', 'public', 'js', 'sw.js'));
  });

  // Aktionen ohne Neuladen (app.js): Bei einer Weiterleitung nur das Ziel melden. Der Browser holt die Seite
  // dann selbst und tauscht nur den Inhalt aus. Die Meldung («Gespeichert») bleibt im Cookie, bis die Seite kommt.
  app.use((req, res, next) => {
    if (req.method !== 'POST' || req.get('X-Inline-Action') !== '1') return next();
    res.redirect = function inlineRedirect(a, b) {
      this.location(typeof a === 'number' ? b : a);
      this.set('X-Inline-Redirect', this.get('Location'));
      this.removeHeader('Location');
      return this.status(204).end();
    };
    next();
  });

  // Browser-App (Vue): während des Umbaus unter /neu, danach auf «/». Gebaut wird sie in frontend/ (npm run build).
  const appDist = path.join(__dirname, '..', 'frontend', 'dist');
  if (require('node:fs').existsSync(path.join(appDist, 'index.html'))) {
    app.use('/neu/assets', express.static(path.join(appDist, 'assets'), { maxAge: '365d', immutable: true, fallthrough: false }));
    app.get(/^\/neu(\/.*)?$/, (req, res) => res.sendFile(path.join(appDist, 'index.html')));
  }

  // JSON-Schnittstelle für die Browser-App (Vue)
  app.use('/api/v1', require('./api').createApi());

  app.use(auth.loadSession);
  app.use(helpers.flashMiddleware);
  app.use(helpers.localsMiddleware);
  app.use(require('./routes/handy').shellMiddleware);
  app.use(require('./routes/auth'));

  // Ab hier nur mit Login
  app.use(auth.requireLogin);
  app.use(auth.csrfProtect);
  app.use(helpers.navMiddleware);
  app.use(require('./services/user-filters').middleware); // zuletzt gewählte Filter pro Benutzer
  app.use(require('./routes/leader')); // Einsatzleiter: nur freigegebene Einsätze
  app.use(require('./routes/handy'));
  app.use(require('./routes/cockpit'));
  app.use(require('./routes/events'));
  app.use(require('./routes/registrations'));
  app.use(require('./routes/clarifications'));
  app.use(require('./routes/feedback'));
  app.use(require('./routes/persons'));
  app.use(require('./routes/forms'));
  app.use(require('./routes/handbook'));
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
