'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const helpers = require('./lib/view-helpers');

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

  // Browser-App (Vue, gebaut in frontend/dist mit «npm run build»): liefert die Seiten aus.
  // Die Daten holt sie über /api/v1. Der Server erzeugt selbst kein HTML mehr.
  const appDist = path.join(__dirname, '..', 'frontend', 'dist');
  const page = (file) => {
    let html = null;
    return (req, res) => {
      // Stylesheets mit Version in der Adresse: Nach einem Update holt der Browser sie neu
      if (!html || !config.isProd) {
        html = require('node:fs').readFileSync(path.join(appDist, file), 'utf8')
          .replace(/(href="\/static\/css\/[a-z-]+\.css)"/g, `$1?v=${app.locals.v}"`);
      }
      res.type('html').send(html);
    };
  };
  app.use('/assets', express.static(path.join(appDist, 'assets'), { maxAge: '365d', immutable: true, fallthrough: false }));

  // JSON-Schnittstelle für die Browser-App
  app.use('/api/v1', require('./api').createApi());

  // Microsoft-Anmeldung (Weiterleitungen) und Bilder des Handbuchs: direkt vom Server
  app.use(auth.loadSession);
  app.use(helpers.flashMiddleware);
  app.use(require('./routes/auth').microsoft);
  app.use('/handbuch/bilder', auth.requireLogin, express.static(path.join(require('./lib/handbook').DIR, 'bilder'), { maxAge: '1h' }));

  // Anmeldeformular: eigener, kleiner Einstieg (lädt im ClubDesk-iFrame ohne die ganze App)
  app.get(/^\/forms(\/.*)?$/, page('form.html'));
  app.use('/forms', require('./routes/public-form').cspReport);
  // Alle übrigen Adressen zeigt die Browser-App (Vue Router)
  const indexPage = page('index.html');
  app.get(/^\/(?!api\/|static\/|assets\/|live$).*/, (req, res, next) => (req.accepts('html') ? indexPage(req, res) : next()));

  app.use((req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // Fehlende Datei (z. B. alte Adresse unter /assets nach einem Update): nur «nicht gefunden»
    if (err.status === 404) return res.status(404).json({ error: 'Nicht gefunden' });
    console.error(err);
    res.status(500).json({ error: 'Ein unerwarteter Fehler ist aufgetreten.' });
  });
  return app;
}

module.exports = { createApp };
