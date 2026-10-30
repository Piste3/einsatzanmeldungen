'use strict';
// Eigenes Anmeldeformular: Eingang («formular_eingang») und Verarbeitung (Konzept 6.3)
const crypto = require('node:crypto');
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const events = require('./events');
const matching = require('./matching');
const registrations = require('./registrations');
const settings = require('./settings');
const { nowIso, localNow, fmtDateShort, fmtSpan } = require('../lib/dates');

const TOKEN_TTL_DAYS = 14;

// 1. Seite laden: offene Einsätze + einmalige Absende-ID (zugleich CSRF-Token, kein Cookie nötig – wichtig im iFrame)
function issueForm(ip) {
  const list = events.openForForm();
  const uid = crypto.randomBytes(18).toString('base64url');
  const shiftIds = {};
  for (const e of list) shiftIds[e.id] = e.openShifts.map((s) => s.id);
  db.run('INSERT INTO form_tokens (uid, event_ids, shift_ids, issued_at, ip) VALUES (?, ?, ?, ?, ?)',
    uid, JSON.stringify(list.map((e) => e.id)), JSON.stringify(shiftIds), nowIso(), ip || null);
  return { uid, events: list };
}

function questionFor(e) {
  return e.question_text || (e.openShifts.length > 1 ? 'Für welche Schichten kannst du?' : 'Kannst du teilnehmen?');
}

/**
 * 2.–4. Absenden und roh speichern. Gibt { ok, duplicate, submission } zurück.
 * Erst wenn das Speichern geklappt hat, sieht das Mitglied die Bestätigung.
 */
