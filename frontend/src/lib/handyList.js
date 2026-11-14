// Kartenliste der Handy-App: Karten bleiben bis zum Neuladen am Platz (auch wenn sie den Reiter wechseln).
// Live-Änderungen tauschen Karten einzeln aus. Eine Karte, in der gerade jemand tippt, wartet, bis sie frei ist.
import { ref, watch, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { setSteps } from './handy.js';
import { session } from './api.js';

const cardBusy = (el) => el.classList.contains('is-busy') || el.contains(document.activeElement)
  || el.querySelector('details[open]') !== null || [...el.querySelectorAll('.hc-shifts')].some((p) => !p.hidden);
const same = (a, b) => JSON.stringify({ ...a, _v: 0, _saved: 0 }) === JSON.stringify({ ...b, _v: 0, _saved: 0 });

export function useCards(page, { list = (d) => d.list || [], domId, answerOf = (c) => c.answer } = {}) {
  const route = useRoute();
  const cards = ref([]);
  const start = ref(new Map());
  let fresh = true;
  let retry = null;

  const snapshot = () => { start.value = new Map(cards.value.map((c) => [domId(c), answerOf(c)])); };

  function merge(next) {
    let waiting = false;
    const out = cards.value.slice();
    let prevIdx = -1;
    for (const item of next) {
      const id = domId(item);
      const idx = out.findIndex((c) => domId(c) === id);
      if (idx < 0) {
        // Neue Karte (z. B. neue Anmeldung): nach der vorherigen Karte einfügen
        out.splice(prevIdx + 1, 0, { ...item, _saved: true, _v: 0 });
        prevIdx += 1;
        continue;
      }
      prevIdx = idx;
      if (same(out[idx], item)) continue;
      const el = document.getElementById(id);
      if (el && cardBusy(el)) { waiting = true; continue; }
      out[idx] = { ...item, _v: out[idx]._v || 0 };
    }
    cards.value = out;
    clearTimeout(retry);
    if (waiting) retry = setTimeout(() => page.refresh(), 2000);
  }

  watch(() => route.fullPath, () => { fresh = true; });
  watch(page.data, (d) => {
    if (!d) return;
    setSteps(d.handySteps);
    const next = list(d);
    if (fresh) { cards.value = next.map((c) => ({ ...c, _v: 0 })); fresh = false; } else merge(next);
    snapshot();
  });

  // Eigene Aktion: Karte frisch zeichnen (Bemerkung zu, Schichten zu)
  function update(i, patch) {
    const old = cards.value[i];
    cards.value[i] = { ...patch, _saved: true, _v: (old._v || 0) + 1 };
  }
  // Knopf ↻ und Rückgängig: ganze Liste neu, wie beim Neuladen
  function hardReload() { fresh = true; return page.reload({ quiet: true }); }

  // Zähler in den Reitern nachführen (Karten bleiben bis zum Neuladen am Platz)
  function delta() {
    const d = { offen: 0, kann: 0, kann_nicht: 0 };
    for (const c of cards.value) {
      const before = start.value.get(domId(c));
      const now = answerOf(c);
      if (before && before !== now) { d[before] -= 1; d[now] += 1; }
    }
    return d;
  }

  // Nach dem Aufwecken des Handys (App im Hintergrund) einmal nachladen
  const onVisible = () => { if (document.visibilityState === 'visible' && session.liveTopics.length) page.refresh(); };
  onMounted(() => document.addEventListener('visibilitychange', onVisible));
  onUnmounted(() => { document.removeEventListener('visibilitychange', onVisible); clearTimeout(retry); });

  return { cards, update, hardReload, delta };
}

// Suche nach Namen (sofort, ohne Neuladen)
export const matches = (q, name) => !q.trim() || name.includes(q.trim().toLowerCase());
