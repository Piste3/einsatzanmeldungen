// Filter einer Liste: stehen in der Adresse (wie bisher) und wirken sofort.
// Auswahlfelder und Daten wirken direkt, Textfelder nach einer kurzen Pause beim Tippen.
import { reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

export function useFilters(fields) {
  const route = useRoute();
  const router = useRouter();
  const f = reactive({});
  const sync = () => { for (const [k, def] of Object.entries(fields)) f[k] = route.query[k] ?? def; };
  sync();
  watch(() => route.query, sync);

  let timer = null;
  function apply(delay = 0) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const query = {};
      for (const k of Object.keys(fields)) query[k] = f[k] ?? '';
      router.replace({ path: route.path, query });
    }, delay);
  }
  return { f, apply, typed: () => apply(350) };
}

// Adresse für einen Download (PDF, Excel, CSV) über die Schnittstelle
export function apiUrl(path, query = {}, changes = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...changes })) if (v !== undefined && v !== null && v !== '') params.set(k, v);
  const s = params.toString();
  return `/api/v1${path}${s ? `?${s}` : ''}`;
}
