'use strict';
// Handy-App: schlanke Ansicht zum Anfragen an einer Übung.
// Nur zwei Seiten: Einsatz wählen und Personen anfragen. Einsätze lassen sich hier nicht bearbeiten.
const express = require('express');
const db = require('../db');
const events = require('../services/events');
const inquiries = require('../services/inquiries');
const feedback = require('../services/feedback');
const { ValidationError } = require('../services/errors');
const { today, addDays } = require('../lib/dates');

const router = express.Router();

// Antworten in der Handy-App: Knopf → Ergebnis des Kontaktversuchs
const ANSWERS = { kann: 'zugesagt', kann_nicht: 'abgesagt', unsicher: 'unsicher', nicht_erreicht: 'nicht_erreicht', gesendet: 'whatsapp' };

// Stand einer Person in einfachen Worten: kann, kann nicht oder noch offen
function answerOf(r) {
  if (r.state === 'zugesagt') return 'kann';
  if (r.state === 'abgesagt') return 'kann_nicht';
  if (r.state === 'angemeldet') return ['zurueckgezogen', 'abgesagt'].includes(r.reg_status) ? 'kann_nicht' : 'kann';
  return 'offen';
}

// Text unter dem Status: woher der Stand kommt
function stateLabel(r) {
  const a = answerOf(r);
  if (a === 'kann') return { text: 'Kann', tone: 'green' };
  if (a === 'kann_nicht') return { text: 'Kann nicht', tone: 'red' };
  return {
    offen: { text: 'Noch nicht gefragt', tone: 'gray' },
    nicht_erreicht: { text: 'Nicht erreicht', tone: 'yellow' },
    whatsapp: { text: 'WhatsApp gesendet', tone: 'blue' },
    unsicher: { text: 'Weiss nicht', tone: 'yellow' },
  }[r.state] || { text: 'Noch nicht gefragt', tone: 'gray' };
}

function locked(e, user) {
  return (e.status === 'abgeschlossen' && user.role !== 'admin') || e.status === 'abgesagt';
}

function loadEvent(req, res, next) {
  const e = events.get(Number(req.params.id));
  if (!e) return res.status(404).render('handy/fehler', { title: 'Nicht gefunden', message: 'Diesen Einsatz gibt es nicht.' });
  req.event = e;
  res.locals.event = e;
  next();
}

function countAnswers(list) {
  const c = { offen: 0, kann: 0, kann_nicht: 0 };
  for (const r of list) c[answerOf(r)] += 1;
  return c;
}

// Startseite: laufende und kommende Einsätze (heute zuerst)
router.get('/handy', (req, res) => {
  const t = today();
  const list = db.all(`SELECT * FROM events WHERE status IN ('veroeffentlicht','entwurf') AND date_to >= ? AND date_from <= ?
    ORDER BY date_from, start_time, id`, t, addDays(t, 183)).map((e) => ({ ...e, counts: countAnswers(inquiries.listForEvent(e.id)) }));
  res.render('handy/start', { title: 'Einsatz wählen', list, todayYmd: t });
});

function personList(e, query) {
  const filters = { team: query.team || '', sort: query.sort === 'rang_ab' ? 'rang_ab' : 'rang' };
  const all = inquiries.listForEvent(e.id, filters);
  for (const r of all) { r.answer = answerOf(r); r.label = stateLabel(r); }
  const counts = countAnswers(all);
  const show = ['offen', 'kann', 'kann_nicht', 'alle'].includes(query.zeige) ? query.zeige : 'offen';
  const list = show === 'alle' ? Array.from(all) : all.filter((r) => r.answer === show);
  return { list, counts, total: all.length, show, filters };
}

// Personen anfragen
router.get('/handy/einsatz/:id', loadEvent, (req, res) => {
  const e = req.event;
  const data = personList(e, req.query);
  res.render('handy/einsatz', {
    title: e.name, ...data, locked: locked(e, req.user),
    shifts: feedback.shiftChoices([e.id])[e.id] || [],
    teams: db.all('SELECT * FROM teams WHERE active = 1 ORDER BY sort, name'),
  });
});

function renderCard(req, res, personId) {
  const e = req.event;
  const r = inquiries.listForEvent(e.id).find((x) => x.person_id === personId);
  if (!r) return res.status(404).send('');
  r.answer = answerOf(r);
  r.label = stateLabel(r);
  res.render('handy/_person', { r, locked: locked(e, req.user), shifts: feedback.shiftChoices([e.id])[e.id] || [] });
}

function back(req) {
  const b = String(req.body.back || '');
  return /^\/handy(\/|$|\?)/.test(b) ? b : `/handy/einsatz/${req.event.id}`;
}

// Antwort eintragen. Mit Script kommt nur die neue Karte zurück, ohne Script die ganze Seite.
router.post('/handy/einsatz/:id/antwort', loadEvent, (req, res) => {
  const personId = Number(req.body.person_id);
  const result = ANSWERS[req.body.antwort];
  try {
    if (!result) throw new ValidationError(['Bitte eine Antwort wählen.']);
    const channel = ['telefon', 'whatsapp', 'muendlich'].includes(req.body.channel) ? req.body.channel : 'muendlich';
    inquiries.addAttempt(req.event.id, personId, { channel, result, shift_ids: req.body.shift_ids, note: req.body.note }, req.user);
  } catch (err) {
    if (!req.xhr) throw err;
    return res.status(400).type('text').send(err.messages ? err.messages.join(' ') : 'Speichern ging nicht. Bitte neu laden.');
  }
  if (req.xhr) return renderCard(req, res, personId);
  res.redirect(`${back(req)}#p${personId}`);
});

// Letzten Eintrag rückgängig machen (falsch getippt)
router.post('/handy/einsatz/:id/zuruecknehmen', loadEvent, (req, res) => {
  const personId = Number(req.body.person_id);
  try {
    inquiries.removeAttempt(req.event.id, Number(req.body.attempt_id), req.user);
  } catch (err) {
    if (!req.xhr) throw err;
    return res.status(400).type('text').send(err.messages ? err.messages.join(' ') : 'Rückgängig machen ging nicht. Bitte neu laden.');
  }
  if (req.xhr) return renderCard(req, res, personId);
  res.redirect(`${back(req)}#p${personId}`);
});

module.exports = router;
module.exports.answerOf = answerOf;