function receive(body, { ip, userAgent }) {
  const uid = String(body.submission_uid || '').slice(0, 64);
  const firstName = String(body.first_name || '').trim().slice(0, 80);
  const lastName = String(body.last_name || '').trim().slice(0, 80);

  // Technisches Duplikat (Doppelklick, erneutes Absenden): bestehende Absendung zurückgeben
  const existing = uid ? db.one('SELECT * FROM form_submissions WHERE submission_uid = ?', uid) : null;
  if (existing) return { ok: true, duplicate: true, submission: existing };

  const token = uid ? db.one('SELECT * FROM form_tokens WHERE uid = ?', uid) : null;
  const shownEvents = token ? JSON.parse(token.event_ids) : [];
  const shownShifts = token ? JSON.parse(token.shift_ids) : {};

  // Antworten je Einsatz einsammeln (inkl. der angezeigten Frage)
  const answers = [];
  const eventIds = [].concat(body.event_ids || []).map(Number).filter(Boolean);
  for (const eventId of eventIds) {
    const e = events.get(eventId);
    const answer = ['ja', 'nein'].includes(body[`answer_${eventId}`]) ? body[`answer_${eventId}`] : null;
    const shifts = [].concat(body[`shifts_${eventId}`] || []).map(Number).filter(Boolean);
    const remark = String(body[`remark_${eventId}`] || '').trim().slice(0, 1000);
    if (!answer && !shifts.length) continue; // Einsätze ohne Antwort bleiben einfach leer
    answers.push({
      event_id: eventId,
      event_name: e?.name || null,
      event_date: e?.date || null,
      question: e ? (e.question_text || null) : null,
      answer: shifts.length ? 'ja' : answer,
      shifts: shifts.map((sid) => {
        const s = e?.shifts.find((x) => x.id === sid);
        return { id: sid, name: s?.name || null, zeit: s ? fmtSpan(s.starts_at, s.ends_at) : null };
      }),
      remark: remark || null,
    });
  }

  const errors = [];
  if (!firstName) errors.push('Bitte den Vornamen angeben.');
  if (!lastName) errors.push('Bitte den Nachnamen angeben.');
  if (!answers.length) errors.push('Bitte bei mindestens einem Einsatz eine Antwort geben.');
  if (errors.length) return { ok: false, errors };

  // Spam-Schutz: verstecktes Feld und Mindestzeit
  let spamReason = null;
  if (String(body.website || '').trim()) spamReason = 'verstecktes Feld ausgefüllt';
  else if (token) {
    const seconds = (Date.now() - new Date(token.issued_at).getTime()) / 1000;
    if (seconds < settings.get('form').min_seconds) spamReason = `in ${seconds.toFixed(1)} s abgeschickt`;
  }

  const payload = { first_name: firstName, last_name: lastName, answers, received_local: localNow() };
  let status = spamReason ? 'spam' : 'neu';
  let error = null;
  if (!token && !spamReason) {
    // Unbekannte Absende-ID: nichts verwerfen, aber zur Prüfung in die Fehlerübersicht
    status = 'fehler';
    error = 'Unbekannte oder abgelaufene Absende-ID – bitte prüfen und von Hand verarbeiten.';
  }
  const info = db.run(
    `INSERT INTO form_submissions (submission_uid, first_name, last_name, payload, form_snapshot, status, spam_reason, error, ip, user_agent, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    uid || `ohne-id-${crypto.randomUUID()}`, firstName, lastName, JSON.stringify(payload),
    JSON.stringify({ event_ids: shownEvents, shift_ids: shownShifts, issued_at: token?.issued_at || null }),
    status, spamReason, error, ip || null, String(userAgent || '').slice(0, 200), nowIso(),
  );
  const submission = db.one('SELECT * FROM form_submissions WHERE id = ?', Number(info.lastInsertRowid));
  live.notify('forms', 'cockpit');
  return { ok: true, duplicate: false, submission };
}

/**
 * 5. Verarbeiten: pro gewähltem Einsatz eine eigene Anmeldung, alle mit derselben Personenzuordnung.
 * Scheitert die Verarbeitung, bleibt der Eingang im Status «Fehler».
 */
function processSubmission(id, { force = false } = {}) {
  const sub = db.one('SELECT * FROM form_submissions WHERE id = ?', id);
  if (!sub) return null;
  if (sub.status === 'verarbeitet') return sub;
  if (!force && sub.status !== 'neu') return sub;
  db.run('UPDATE form_submissions SET attempts = attempts + 1 WHERE id = ?', id);
  try {
    const notes = [];
    db.tx(() => {
      const payload = JSON.parse(sub.payload);
      const snapshot = JSON.parse(sub.form_snapshot || '{}');
      const shown = new Set((snapshot.event_ids || []).map(Number));
      const result = matching.match(payload.first_name, payload.last_name);
      const person = result.status === 'match' ? result.person : null;

      for (const a of payload.answers) {
        // Manipulierte Auswahl wird nicht verbucht (Einsatz war beim Seitenaufruf nicht im Formular)
        if (!force && !shown.has(a.event_id)) {
          notes.push(`Einsatz ${a.event_id} war nicht im Formular – nicht verbucht`);
          continue;
        }
        const event = db.one('SELECT * FROM events WHERE id = ?', a.event_id);
        if (!event) { notes.push(`Einsatz ${a.event_id} existiert nicht`); continue; }
        const allowedShifts = new Set((snapshot.shift_ids?.[a.event_id] || []).map(Number));
        const wishes = a.shifts.map((s) => s.id).filter((sid) => force || allowedShifts.has(sid));
        handleAnswer({ sub, payload, a, event, person, result, wishes });
      }
      db.run("UPDATE form_submissions SET status = 'verarbeitet', processed_at = ?, error = ? WHERE id = ?",
        nowIso(), notes.length ? notes.join('; ') : null, id);
    });
  } catch (err) {
    console.error(`Verarbeitung von Eingang ${id} fehlgeschlagen:`, err);
    db.run("UPDATE form_submissions SET status = 'fehler', error = ? WHERE id = ?", String(err.message).slice(0, 1000), id);
  }
  live.notify('forms', 'cockpit', 'clarifications', 'feedback');
  return db.one('SELECT * FROM form_submissions WHERE id = ?', id);
}

function handleAnswer({ sub, payload, a, event, person, result, wishes }) {
  const base = {
    eventId: event.id, enteredFirst: payload.first_name, enteredLast: payload.last_name, source: 'formular',
    submissionId: sub.id, answer: a.answer, wishes, remark: a.remark,
  };
  if (person) {
    const existing = db.one('SELECT * FROM registrations WHERE event_id = ? AND person_id = ?', event.id, person.id);
    if (!existing) {
      registrations.create({ ...base, personId: person.id, matchType: result.type });
      return;
    }
    mergeDuplicate(existing, a, wishes, event, `${person.first_name} ${person.last_name}`);
    return;
  }
  // Keine sichere Zuordnung -> Klärungsliste
  const dup = registrations.findUnresolvedDuplicate(event.id, payload.first_name, payload.last_name);
  if (dup) {
    mergeDuplicate(dup, a, wishes, event, `«${payload.first_name} ${payload.last_name}»`);
    return;
  }
  registrations.create({ ...base, personId: null, matchType: null, matchInfo: result.info, status: 'unsicher' });
}

// Fachliches Duplikat (gleiche Person, gleicher Einsatz): keine zweite Anmeldung, sondern markieren
function mergeDuplicate(existing, a, wishes, event, who) {
  const remark = [existing.remark, a.remark ? `Erneute Absendung: ${a.remark}` : null].filter(Boolean).join(' / ') || null;
  let status = existing.status;
  let wishesNew = JSON.parse(existing.shift_wishes || '[]');
  let text;
  if (a.answer === 'ja' && ['zurueckgezogen', 'abgesagt'].includes(existing.status)) {
    status = 'neu';
    wishesNew = wishes;
    text = `${who} hat sich für «${event.name}» erneut angemeldet (vorher abgemeldet)`;
  } else if (a.answer === 'nein' && !['zurueckgezogen', 'abgesagt', 'unsicher'].includes(existing.status)) {
    // Absage nach Anmeldung: nicht automatisch abmelden, sondern zur Rückfrage markieren
    status = 'rueckfrage';
    text = `${who} hat für «${event.name}» nachträglich «Nein» gesendet – Rückfrage nötig`;
  } else {
    wishesNew = [...new Set([...wishesNew, ...wishes])];
    text = `${who} hat das Formular für «${event.name}» doppelt abgeschickt`;
  }
  db.run('UPDATE registrations SET duplicate_count = duplicate_count + 1, remark = ?, status = ?, shift_wishes = ?, answer = ?, version = version + 1, updated_at = ? WHERE id = ?',
    remark, status, JSON.stringify(wishesNew), existing.status === 'unsicher' ? a.answer : (status === 'neu' ? 'ja' : existing.answer), nowIso(), existing.id);
  if (a.answer === 'ja' && existing.person_id && !['zurueckgezogen', 'abgesagt', 'ungueltig'].includes(status)) {
    registrations.applyWishes(existing.id, event.id, wishesNew, null);
  }
  audit.log({ entity: 'registration', entityId: existing.id, eventId: event.id, personId: existing.person_id, action: 'duplicate', summary: text });
}

// Worker: alle noch nicht verarbeiteten Eingänge abarbeiten
function processPending() {
  const pending = db.all("SELECT id FROM form_submissions WHERE status = 'neu' ORDER BY id");
  for (const { id } of pending) processSubmission(id);
  return pending.length;
}

function confirmationList(sub) {
  const payload = JSON.parse(sub.payload);
  return payload.answers.map((a) => ({
    name: a.event_name,
    date: a.event_date ? fmtDateShort(a.event_date) : '',
    detail: a.answer === 'nein' ? 'Nein' : a.shifts.length ? a.shifts.map((s) => s.name).join(', ') : 'Ja',
    answer: a.answer,
  }));
}

function list({ status = '', limit = 200 } = {}) {
  const where = status ? 'WHERE status = ?' : '';
  return db.all(`SELECT * FROM form_submissions ${where} ORDER BY id DESC LIMIT ?`, ...(status ? [status, limit] : [limit]));
}

function counts() {
  return Object.fromEntries(db.all('SELECT status, COUNT(*) AS n FROM form_submissions GROUP BY status').map((r) => [r.status, r.n]));
}

function markSpam(id, user) {
  db.run("UPDATE form_submissions SET status = 'spam', spam_reason = coalesce(spam_reason, 'von Hand markiert') WHERE id = ? AND status <> 'verarbeitet'", id);
  audit.log({ entity: 'submission', entityId: id, action: 'spam', summary: `${user.display_name} hat Eingang #${id} als Spam markiert`, user });
  live.notify('forms');
}

function purgeTokens() {
  db.run('DELETE FROM form_tokens WHERE issued_at < ?', new Date(Date.now() - TOKEN_TTL_DAYS * 86400000).toISOString());
}

module.exports = { issueForm, questionFor, receive, processSubmission, processPending, confirmationList, list, counts, markSpam, purgeTokens };
