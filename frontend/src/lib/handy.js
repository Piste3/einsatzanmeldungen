// Handy-App «Anfragen»: gemeinsamer Zustand und Hilfen (wie public/js/handy.js und die Vorlagen views/handy/*)
import { reactive, ref } from 'vue';
import { request, session, ApiError } from './api.js';
import { dates, labels } from './format.js';

export const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privates Fenster */ } },
};

// Knöpfe «Rückgängig» und «Wiederholen» oben
export const steps = reactive({ undo: null, redo: null });
export function setSteps(st) { if (st) { steps.undo = st.undo || null; steps.redo = st.redo || null; } }

// Kurze Meldung unten
export const toastState = reactive({ text: '', error: false, shown: false });
let toastTimer = null;
export function toast(text, isError = false) {
  toastState.text = text;
  toastState.error = isError;
  toastState.shown = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastState.shown = false; }, isError ? 6000 : 2500);
}

// Eigene Rückfrage statt confirm() (gleiches Aussehen wie bisher)
export function ask(text, { title = '', ok = 'Ja' } = {}) {
  return new Promise((resolve) => {
    if (typeof HTMLDialogElement === 'undefined') return resolve(window.confirm(text));
    const d = document.createElement('dialog');
    d.className = 'h-dialog';
    const p = document.createElement('p'); p.textContent = text;
    const h = document.createElement('h2'); h.textContent = title;
    const row = document.createElement('div');
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn btn-ghost'; no.textContent = 'Abbrechen';
    const yes = document.createElement('button'); yes.type = 'button'; yes.className = 'btn btn-danger'; yes.textContent = ok;
    const close = (v) => { d.close(); d.remove(); resolve(v); };
    no.addEventListener('click', () => close(false));
    yes.addEventListener('click', () => close(true));
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    row.append(no, yes); if (title) d.append(h); d.append(p, row); document.body.append(d);
    d.showModal(); yes.focus();
  });
}

// «Gefragt per» gilt für alle Karten und bleibt auf dem Handy gespeichert
const CHANNELS = ['muendlich', 'telefon', 'whatsapp'];
export const channel = ref(CHANNELS.includes(store.get('h-channel')) ? store.get('h-channel') : 'muendlich');
// Wechsel oben: Ausnahmen einzelner Karten (Anrufen/WhatsApp in der Karte) fallen weg
export const channelRound = ref(0);
export function setChannel(v) {
  channel.value = v;
  store.set('h-channel', v);
  channelRound.value += 1;
}

// Aktion einer Karte: Antwort ohne Neuladen, nur die Karte kommt zurück
export async function cardAction(path, body) {
  try {
    const env = await request('POST', path, body, { 'X-Requested-With': 'XMLHttpRequest' });
    setSteps(env.data?.handySteps);
    steps.redo = null; // neue Aktion: nichts mehr zum Wiederholen
    return { data: env.data };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) return { error: true };
      return { error: e.status === 0 ? 'Keine Verbindung. Bitte nochmals tippen.' : e.body?.text ? e.body.error : 'Speichern ging nicht. Bitte oben neu laden.' };
    }
    throw e;
  }
}

// ---------- Anzeige-Hilfen wie in den Vorlagen ----------
export const tel = (mobile) => (mobile ? mobile.replace(/[^\d+]/g, '') : '');
export function waLink(mobile) {
  let d = String(mobile || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `41${d.slice(1)}`;
  return /^\d{8,15}$/.test(d) ? `https://wa.me/${d}` : null;
}
export const timeOf = (e) => [e.start_time, e.end_time].filter(Boolean).join('–');
export const eventSub = (e) => dates.fmtEventDate(e, 'wd') + (e.start_time ? ` · ${timeOf(e)}` : '');
export function facts(e) {
  const place = e.start_place && e.end_place && e.end_place !== e.start_place ? `${e.start_place} → ${e.end_place}` : (e.start_place || e.end_place || '');
  const el = e.leader_person_id && e.leader_first ? `${e.leader_rank ? `${e.leader_rank} ` : ''}${e.leader_first} ${e.leader_last}` : '';
  return { time: timeOf(e), place, el, elTel: tel(e.leader_mobile) };
}
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export { dates, labels, session };

// Adresse mit Abfrage (leere Werte fallen weg)
export function withQuery(base, query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, v);
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

// Handy erkannt: passende Seite der Handy-App für eine Seite des Einsatzplaners (wie src/routes/handy.js)
export function handyTarget(path) {
  let m = path.match(/^\/einsaetze\/(\d+)\/anmeldungen$/);
  if (m) return `/handy/einsatz/${m[1]}/anmeldungen`;
  m = path.match(/^\/einsaetze\/(\d+)(\/.*)?$/);
  if (m) return `/handy/einsatz/${m[1]}`;
  m = path.match(/^\/personen\/(\d+)$/);
  if (m) return `/handy/personen/${m[1]}`;
  if (path === '/personen' || path.startsWith('/rueckmeldungen')) return '/handy/personen';
  return '/handy';
}
export const KEEP_PC = /^\/(handy|handbuch|konto|login|setup)(\/|$)/;
export const inHandy = () => session.phone && !session.pcView;
