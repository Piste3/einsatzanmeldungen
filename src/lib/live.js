'use strict';
// Live-Aktualisierung über WebSocket (Konzept 10.3).
// Seiten abonnieren Themen (z. B. «cockpit», «event:12»). Bei einer Änderung schickt der Server
// eine kurze Nachricht; die Seite lädt dann nur ihren Inhalt nach.
const { WebSocketServer } = require('ws');

const clients = new Set();
let pending = new Set();
let timer = null;

function attach(server, authenticate) {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/live')) return socket.destroy();
    const user = authenticate(req);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.user = user;
      ws.topics = new Set();
      ws.editing = null;
      ws.isAlive = true;
      clients.add(ws);
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', (raw) => onMessage(ws, raw));
      ws.on('close', () => {
        clients.delete(ws);
        if (ws.editing) broadcastPresence(ws.editing);
      });
    });
  });
  const ping = setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30000);
  ping.unref();
  return wss;
}

function onMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  if (msg.type === 'subscribe' && Array.isArray(msg.topics)) {
    ws.topics = new Set(msg.topics.map(String).slice(0, 20));
  } else if (msg.type === 'editing') {
    const before = ws.editing;
    ws.editing = typeof msg.key === 'string' ? msg.key.slice(0, 60) : null;
    if (before && before !== ws.editing) broadcastPresence(before);
    if (ws.editing) broadcastPresence(ws.editing);
  }
}

// Hinweis «wird gerade bearbeitet»: wer bearbeitet welchen Datensatz
function broadcastPresence(key) {
  const editors = [...clients].filter((c) => c.editing === key);
  for (const ws of clients) {
    if (!ws.topics.has(`presence:${key}`) && ws.editing !== key) continue;
    const others = editors.filter((e) => e !== ws && e.user.id !== ws.user.id).map((e) => e.user.display_name);
    send(ws, { type: 'presence', key, editors: [...new Set(others)] });
  }
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

// Änderungen kurz sammeln und gebündelt melden
function notify(...topics) {
  for (const t of topics.flat()) if (t) pending.add(String(t));
  if (!timer) {
    timer = setTimeout(flush, 150);
    timer.unref?.();
  }
}

function flush() {
  timer = null;
  const topics = [...pending];
  pending = new Set();
  // «*» erreicht jede Seite, die irgendeinen Zähler zeigt (Navigation)
  for (const ws of clients) {
    const hit = topics.filter((t) => ws.topics.has(t) || ws.topics.has('*'));
    send(ws, { type: 'changed', topics: hit, nav: true });
  }
}

function clientCount() {
  return clients.size;
}

// Beim Herunterfahren alle Verbindungen schliessen (Code 1012 = Neustart; die Seiten verbinden sich neu)
function closeAll() {
  for (const ws of clients) ws.close(1012, 'Neustart');
}

module.exports = { attach, notify, clientCount, closeAll };
