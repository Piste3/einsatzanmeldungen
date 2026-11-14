// Filter einer Liste: stehen in der Adresse (wie bisher) und wirken sofort.
// Auswahlfelder und Daten wirken direkt, Textfelder nach einer kurzen Pause beim Tippen.
import { reactive, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

// effective: optional, liefert die Filter, die der Server wirklich angewendet hat (z. B. gespeicherte Filter des Benutzers).
// Ein Feld, das der Benutzer gerade ändert (noch nicht angewendet), bleibt unberührt.
export function useFilters(fields, effective = null) {
  const route = useRoute();
  const router = useRouter();
  const f = reactive({});
  const fromRoute = (k) => route.query[k] ?? fields[k];
  const sync = () => { for (const k of Object.keys(fields)) f[k] = fromRoute(k); };
  sync();
  watch(() => route.query, sync);
  if (effective) {
    watch(effective, (eff) => {
      if (!eff) return;
      for (const k of Object.keys(fields)) {
        if (eff[k] === undefined || eff[k] === null) continue;
        if (String(f[k] ?? '') === String(fromRoute(k) ?? '')) f[k] = String(eff[k]);
      }
    }, { immediate: true });
  }

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
