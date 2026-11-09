'use strict';
// Anzeigetexte und Farben für Status-Werte

const EVENT_STATUS = {
  entwurf: { label: 'Entwurf', tone: 'gray' },
  veroeffentlicht: { label: 'Veröffentlicht', tone: 'green' },
  abgeschlossen: { label: 'Abgeschlossen', tone: 'blue' },
  abgesagt: { label: 'Abgesagt', tone: 'red' },
};

const REG_STATUS = {
  neu: { label: 'Neu eingegangen', short: 'Neu', tone: 'blue' },
  unsicher: { label: 'Unsichere Zuordnung', short: 'Unsicher', tone: 'yellow' },
  rueckfrage: { label: 'Rückfrage nötig', short: 'Rückfrage', tone: 'orange' },
  warteliste: { label: 'Warteliste', short: 'Warteliste', tone: 'gray' },
  bestaetigt: { label: 'Bestätigt', short: 'Bestätigt', tone: 'green' },
  zurueckgezogen: { label: 'Zurückgezogen', short: 'Zurückgezogen', tone: 'red' },
  abgesagt: { label: 'Abgesagt («Nein»)', short: 'Abgesagt', tone: 'red' },
  ungueltig: { label: 'Ungültig', short: 'Ungültig', tone: 'gray' },
};
// Status, die ein Benutzer von Hand setzen darf («Unsichere Zuordnung» setzt nur das System)
const REG_STATUS_MANUAL = ['neu', 'rueckfrage', 'warteliste', 'bestaetigt', 'zurueckgezogen', 'abgesagt'];
// Diese Anmeldungen zählen zur Besetzung (Ist)
const REG_COUNTING = ['neu', 'rueckfrage', 'bestaetigt'];
// Diese Anmeldungen gelten als «aktiv dabei oder in Prüfung»
const REG_ACTIVE = ['neu', 'unsicher', 'rueckfrage', 'warteliste', 'bestaetigt'];

const SOURCE = {
  formular: 'Formular', telefon: 'Telefon', whatsapp: 'WhatsApp', muendlich: 'Mündlich', manuell: 'Manuell',
};

const MATCH_TYPE = {
  auto: 'automatisch zugeordnet', alias: 'über Namensvariante', manuell: 'manuell zugeordnet',
};

const INQUIRY_STATUS = {
  offen: { label: 'Noch nicht angefragt', tone: 'gray' },
  zugesagt: { label: 'Zugesagt', tone: 'green' },
  abgesagt: { label: 'Abgesagt', tone: 'red' },
  nicht_erreicht: { label: 'Nicht erreicht', tone: 'yellow' },
  whatsapp: { label: 'Per WhatsApp angefragt', tone: 'blue' },
  unsicher: { label: 'Unsicher', tone: 'yellow' },
};

// Zusätzliche Anzeige-Status im Reiter «Anfragen»
const INQUIRY_ROW = {
  angemeldet: { label: 'Selbst gemeldet', tone: 'green' },
};

// Ergebnis eines Kontaktversuchs -> Anfragestatus
const ATTEMPT_RESULT = {
  nicht_erreicht: 'Nicht erreicht',
  whatsapp: 'Nachricht gesendet, Antwort offen',
  zugesagt: 'Zugesagt',
  unsicher: 'Unsicher – weiss es noch nicht',
  abgesagt: 'Abgesagt',
};

const CHANNEL = { telefon: { label: 'Telefon', short: 'Tel' }, whatsapp: { label: 'WhatsApp', short: 'WA' }, muendlich: { label: 'Mündlich', short: 'Mdl' } };

// Genauere Symbole in der Rückmeldungen-Tabelle (innerhalb von An bzw. Unsicher)
const FEEDBACK_DETAIL = {
  bestaetigt: { label: 'An, bestätigt', state: 'an' },
  warteliste: { label: 'Warteliste', state: 'an' },
  whatsapp: { label: 'Nachricht gesendet, Antwort offen', state: 'unsicher' },
  telefon: { label: 'Angerufen, nicht erreicht', state: 'unsicher' },
  rueckfrage: { label: 'Rückfrage nötig', state: 'unsicher' },
  muendlich: { label: 'Mündlich gefragt, weiss es noch nicht', state: 'unsicher' },
  // andere Schicht desselben Einsatzes: aus Datum und Zeit der Schichten berechnet
  ueberschneidung: { label: 'Andere Schicht zur selben Zeit, geht nicht', state: 'andere' },
  frei: { label: 'Andere Schicht, zeitlich auch möglich', state: 'andere' },
};

const FEEDBACK = {
  an: { label: 'An', tone: 'green' },
  ab: { label: 'Ab', tone: 'red' },
  unsicher: { label: 'Unsicher', tone: 'yellow' },
  offen: { label: 'Offen', tone: 'gray' },
  // nur in Schicht-Spalten
  andere: { label: 'Andere Schicht', tone: 'gray' },
  schicht_offen: { label: 'An, ohne Schicht', tone: 'green' },
  // Schicht ist für andere Mannschaften vorgesehen (Anmelden bleibt möglich)
  nicht_vorgesehen: { label: 'Nicht vorgesehen (andere Mannschaft)', tone: 'gray' },
};

const PERSON_STATUS = {
  aktiv: { label: 'aktiv', tone: 'green' },
  inaktiv: { label: 'inaktiv', tone: 'gray' },
  ausgetreten: { label: 'ausgetreten', tone: 'red' },
};

const DIET = {
  allergie: 'Allergie',
  unvertraeglichkeit: 'Unverträglichkeit',
  vegetarisch: 'vegetarisch',
  vegan: 'vegan',
  religioes: 'religiös',
  andere: 'andere',
};

const ROLES = { admin: 'Admin', aufgebotsstelle: 'Aufgebotsstelle', einsatzleiter: 'Einsatzleiter' };

const SUBMISSION_STATUS = {
  neu: { label: 'Neu', tone: 'blue' },
  verarbeitet: { label: 'Verarbeitet', tone: 'green' },
  fehler: { label: 'Fehler', tone: 'red' },
  spam: { label: 'Spamverdacht', tone: 'yellow' },
};

module.exports = {
  EVENT_STATUS, REG_STATUS, REG_STATUS_MANUAL, REG_COUNTING, REG_ACTIVE, SOURCE, MATCH_TYPE, INQUIRY_STATUS, INQUIRY_ROW,
  ATTEMPT_RESULT, CHANNEL, FEEDBACK, FEEDBACK_DETAIL, PERSON_STATUS, DIET, ROLES, SUBMISSION_STATUS,
};
