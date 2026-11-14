// Abschnitte mit einem Speichern-Knopf für eine ganze Tabelle: geänderte Zeilen markieren,
// Hinweis «Ungespeicherte Änderungen» zeigen und Live-Aktualisierungen solange zurückhalten.
// Die Felder sind ungebunden (:value); verglichen wird mit dem Stand nach dem letzten Laden.
import { ref, watch, nextTick, onUnmounted } from 'vue';
import { uiDialog } from './dialog.js';

export const dirtySections = new Set();
// Nach erfolgreichem Speichern: Weiterleiten ohne Rückfrage
export function leaveAllowed() { dirtySections.clear(); }

// Suchauswahl: das Textfeld zählt nicht, das versteckte Feld mit data-default schon
const fields = (form) => [...form.querySelectorAll('input, select, textarea')].filter((el) => !el.disabled && !el.classList.contains('combo-input')
  && (el.type === 'hidden' ? el.dataset.default !== undefined : !['submit', 'button'].includes(el.type)));

// Wie bisher: verglichen wird mit dem Vorgabewert aus den Daten (defaultValue, defaultChecked, defaultSelected).
// Die Felder binden deshalb :defaultValue statt :value; Vue setzt :value bei jedem Neuzeichnen zurück.
export function fieldChanged(el) {
  if (el.type === 'hidden') return el.dataset.default !== undefined && el.value !== el.dataset.default;
  if (el.classList.contains('combo-input')) return false;
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
      tr.classList.toggle('changed', [...tr.querySelectorAll('input, select, textarea')].some(fieldChanged));
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

// Beim Speichern eines Abschnitts warnen, wenn andere Abschnitte ungespeicherte Änderungen haben (wie bisher)
export async function confirmOtherSections(formRef) {
  const others = [...dirtySections].filter((r) => r !== formRef && r.value);
  if (!others.length) return true;
  const names = others.map((r) => (r.value.querySelector('.card-head h2, h2') || {}).firstChild?.textContent?.trim()).filter(Boolean);
  return uiDialog({
    title: 'Ungespeicherte Änderungen',
    message: `In ${names.length ? `«${names.join('», «')}»` : 'einem anderen Abschnitt'} gibt es ungespeicherte Änderungen. Sie gehen verloren, wenn du jetzt nur diesen Teil speicherst.`,
    ok: 'Trotzdem speichern', danger: true,
  });
}
