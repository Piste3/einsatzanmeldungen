// Gemeinsame Aktionen rund um Anfragen (Anfragen-Reiter, Rückmeldungen, Personenseite)
import { runAction } from './actions.js';
import { uiDialog } from './dialog.js';

// Alles für eine Person bei einem Einsatz zurücksetzen
export async function resetPerson({ personId, eventId, who, onDone }) {
  const ok = await uiDialog({
    title: 'Alles zurücksetzen?',
    message: `${who || 'diese Person'}\n\nAlle Kontaktversuche, die Rückmeldung bzw. Anmeldung und die Schichtzuteilung für diesen Einsatz werden gelöscht. Die Person gilt danach wieder als offen. Ein Formular-Eingang bleibt unter «Formulare» gespeichert, der Verlauf bleibt sichtbar (löschen mit «Verlauf löschen»).`,
    ok: 'Zurücksetzen', danger: true,
  });
  if (!ok) return null;
  return runAction('/anfragen/zuruecksetzen', { person_id: personId, event_id: eventId }, { onDone });
}

// Verlauf leeren, nur der neueste Eintrag bleibt
export async function clearHistory({ personId, eventId, who, onDone }) {
  const ok = await uiDialog({
    title: 'Verlauf löschen?',
    message: `${who || 'diese Person'}\n\nAlle Einträge im Verlauf werden gelöscht, nur der neueste (aktueller Stand) bleibt stehen. Die Rückmeldung, die Anmeldung und die Schichten bleiben, wie sie sind. Im Verlauf des Einsatzes bleibt vermerkt, wer den Verlauf gelöscht hat.`,
    ok: 'Verlauf löschen', danger: true,
  });
  if (!ok) return null;
  return runAction('/rueckmeldungen/verlauf/loeschen', { person_id: personId, event_id: eventId }, { onDone });
}

// Zwei Schichten überschneiden sich zeitlich
export const clash = (a, b) => Boolean(a.from && b.from && a.from < b.to && b.from < a.to);
