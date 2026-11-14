// Gemeinsame Logik jeder Seite: Daten laden, bei Live-Meldungen auffrischen, Ladezustand und Fehler.
import { ref, watch, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { page, session, navigate, ApiError } from './api.js';
import { subscribe, unsubscribe } from './live.js';

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
      subscribe(e.liveTopics, () => load({ quiet: true }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (!quiet) error.value = err;
    } finally {
      loading.value = false;
    }
  }

  watch(() => route.fullPath, () => load(), { immediate: true });
  const refresh = () => load({ quiet: true });
  onUnmounted(() => unsubscribe());
  return { env, data, error, loading, refresh, reload: load };
}
