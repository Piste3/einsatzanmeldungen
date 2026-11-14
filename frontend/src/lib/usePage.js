// Gemeinsame Logik jeder Seite: Daten laden, bei Live-Meldungen auffrischen, Ladezustand und Fehler.
import { ref, watch, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { page, session, navigate, ApiError } from './api.js';
import { subscribe, unsubscribe } from './live.js';
import { dirtySections } from './section.js';

// Während jemand etwas bearbeitet (offenes Fenster, ungespeicherte Tabelle), wartet die Live-Aktualisierung
const busy = () => dirtySections.size > 0 || document.querySelector('dialog[open]') !== null;

export function usePage(pathFn) {
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
      subscribe(e.liveTopics, liveChange);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (!quiet) error.value = err;
    } finally {
      loading.value = false;
    }
  }

  let waiting = null;
  function liveChange() {
    if (!busy()) { load({ quiet: true }); return; }
    if (waiting) return;
    waiting = setInterval(() => { if (!busy()) { clearInterval(waiting); waiting = null; load({ quiet: true }); } }, 1500);
  }

  watch(() => route.fullPath, () => load(), { immediate: true });
  const refresh = () => load({ quiet: true });
  onUnmounted(() => { unsubscribe(); clearInterval(waiting); });
  return { env, data, error, loading, refresh, reload: load };
}
