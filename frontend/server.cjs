'use strict';
// Frontend-Server: liefert die Browser-App (frontend/dist) und die Stylesheets (public) aus
// und leitet Daten-Anfragen an den Backend-Server weiter. Er hat keinen Zugriff auf die Datenbank.
//
// Getrennter Betrieb (Standard über «npm start»): dieser Prozess auf PORT (z. B. 3010),
// das Backend auf API_PORT (z. B. 3011, nur 127.0.0.1). Ohne Backend zeigt die App «Server kurz nicht erreichbar».
// Einzelbetrieb («npm run dev», Tests): src/app.js nutzt createFrontend() direkt im selben Prozess.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(__dirname, 'dist');
const PUBLIC = path.join(ROOT, 'public');

// Adressen, die der Backend-Server beantwortet
const BACKEND_PATHS = [/^\/api\//, /^\/live$/, /^\/auth\/microsoft(\/|$)/, /^\/handbuch\/bilder\//, /^\/forms\/csp-bericht$/, /^\/health$/];
const isBackendPath = (p) => BACKEND_PATHS.some((re) => re.test(p));

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

// Sicherheits-Header (gleich für Frontend und Backend). Das öffentliche Formular darf nur von ClubDesk eingebettet werden.
function securityHeaders(req, res, settings) {
  const p = (req.url || '').split('?')[0];
  const isForm = p.startsWith('/forms/');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "script-src 'self'", "connect-src 'self'",
    "form-action 'self'", "base-uri 'none'", "object-src 'none'",
    `frame-ancestors ${isForm ? settings.formFrameAncestors : "'none'"}`,
    ...(isForm ? ['report-uri /forms/csp-bericht'] : []),
  ].join('; '));
  if (!isForm) res.setHeader('X-Frame-Options', 'DENY');
  if (settings.secureCookies) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
}

// Version der Stylesheets für die Adresse (?v=…): Nach einem Update lädt der Browser sie neu
function assetVersion() {
  const hash = crypto.createHash('sha1');
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else hash.update(fs.readFileSync(full));
    }
  };
  walk(PUBLIC);
  return hash.digest('hex').slice(0, 10);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Datei aus einem Ordner senden; nie ausserhalb des Ordners
