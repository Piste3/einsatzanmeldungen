'use strict';
const path = require('node:path');
const express = require('express');
const config = require('./config');
const auth = require('./auth');
const helpers = require('./lib/view-helpers');
const { createFrontend, securityHeaders, isBackendPath } = require('../frontend/server.cjs');

// Einstellungen, die auch der Frontend-Server braucht (Einbettung des Formulars, HTTPS, Reverse-Proxy)
const frontendSettings = () => ({
  formFrameAncestors: config.formFrameAncestors, secureCookies: config.secureCookies, trustProxy: config.trustProxy, isProd: config.isProd,
});

// Wem der Server die Absender-Adresse (X-Forwarded-For) glaubt.
// Getrennt: immer dem Frontend-Server direkt davor, dazu dem Reverse-Proxy (TRUST_PROXY).
function trustSetting(split) {
  if (!split) return config.trustProxy ? 1 : false;
  return (addr, i) => i === 0 || (i === 1 && config.trustProxy);
}

/**
 * split = true: nur Backend (Schnittstelle, Live, Microsoft-Login, Bilder des Handbuchs). Die Browser-App liefert frontend/server.cjs.
 * split = false: alles in einem Prozess (npm run dev, Tests).
 */
function createApp({ split = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustSetting(split));
  // Änderung unter Einstellungen › Server wirkt sofort
  config.onChange(() => app.set('trust proxy', trustSetting(split)));

  app.use((req, res, next) => { securityHeaders(req, res, frontendSettings()); next(); });

  // Einzelbetrieb: Seiten, Skripte und Stylesheets der Browser-App im selben Prozess
  if (!split) {
    const frontend = createFrontend({ settings: frontendSettings });
    app.use((req, res, next) => (isBackendPath(req.path) ? next() : frontend(req, res)));
  }

  app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.urlencoded({ extended: false, limit: '2mb', parameterLimit: 5000 }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  // Für den Frontend-Server: Einstellungen, die er für die Kopfzeilen braucht (nichts Geheimes)
  app.get('/api/v1/rahmen', (req, res) => res.json(frontendSettings()));

  // JSON-Schnittstelle für die Browser-App
  app.use('/api/v1', require('./api').createApi());

  // Microsoft-Anmeldung (Weiterleitungen) und Bilder des Handbuchs: direkt vom Server
  app.use(auth.loadSession);
  app.use(helpers.flashMiddleware);
  app.use(require('./routes/auth').microsoft);
  app.use('/handbuch/bilder', auth.requireLogin, express.static(path.join(require('./lib/handbook').DIR, 'bilder'), { maxAge: '1h' }));
  // Blockier-Meldungen des Browsers zum eingebetteten Formular
  app.use('/forms', require('./routes/public-form').cspReport);

  app.use((req, res) => res.status(404).json({ error: 'Nicht gefunden' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status === 404) return res.status(404).json({ error: 'Nicht gefunden' });
    console.error(err);
    res.status(500).json({ error: 'Ein unerwarteter Fehler ist aufgetreten.' });
  });
  return app;
}

module.exports = { createApp };
