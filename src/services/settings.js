'use strict';
const db = require('../db');

const DEFAULT_CALENDAR_DESCRIPTION = `Bemerkung: Das unten angezeigte Aufgebot zählt nur für Dich, wenn Du Dich in der Teilnehmer:innenliste oben wiederfindest.

{{einsatz.name}} - {{einsatz.datum_kurz}} - {{schicht.name}}

Du hast Dich für folgenden Einsatz angemeldet. Schon im Voraus herzlichen Dank! Nachstehend findest Du alle nötigen Informationen:

Antreten
{{antreten.datum}}, {{antreten.zeit}} Uhr, {{antreten.ort}}

Abtreten
{{abtreten.datum}}, {{abtreten.zeit}} Uhr, {{abtreten.ort}}

Einsatzleitung
{{einsatzleitung}}

Tenue
{{einsatz.tenue}}

Deine Teilnahme ist definitiv. Falls Du am Einsatz nicht teilnehmen kannst, musst du dich umgehend per Mail an {{verein.aufgebot_email}} wenden. Bei krankheitsbedingten Absagen weniger als drei Tage vor dem Einsatz, melde dich bitte direkt telefonisch bei der Einsatzleitung.
Bei allfälligen Fragen stehe ich dir gerne zur Verfügung.

Freundliche Grüsse
{{absender}}`;

const DEFAULT_CONFIRMATION_BODY = `Hallo {{person.vorname}}

Deine Anmeldung für «{{einsatz.name}}» ist bestätigt.

Antreten: {{antreten.datum}}, {{antreten.zeit}} Uhr, {{antreten.ort}}
Abtreten: {{abtreten.datum}}, {{abtreten.zeit}} Uhr, {{abtreten.ort}}
Schicht: {{schicht.name}}
Einsatzleitung: {{einsatzleitung}}
Tenue: {{einsatz.tenue}}

Falls Du nicht teilnehmen kannst, melde Dich bitte umgehend per Mail an {{verein.aufgebot_email}}.

Freundliche Grüsse
{{absender}}`;

const DEFAULTS = {
  verein_name: 'Kadetten-Korps Basel',
  aufgebot_email: 'aufgebot@kkb.ch',
  email_domain: 'web.kkb.ch',
  calendar: {
    title: '{{einsatz.name}} - {{einsatz.datum_kurz}} - {{schicht.name}}',
    location: '{{antreten.ort}}',
    description: DEFAULT_CALENDAR_DESCRIPTION,
    omit_empty_lines: true,
    attendees: true,
    reminder_minutes: 1440,
  },
  confirmation: {
    enabled: true,
    subject: 'Anmeldebestätigung: {{einsatz.name}} - {{einsatz.datum_kurz}}',
    body: DEFAULT_CONFIRMATION_BODY,
  },
  form: {
    title: 'Einsatzanmeldung',
    intro: '',
    min_seconds: 3, // schneller abgeschickt = Spamverdacht
  },
};

const cache = new Map();

function get(key) {
  if (cache.has(key)) return cache.get(key);
  const row = db.one('SELECT value FROM settings WHERE key = ?', key);
  let value = DEFAULTS[key];
  if (row) {
    try {
      const parsed = JSON.parse(row.value);
      value = DEFAULTS[key] && typeof DEFAULTS[key] === 'object' ? { ...DEFAULTS[key], ...parsed } : parsed;
    } catch { /* Standardwert */ }
  }
  cache.set(key, value);
  return value;
}

function set(key, value) {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
  cache.delete(key);
}

function clearCache() {
  cache.clear();
}

module.exports = { get, set, clearCache, DEFAULTS };