function sendFile(req, res, dir, rel, cache) {
  let name;
  try { name = decodeURIComponent(rel); } catch { return false; }
  const file = path.resolve(dir, `.${path.posix.normalize(`/${name}`)}`);
  if (!file.startsWith(dir + path.sep)) return false;
  let st;
  try { st = fs.statSync(file); } catch { return false; }
  if (!st.isFile()) return false;
  res.statusCode = 200;
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Content-Length', st.size);
  res.setHeader('Last-Modified', st.mtime.toUTCString());
  res.setHeader('Cache-Control', cache);
  if (req.method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(file).pipe(res);
  return true;
}

/**
 * Teil «Browser-App»: Seiten, Skripte, Stylesheets, Manifest, Service Worker.
 * settings(): { formFrameAncestors, secureCookies, isProd } – kommt vom Backend (getrennt) oder aus config (Einzelbetrieb).
 */
function createFrontend({ settings }) {
  const v = assetVersion();
  // Seiten der App: Version der Stylesheets einsetzen; neu lesen, wenn ein neuer Build da ist
  const pages = new Map();
  function page(file) {
    const full = path.join(DIST, file);
    const mtime = fs.statSync(full).mtimeMs;
    const hit = pages.get(file);
    if (hit && hit.mtime === mtime) return hit.html;
    const html = fs.readFileSync(full, 'utf8').replace(/(href="\/static\/css\/[a-z-]+\.css)"/g, `$1?v=${v}"`);
    pages.set(file, { mtime, html });
    return html;
  }

  return function frontend(req, res) {
    const s = settings();
    securityHeaders(req, res, s);
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 404, { error: 'Nicht gefunden' });

    if (p.startsWith('/static/') && sendFile(req, res, PUBLIC, p.slice('/static/'.length), s.isProd ? 'public, max-age=604800' : 'no-cache')) return undefined;
    // Gebaute Skripte haben einen Hash im Namen: dürfen lange im Cache bleiben
    if (p.startsWith('/assets/')) {
      if (sendFile(req, res, path.join(DIST, 'assets'), p.slice('/assets/'.length), 'public, max-age=31536000, immutable')) return undefined;
      return sendJson(res, 404, { error: 'Nicht gefunden' });
    }
    // Handy-App: Manifest und Service Worker ohne Login (der Browser lädt sie ohne Cookies)
    if (p === '/manifest.webmanifest') return sendFile(req, res, PUBLIC, 'manifest.webmanifest', 'no-cache');
    if (p === '/sw.js') return sendFile(req, res, PUBLIC, 'js/sw.js', 'no-cache');

    // Seiten nie aus dem Browser-Cache zeigen: Beim Zurückgehen lädt der Browser den aktuellen Stand
    res.setHeader('Cache-Control', 'no-store');
    const wantsHtml = /text\/html|\*\/\*/.test(req.headers.accept || '*/*');
    if (!wantsHtml || p.startsWith('/static/')) return sendJson(res, 404, { error: 'Nicht gefunden' });
    let html;
    try {
      // Anmeldeformular: eigener, kleiner Einstieg (lädt im ClubDesk-iFrame ohne die ganze App)
      html = page(/^\/forms(\/|$)/.test(p) ? 'form.html' : 'index.html');
    } catch {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.end('Die Browser-App ist noch nicht gebaut. Bitte «npm run build» im Ordner frontend ausführen.');
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(req.method === 'HEAD' ? undefined : html);
  };
}

/**
 * Weiterleitung an den Backend-Server (HTTP und WebSocket /live).
 * Die echte Adresse des Browsers geht in X-Forwarded-For mit; Host und Cookies bleiben unverändert.
 */
function createProxy({ backend, settings }) {
  const target = new URL(backend);
  const forwarded = (req) => {
    const h = { ...req.headers };
    const ip = req.socket.remoteAddress || '';
    // Ohne vertrauten Reverse-Proxy davor zählen nur die eigenen Angaben (ein Browser kann diese Köpfe fälschen)
    const trust = settings().trustProxy;
    h['x-forwarded-for'] = trust && h['x-forwarded-for'] ? `${h['x-forwarded-for']}, ${ip}` : ip;
    if (!trust || !h['x-forwarded-proto']) h['x-forwarded-proto'] = req.socket.encrypted ? 'https' : 'http';
    if (!trust || !h['x-forwarded-host']) h['x-forwarded-host'] = h.host || '';
    return h;
  };
  const offline = (res) => {
    if (res.headersSent) return res.destroy();
    return sendJson(res, 503, { error: 'Der Server ist kurz nicht erreichbar.', offline: true });
  };

  function web(req, res) {
    const up = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers: forwarded(req) }, (r) => {
      res.writeHead(r.statusCode, r.statusMessage, r.rawHeaders);
      r.pipe(res);
    });
    up.on('error', () => offline(res));
    req.pipe(up);
  }

  function upgrade(req, socket, head) {
    const up = net.connect(Number(target.port), target.hostname, () => {
      const h = forwarded(req);
      const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(h).flatMap(([k, val]) => [].concat(val).map((x) => `${k}: ${x}`)), '', ''];
      up.write(lines.join('\r\n'));
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    const close = () => { up.destroy(); socket.destroy(); };
    up.on('error', close);
    socket.on('error', close);
  }

  return { web, upgrade };
}

// Einstellungen vom Backend holen (Einbettung des Formulars, HTTPS); kurz zwischenspeichern,
// damit eine Änderung unter Einstellungen › Server nach wenigen Sekunden wirkt
function remoteSettings(backend) {
  let current = {
    formFrameAncestors: "'self'", secureCookies: process.env.NODE_ENV === 'production', trustProxy: false, isProd: process.env.NODE_ENV === 'production',
  };
  let at = 0;
  let loading = false;
  function load() {
    if (loading) return;
    loading = true;
    http.get(new URL('/api/v1/rahmen', backend), { headers: { accept: 'application/json' } }, (r) => {
      let body = '';
      r.setEncoding('utf8');
      r.on('data', (c) => { body += c; });
      r.on('end', () => {
        loading = false;
        try { if (r.statusCode === 200) { current = { ...current, ...JSON.parse(body) }; at = Date.now(); } } catch { /* alter Stand bleibt */ }
      });
    }).on('error', () => { loading = false; });
  }
  load();
  return {
    get() { if (Date.now() - at > 5000) load(); return current; },
    ready: () => new Promise((resolve) => {
      const t0 = Date.now();
      const wait = () => (at || Date.now() - t0 > 10000 ? resolve() : setTimeout(() => { load(); wait(); }, 200));
      wait();
    }),
  };
}

// HTTP-Server der Browser-App: eigene Dateien selbst, alles andere ans Backend
function createFrontendServer({ backend }) {
  const remote = remoteSettings(backend);
  const settings = () => remote.get();
  const frontend = createFrontend({ settings });
  const proxy = createProxy({ backend, settings });
  const server = http.createServer((req, res) => {
    const p = (req.url || '/').split('?')[0];
    if (isBackendPath(p)) return proxy.web(req, res);
    return frontend(req, res);
  });
  server.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] === '/live') return proxy.upgrade(req, socket, head);
    return socket.destroy();
  });
  return { server, ready: remote.ready };
}

function start() {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const backend = process.env.BACKEND_URL || `http://127.0.0.1:${process.env.API_PORT || port + 1}`;
  const { server, ready } = createFrontendServer({ backend });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\nPort ${port} ist bereits belegt – läuft der Einsatzplaner schon? Mit stop.cmd / stop.sh beenden oder in der .env einen anderen PORT wählen.\n`);
      process.exit(1);
    }
    throw err;
  });
  // Erst starten, wenn die Einstellungen vom Backend da sind (höchstens 10 Sekunden warten)
  ready().then(() => server.listen(port, host, () => console.log(`Browser-App läuft auf Port ${port} (Daten vom Backend ${backend})`)));

  const shutdown = (code = 0) => {
    server.close(() => process.exit(code));
    server.closeAllConnections?.();
    setTimeout(() => process.exit(code), 3000).unref();
  };
  process.on('SIGTERM', () => shutdown(0));
  process.on('SIGINT', () => shutdown(0));
  if (process.send) process.on('disconnect', () => shutdown(0));
}

module.exports = { createFrontend, createProxy, createFrontendServer, securityHeaders, isBackendPath };

if (require.main === module) start();
