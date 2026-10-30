'use strict';
// Kalenderdatei nach RFC 5545, selbst erzeugt (ohne Zusatzbibliothek). Zeitzone Europe/Zurich.

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Zurich',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19810329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19961027T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

function escapeText(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Zeilen nach 75 Oktetten falten (UTF-8-sicher)
function fold(line) {
  const buf = Buffer.from(line, 'utf8');
  if (buf.length <= 75) return line;
  const parts = [];
  let start = 0;
  let limit = 75;
  while (start < buf.length) {
    let end = Math.min(start + limit, buf.length);
    // nicht mitten in einem UTF-8-Zeichen trennen
    while (end < buf.length && (buf[end] & 0xc0) === 0x80) end--;
    parts.push(buf.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // Folgezeilen beginnen mit einem Leerzeichen
  }
  return parts.join('\r\n ');
}

// 'YYYY-MM-DDTHH:MM' -> 'YYYYMMDDTHHMM00'
const localStamp = (local) => `${local.slice(0, 10).replace(/-/g, '')}T${local.slice(11, 13)}${local.slice(14, 16)}00`;
const utcStamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * events: [{ uid, sequence, start, end, summary, location, description, organizer:{name,email},
 *            attendees:[{name,email}], reminderMinutes }]
 */
function buildCalendar(events, { method = 'PUBLISH' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kadetten-Korps Basel//KKB-Einsatzplaner//DE',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    ...VTIMEZONE,
  ];
  const stamp = utcStamp();
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.uid}`);
    lines.push(`SEQUENCE:${ev.sequence || 0}`);
    lines.push(`DTSTAMP:${stamp}`);
    if (ev.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${ev.start.slice(0, 10).replace(/-/g, '')}`);
    } else {
      lines.push(`DTSTART;TZID=Europe/Zurich:${localStamp(ev.start)}`);
      lines.push(`DTEND;TZID=Europe/Zurich:${localStamp(ev.end || ev.start)}`);
    }
    lines.push(`SUMMARY:${escapeText(ev.summary)}`);
    if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
    if (ev.organizer?.email) lines.push(`ORGANIZER;CN=${escapeParam(ev.organizer.name)}:mailto:${ev.organizer.email}`);
    for (const a of ev.attendees || []) {
      if (!a.email) continue;
      lines.push(`ATTENDEE;CN=${escapeParam(a.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:${a.email}`);
    }
    lines.push('STATUS:CONFIRMED');
    if (ev.reminderMinutes) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.summary)}`, `TRIGGER:-PT${ev.reminderMinutes}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

function escapeParam(s) {
  const v = String(s || '').replace(/["\r\n]/g, '');
  return /[;:,]/.test(v) ? `"${v}"` : v || 'Teilnehmende';
}

module.exports = { buildCalendar, escapeText, fold };
