// Eigene Rückfrage statt der Browser-Meldung (wie bisher: erster Absatz = Frage, Rest = Erklärung)
import { reactive } from 'vue';

export const dialogState = reactive({ open: false, title: '', message: '', ok: 'OK', danger: false, resolve: null });

export function confirmDialog(text, { ok = 'OK', danger = false } = {}) {
  const [title, ...rest] = String(text).split('\n\n');
  return new Promise((resolve) => {
    Object.assign(dialogState, { open: true, title, message: rest.join('\n\n'), ok, danger, resolve });
  });
}
export function closeDialog(result) {
  const r = dialogState.resolve;
  dialogState.open = false;
  dialogState.resolve = null;
  if (r) r(result);
}
