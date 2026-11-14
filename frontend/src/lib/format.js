// Hilfsfunktionen für die Ansichten. Datum, Bezeichnungen und Sortierung kommen aus dem Backend-Code (@lib).
import * as dates from '@lib/dates.js';
import * as labels from '@lib/labels.js';

export { dates, labels };
export const { fmtDate, fmtDateLong, fmtRelative, fmtRange, fmtEventDate, today } = dates;

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const pct = (ist, soll) => (!soll ? (ist ? 100 : 0) : Math.min(100, Math.round((ist / soll) * 100)));
export const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

// Zustand eines Einsatzes in Listen (wie views-helper eventState)
export function eventState(e) {
  if (e.status !== 'veroeffentlicht') {
    const s = labels.EVENT_STATUS[e.status] || { label: e.status, tone: 'gray' };
    return { text: s.label, tone: s.tone, title: '' };
  }
  const inForm = typeof e.inForm === 'boolean' ? e.inForm : true;
  return inForm
    ? { text: 'Im Formular', tone: 'green', title: 'Veröffentlicht und im Anmeldeformular' }
    : { text: 'Nicht im Formular', tone: 'gray', title: e.show_in_form ? 'Veröffentlicht, letzte Schicht ist vorbei' : 'Veröffentlicht, von Hand aus dem Formular genommen' };
}
export function regState(status) {
  const s = labels.REG_STATUS[status] || { label: status, tone: 'gray' };
  return { text: s.label, tone: s.tone };
}
