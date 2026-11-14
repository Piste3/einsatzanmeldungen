// Live-Aktualisierung über WebSocket /live. Bei einer Änderung lädt die Ansicht ihre Daten neu.
// Vue ersetzt nur geänderte Stellen. Offene Eingaben, Dialoge und die Scrollposition bleiben deshalb erhalten.
import { reactive } from 'vue';
import { session, request } from './api.js';

let ws = null;
let topics = [];
let handler = null;
let retry = 1000;
let timer = null;
let wanted = false;

export const liveState = reactive({ connected: false, editors: [] });
let editKey = null; // Datensatz, den diese Seite gerade bearbeitet (z. B. event:3)
const allTopics = () => [...topics, editKey ? `presence:${editKey}` : null].filter(Boolean);

function connect() {
  if (!wanted) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/live`);
  ws.addEventListener('open', () => {
    retry = 1000;
    liveState.connected = true;
    ws.send(JSON.stringify({ type: 'subscribe', topics: allTopics() }));
    if (editKey) ws.send(JSON.stringify({ type: 'editing', key: editKey }));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'presence') { if (msg.key === editKey) liveState.editors = msg.editors || []; return; }
    if (msg.type !== 'changed') return;
    // Nur die Zähler in der Navigation haben sich geändert: Seite bleibt, nur die Zähler kommen neu
    if (!msg.topics?.length) { if (msg.nav) refreshNav(); return; }
    clearTimeout(timer);
    timer = setTimeout(() => handler && handler(msg), 250);
  });
  ws.addEventListener('close', () => {
    liveState.connected = false;
    if (wanted) setTimeout(connect, retry);
    retry = Math.min(retry * 2, 30000);
  });
}

let navTimer = null;
function refreshNav() {
  clearTimeout(navTimer);
  navTimer = setTimeout(async () => {
    try { const r = await request('GET', '/nav'); if (r?.nav) session.nav = r.nav; } catch { /* nächstes Mal */ }
  }, 250);
}

// Eine Ansicht meldet ihre Themen an. Sie bekommt bei Änderungen einen Aufruf von handler().
export function subscribe(newTopics, onChange) {
  topics = newTopics || [];
  handler = onChange;
  sync();
}

function sync() {
  wanted = (topics.length > 0 || Boolean(editKey)) && !!session.user;
  if (!wanted) { if (ws) ws.close(); ws = null; return; }
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'subscribe', topics: allTopics() }));
    ws.send(JSON.stringify({ type: 'editing', key: editKey }));
  } else if (!ws || ws.readyState > 1) connect();
}

// Bearbeitungsseite: andere sehen «wird gerade von … bearbeitet», diese Seite sieht die anderen
export function setEditing(key) {
  editKey = key || null;
  liveState.editors = [];
  sync();
}

export function unsubscribe(onChange) {
  if (onChange && handler !== onChange) return;
  handler = null;
  topics = [];
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'subscribe', topics: allTopics() }));
}
