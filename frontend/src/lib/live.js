// Live-Aktualisierung über WebSocket /live. Bei einer Änderung lädt die Ansicht ihre Daten neu.
// Vue ersetzt nur geänderte Stellen. Offene Eingaben, Dialoge und die Scrollposition bleiben deshalb erhalten.
import { reactive } from 'vue';
import { session } from './api.js';

let ws = null;
let topics = [];
let handler = null;
let retry = 1000;
let timer = null;
let wanted = false;

export const liveState = reactive({ connected: false });

function connect() {
  if (!wanted) return;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/live`);
  ws.addEventListener('open', () => {
    retry = 1000;
    liveState.connected = true;
    ws.send(JSON.stringify({ type: 'subscribe', topics }));
  });
  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type !== 'changed') return;
    clearTimeout(timer);
    timer = setTimeout(() => handler && handler(msg), 250);
  });
  ws.addEventListener('close', () => {
    liveState.connected = false;
    if (wanted) setTimeout(connect, retry);
    retry = Math.min(retry * 2, 30000);
  });
}

// Eine Ansicht meldet ihre Themen an. Sie bekommt bei Änderungen einen Aufruf von handler().
export function subscribe(newTopics, onChange) {
  topics = newTopics || [];
  handler = onChange;
  wanted = topics.length > 0 && !!session.user;
  if (!wanted) { if (ws) ws.close(); ws = null; return; }
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'subscribe', topics }));
  else if (!ws || ws.readyState > 1) connect();
}

export function unsubscribe(onChange) {
  if (handler === onChange) { handler = null; topics = []; if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'subscribe', topics: [] })); }
}
