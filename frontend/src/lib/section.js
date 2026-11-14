// Abschnitte mit einem Speichern-Knopf für eine ganze Tabelle: geänderte Zeilen markieren,
// Hinweis «Ungespeicherte Änderungen» zeigen und Live-Aktualisierungen solange zurückhalten.
// Die Felder sind ungebunden (:value); verglichen wird mit dem Stand nach dem letzten Laden.
import { ref, watch, nextTick, onUnmounted } from 'vue';

export const dirtySections = new Set();

const fields = (form) => [...form.querySelectorAll('input, select, textarea')].filter((el) => !['hidden', 'submit', 'button'].includes(el.type) && !el.disabled);

// Wie bisher: verglichen wird mit dem Vorgabewert aus den Daten (defaultValue, defaultChecked, defaultSelected).
// Die Felder binden deshalb :defaultValue statt :value; Vue setzt :value bei jedem Neuzeichnen zurück.
export function fieldChanged(el) {
  if (el.type === 'checkbox' || el.type === 'radio') return el.checked !== el.defaultChecked;
  if (el.tagName === 'SELECT') {
    if (el.multiple) return [...el.options].some((o) => o.selected !== o.defaultSelected);
    const def = [...el.options].findIndex((o) => o.defaultSelected);
    return el.selectedIndex !== (def === -1 ? 0 : def);
  }
  return el.value !== el.defaultValue;
}

export function useSection(formRef, sourceRef) {
  const dirty = ref(false);
  function mark() {
    const f = formRef.value;
    if (!f) { dirtySections.delete(formRef); return; }
    dirty.value = fields(f).some(fieldChanged);
    f.classList.toggle('dirty', dirty.value);
    for (const tr of f.querySelectorAll('tr')) {
      tr.classList.toggle('changed', [...tr.querySelectorAll('input, select, textarea')].some((el) => el.type !== 'hidden' && fieldChanged(el)));
      const d = tr.querySelector('[data-delete-row]');
      tr.classList.toggle('to-delete', Boolean(d && d.checked));
    }
    if (dirty.value) dirtySections.add(formRef); else dirtySections.delete(formRef);
  }
  const onEvent = () => mark();
  watch(formRef, (f, old) => {
    if (old) { old.removeEventListener('input', onEvent); old.removeEventListener('change', onEvent); }
    if (f) { f.addEventListener('input', onEvent); f.addEventListener('change', onEvent); nextTick(mark); }
  });
  if (sourceRef) watch(sourceRef, () => nextTick(mark));
  onUnmounted(() => dirtySections.delete(formRef));
  return { dirty, mark };
}

// Warnung beim Verlassen der Seite mit ungespeicherten Änderungen (Browser schliessen oder neu laden)
window.addEventListener('beforeunload', (ev) => {
  if (dirtySections.size) { ev.preventDefault(); ev.returnValue = ''; }
});
