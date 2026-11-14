// Eigene Rückfragen statt der Browser-Dialoge (gleich wie bisher in app.js: uiDialog, uiConfirm)
import { reactive } from 'vue';

export const dialogState = reactive({ open: false, title: '', message: '', input: false, placeholder: '', ok: 'OK', cancel: 'Abbrechen', danger: false, value: '', invalid: false, resolve: null });

export function uiDialog({ title = 'Bitte bestätigen', message = '', input = false, placeholder = '', ok = 'OK', cancel = 'Abbrechen', danger = false } = {}) {
  return new Promise((resolve) => {
    Object.assign(dialogState, { open: true, title, message, input, placeholder, ok, cancel, danger, value: '', invalid: false, resolve });
  });
}

export function closeDialog(result) {
  const r = dialogState.resolve;
  dialogState.open = false;
  dialogState.resolve = null;
  if (r) r(result);
}

export const uiAlert = (message, title = 'Hinweis') => uiDialog({ title, message, cancel: false });

// Erster Absatz = Frage (Titel), Rest = Erklärung. Gefährliche Aktionen bekommen einen roten Knopf.
export function confirmDialog(text, opts = {}) {
  const [first, ...rest] = String(text).split(/\n\s*\n/);
  const danger = /lösch|entfern|zurücksetzen|zurücknehmen|verwerfen|absagen/i.test(text);
  return uiDialog({ title: rest.length ? first : 'Bitte bestätigen', message: rest.length ? rest.join('\n\n') : first, ok: danger ? 'Ja, ausführen' : 'Ja', danger, ...opts });
}

// Abgeschlossener Einsatz: Änderung begründen (erscheint im Verlauf). Liefert den Text oder null.
export function askReason() {
  return uiDialog({ title: 'Einsatz ist abgeschlossen', message: 'Bitte die Änderung kurz begründen. Die Begründung erscheint im Verlauf.', input: true, placeholder: 'Begründung', ok: 'Weiter' });
}
