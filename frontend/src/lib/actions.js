// Aktion mit den üblichen Rückfragen: Bestätigung, Begründung bei abgeschlossenem Einsatz, Fehlermeldungen.
import { post, ApiError, flash } from './api.js';
import { confirmDialog, askReason } from './dialog.js';
import { showConflict } from './conflict.js';

export async function runAction(path, body = {}, { confirm = null, event = null, follow = false, onDone = null } = {}) {
  if (confirm && !(await confirmDialog(confirm))) return null;
  const payload = { ...body };
  if (event && event.status === 'abgeschlossen' && !payload.reason) {
    const r = await askReason();
    if (!r) return null;
    payload.reason = r;
  }
  try {
    const res = await post(path, payload, { follow });
    if (onDone) await onDone(res);
    return res;
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 409 && e.body?.view === 'pages/conflict') showConflict(e.body.data);
      else if (e.status === 409) flash('error', 'Der Datensatz wurde inzwischen von jemand anderem geändert. Bitte neu laden.');
      else for (const m of e.messages) flash('error', m);
      return null;
    }
    throw e;
  }
}

// Formularfelder in ein Objekt für die Schnittstelle. Mehrfache Namen werden Listen (wie im bisherigen Formular).
export function formBody(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  }
  return out;
}
