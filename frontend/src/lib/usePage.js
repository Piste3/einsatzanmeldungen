// Gemeinsame Logik jeder Seite: Daten laden, bei Live-Meldungen auffrischen, Ladezustand und Fehler.
import { ref, watch, onUnmounted, nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { page, session, navigate, ApiError, onSameRoute } from './api.js';
import { subscribe, unsubscribe } from './live.js';
import { dirtySections } from './section.js';

// Während jemand etwas bearbeitet (offenes Fenster, ungespeicherte Tabelle), wartet die Live-Aktualisierung
const busy = () => dirtySections.size > 0 || document.querySelector('dialog[open]') !== null;

// Zurück/Vor: Der Router wartet mit dem Scrollen, bis die neue Seite ihre Daten hat
let waiters = [];
export function whenPageLoaded(timeout = 3000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { waiters = waiters.filter((w) => w !== done); resolve(); }, timeout);
    function done() { clearTimeout(t); resolve(); }
    waiters.push(done);
  });
}
function pageLoaded() {
  const list = waiters;
  waiters = [];
  nextTick(() => requestAnimationFrame(() => list.forEach((w) => w())));
}

export function usePage(pathFn, { live = true } = {}) {
  const route = useRoute();
  const env = ref(null);
  const data = ref({});
  const error = ref(null);
  const loading = ref(true);

  async function load({ quiet = false } = {}) {
    if (!quiet) loading.value = true;
    try {
      const e = await page(pathFn(route));
      if (e.redirect) { await navigate(e.redirect); return; }
      env.value = e;
      data.value = e.data;
      session.title = e.title;
      session.liveTopics = e.liveTopics || [];
      error.value = null;
      if (!quiet) pageLoaded();
      if (live) subscribe(e.liveTopics, liveChange);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (!quiet) error.value = err;
    } finally {
      loading.value = false;
    }
  }

  let waiting = null;
  // Live: neue oder geänderte Zeilen (data-row-id) kurz hervorheben, wie bisher
  async function liveLoad() {
    const ids = (root) => new Set([...root.querySelectorAll('[data-row-id]')].map((e) => e.dataset.rowId));
    const content = document.getElementById('content');
    const before = content ? ids(content) : new Set();
    await load({ quiet: true });
    await nextTick();
    const now = document.getElementById('content');
    if (!now || !before.size) return;
    now.querySelectorAll('[data-row-id]').forEach((e) => {
      if (before.has(e.dataset.rowId)) return;
      e.classList.remove('flash-new');
      void e.offsetWidth;
      e.classList.add('flash-new');
    });
  }
  function liveChange() {
    if (!busy()) { liveLoad(); return; }
    if (waiting) return;
    waiting = setInterval(() => { if (!busy()) { clearInterval(waiting); waiting = null; liveLoad(); } }, 1500);
  }

  watch(() => route.fullPath, () => load(), { immediate: true });
  const refresh = () => load({ quiet: true });
  const offSame = onSameRoute(refresh);
  onUnmounted(() => { unsubscribe(liveChange); clearInterval(waiting); offSame(); });
  return { env, data, error, loading, refresh, reload: load };
}
