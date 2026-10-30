'use strict';
// Authentifizierung: austauschbare Anmeldeverfahren («Provider») + gemeinsame Sitzungen und Rechte.
const crypto = require('node:crypto');
const config = require('../config');
const sessions = require('./sessions');

const ALL_PROVIDERS = [require('./providers/local'), require('./providers/microsoft')];

function providers() {
  return ALL_PROVIDERS.filter((p) => config.authProviders.includes(p.id) && p.enabled());
}

function provider(id) {
  return providers().find((p) => p.id === id) || null;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); }
  }
  return out;
}

// Lädt Sitzung und Benutzer in req.user / res.locals
function loadSession(req, res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  const token = req.cookies[sessions.COOKIE];
  const found = sessions.lookup(token);
  if (found) {
    req.user = found.user;
    req.session = found.session;
    req.sessionToken = token;
  } else if (token) {
    res.clearCookie(sessions.COOKIE, { path: '/' });
  }
  res.locals.user = req.user || null;
  res.locals.csrfToken = req.session?.csrf_token || '';
  next();
}

// Für die WebSocket-Verbindung
function userFromRequest(req) {
  const token = parseCookies(req.headers.cookie)[sessions.COOKIE];
  return sessions.lookup(token, { touch: false })?.user || null;
}

function login(req, res, user) {
  // Neue Sitzung bei jedem Login (Schutz vor Session Fixation)
  if (req.sessionToken) sessions.destroy(req.sessionToken);
  const { token, expires } = sessions.create(user.id, req);
  res.cookie(sessions.COOKIE, token, sessions.cookieOptions(expires));
}

function logout(req, res) {
  sessions.destroy(req.sessionToken);
  res.clearCookie(sessions.COOKIE, { path: '/' });
}

function requireLogin(req, res, next) {
  if (!req.user) {
    if (req.method === 'GET' && !req.xhr) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    return res.status(401).send('Nicht angemeldet');
  }
  // Erzwungener Passwortwechsel (z. B. nach Zurücksetzen durch den Admin)
  if (req.user.must_change_password && req.user.auth_provider === 'local' && !req.path.startsWith('/konto/passwort')) {
    return res.redirect('/konto/passwort');
  }
  // Pflicht zur Zwei-Faktor-Anmeldung: zuerst einrichten
  if (require('./twofa').mustSetUp(req.user) && !req.path.startsWith('/konto/2fa') && !req.path.startsWith('/konto/passwort')) {
    if (req.method === 'GET') return res.redirect('/konto/2fa');
    return res.status(403).send('Bitte zuerst die Zwei-Faktor-Anmeldung einrichten.');
  }
  next();
}

function isAdmin(user) {
  return user?.role === 'admin';
}

// Rechte werden serverseitig auf jeder Route geprüft, nicht nur im Menü ausgeblendet
function requireAdmin(req, res, next) {
  if (!isAdmin(req.user)) {
    return res.status(403).render('pages/error', { title: 'Kein Zugriff', message: 'Diese Seite ist nur für Admins.' });
  }
  next();
}

// CSRF-Schutz für alle Änderungen durch angemeldete Benutzer
function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = String(req.body?._csrf || req.query?._csrf || req.headers['x-csrf-token'] || '');
  const expected = req.session?.csrf_token || '';
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  if (!expected || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).render('pages/error', {
      title: 'Sitzung abgelaufen',
      message: 'Das Formular ist abgelaufen. Bitte die Seite neu laden und erneut versuchen.',
    });
  }
  next();
}

module.exports = {
  providers, provider, parseCookies, loadSession, userFromRequest, login, logout, requireLogin, requireAdmin, isAdmin, csrfProtect,
};
