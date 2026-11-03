'use strict';
// Datums-Hilfen. Fachliche Zeiten werden als lokale Zeit Europe/Zurich gespeichert,
// Zeitstempel (created_at usw.) als ISO-UTC.
const TZ = 'Europe/Zurich';
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

const partsFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function nowIso() {
  return new Date().toISOString();
}

// Date -> 'YYYY-MM-DDTHH:MM' in Zürcher Lokalzeit
function toLocal(date = new Date()) {
  const p = Object.fromEntries(partsFmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function localNow() {
  return toLocal(new Date());
}

function today() {
  return localNow().slice(0, 10);
}

function parseYmd(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return { y, m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function isYmd(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
}

function isHm(s) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
}

// 2026-10-31 -> 31.10.2026
function fmtDate(ymd) {
  if (!ymd) return '';
  const { y, m, d } = parseYmd(ymd);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

// 2026-10-31 -> 31.10.
function fmtDateShort(ymd) {
  if (!ymd) return '';
  const { m, d } = parseYmd(ymd);
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
}

// 2026-10-31 -> Sa 31.10.2026
function fmtDateWd(ymd) {
  if (!ymd) return '';
  return `${WEEKDAYS_SHORT[parseYmd(ymd).weekday]} ${fmtDate(ymd)}`;
}

function weekdayShort(ymd) {
  return ymd ? WEEKDAYS_SHORT[parseYmd(ymd).weekday] : '';
}

// 2026-10-31 -> Samstag, 31. Oktober 2026
function fmtDateLong(ymd) {
  if (!ymd) return '';
  const { y, m, d, weekday } = parseYmd(ymd);
  return `${WEEKDAYS[weekday]}, ${d}. ${MONTHS[m - 1]} ${y}`;
}

// ISO-UTC -> 31.10.2026 18:42 (Zürich)
function fmtDateTime(iso) {
  if (!iso) return '';
  const local = toLocal(new Date(iso));
  return `${fmtDate(local.slice(0, 10))} ${local.slice(11, 16)}`;
}

// Lokale 'YYYY-MM-DDTHH:MM' -> 31.10.2026 18:42
function fmtLocal(local) {
  if (!local) return '';
  return `${fmtDate(local.slice(0, 10))} ${local.slice(11, 16)}`.trim();
}

// ISO-UTC -> «heute 18:42», «gestern 18:42» oder «26.10. 18:42»
function fmtRelative(iso) {
  if (!iso) return '';
  const local = toLocal(new Date(iso));
  const day = local.slice(0, 10);
  const time = local.slice(11, 16);
  const t = today();
  if (day === t) return `heute ${time}`;
  if (day === addDays(t, -1)) return `gestern ${time}`;
  return `${fmtDateShort(day)} ${time}`;
}

function addDays(ymd, n) {
  const { y, m, d } = parseYmd(ymd);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  const pa = parseYmd(a);
  const pb = parseYmd(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

function daysUntil(ymd) {
  return daysBetween(today(), ymd);
}

function fmtDaysUntil(ymd) {
  const n = daysUntil(ymd);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n < 0) return `vor ${-n} Tagen`;
  return `in ${n} Tagen`;
}

// Alter an einem Stichtag aus Geburtsdatum oder Jahrgang
function ageAt(person, ymd) {
  if (!person) return null;
  if (person.birth_date && isYmd(person.birth_date)) {
    const b = parseYmd(person.birth_date);
    const r = parseYmd(ymd);
    let age = r.y - b.y;
    if (r.m < b.m || (r.m === b.m && r.d < b.d)) age--;
    return age;
  }
  if (person.birth_year) return parseYmd(ymd).y - person.birth_year;
  return null;
}

function birthYear(person) {
  if (!person) return '';
  if (person.birth_date) return person.birth_date.slice(0, 4);
  return person.birth_year || '';
}

// Eingabe «31.10.2026» oder «2026-10-31» -> 2026-10-31
function parseDateInput(s) {
  if (!s) return null;
  s = String(s).trim();
  if (isYmd(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

// Schicht-Zeitspanne «13:30–19:30»
function fmtSpan(startLocal, endLocal) {
  const s = startLocal ? startLocal.slice(11, 16) : '';
  const e = endLocal ? endLocal.slice(11, 16) : '';
  if (!s && !e) return '';
  return `${s}–${e}`;
}

// Zeitraum zweier Tage in einer der Schreibweisen:
// date 07.11.–09.11.2026 · dm 07.11.–09.11. · wd Sa 07.11.–Mo 09.11.2026 · short Sa 07.11.–Mo 09.11. · long Samstag, 7. – Montag, 9. November 2026
function fmtRange(from, to, style = 'date') {
  if (!from) return '';
  if (!to || to === from) {
    if (style === 'wd') return fmtDateWd(from);
    if (style === 'short') return `${weekdayShort(from)} ${fmtDateShort(from)}`;
    if (style === 'long') return fmtDateLong(from);
    if (style === 'dm') return fmtDateShort(from);
    return fmtDate(from);
  }
  if (style === 'dm') return `${fmtDateShort(from)}–${fmtDateShort(to)}`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (style === 'wd') return `${weekdayShort(from)} ${sameYear ? fmtDateShort(from) : fmtDate(from)} – ${fmtDateWd(to)}`;
  if (style === 'short') return `${weekdayShort(from)} ${fmtDateShort(from)} – ${weekdayShort(to)} ${fmtDateShort(to)}`;
  if (style === 'long') {
    const a = parseYmd(from);
    const b = parseYmd(to);
    const left = sameYear && a.m === b.m ? `${WEEKDAYS[a.weekday]}, ${a.d}.` : sameYear ? `${WEEKDAYS[a.weekday]}, ${a.d}. ${MONTHS[a.m - 1]}` : fmtDateLong(from);
    return `${left} – ${fmtDateLong(to)}`;
  }
  return `${sameYear ? fmtDateShort(from) : fmtDate(from)}–${fmtDate(to)}`;
}

// Datum eines Einsatzes: eigenes Datum bzw. Zeitraum seiner Schichten (date_from/date_to); sonst «Datum offen»
function fmtEventDate(e, style = 'date') {
  const from = e?.date_from || e?.date;
  if (!from) return 'Datum offen';
  return fmtRange(from, e.date_to || from, style);
}

// Mehrtägig: Einsatzdatum und Schichten liegen nicht alle am selben Tag
function isMultiDay(e) {
  return Boolean(e?.date_from && e.date_to && e.date_from !== e.date_to);
}

// Schichtzeit; bei mehrtägigen Einsätzen mit Tag davor: «Sa 07.11. 13:30–19:30»
function fmtShiftWhen(shift, multiDay = false) {
  const span = fmtSpan(shift?.starts_at, shift?.ends_at);
  if (!multiDay || !shift?.starts_at) return span;
  const day = shift.starts_at.slice(0, 10);
  return `${weekdayShort(day)} ${fmtDateShort(day)}${span ? ` ${span}` : ''}`;
}

module.exports = {
  fmtRange, fmtEventDate, fmtShiftWhen, isMultiDay,
  TZ, WEEKDAYS, MONTHS, nowIso, toLocal, localNow, today, isYmd, isHm, fmtDate, fmtDateShort, fmtDateWd,
  weekdayShort, fmtDateLong, fmtDateTime, fmtLocal, fmtRelative, addDays, daysBetween, daysUntil, fmtDaysUntil,
  ageAt, birthYear, parseDateInput, fmtSpan,
};
