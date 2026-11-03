'use strict';
// Ansicht für die Rolle «Einsatzleiter»: nur freigegebene Einsätze, nur lesen.
// Dieser Router steht vor allen anderen: Für Einsatzleiter ist alles gesperrt, was hier nicht ausdrücklich erlaubt ist.
const express = require('express');
const db = require('../db');
const events = require('../services/events');
const registrations = require('../services/registrations');
const leaders = require('../services/leaders');
const { today } = require('../lib/dates');
const { REG_COUNTING } = require('../lib/labels');

const router = express.Router();

router.use((req, res, next) => (leaders.isLeader(req.user) ? next() : next('router')));

function denied(res) {
  return res.status(403).render('pages/error', { title: 'Kein Zugriff', message: 'Diese Seite ist für Einsatzleiter nicht freigegeben. Deine Einsätze findest du unter «Meine Einsätze».' });
}

function loadGranted(req, res, next) {
  const id = Number(req.params.id);
  if (!leaders.hasAccess(req.user, id)) return denied(res);
  const e = events.get(id);
  if (!e) return res.status(404).render('pages/error', { title: 'Nicht gefunden', message: 'Dieser Einsatz existiert nicht.' });
  req.event = e;
  res.locals.event = e;
  next();
}

// «Meine Einsätze»
router.get('/', (req, res) => {
  const ph = REG_COUNTING.map(() => '?').join(',');
  const list = leaders.eventsFor(req.user.id).map((e) => ({
    ...e,
    angemeldet: db.one(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND person_id IS NOT NULL AND status IN (${ph})`, e.id, ...REG_COUNTING).n,
    bestaetigt: db.one("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND person_id IS NOT NULL AND status = 'bestaetigt'", e.id).n,
  }));
  const t = today();
  // Ohne Datum (noch in Planung) zählt ein Einsatz als anstehend
  const upcoming = list.filter((e) => !e.date_to || e.date_to >= t);
  const past = list.filter((e) => e.date_to && e.date_to < t).reverse();
  res.render('leader/home', {
    title: 'Meine Einsätze', upcoming, past,
    liveTopics: [`leader:${req.user.id}`, ...upcoming.slice(0, 19).map((e) => `event:${e.id}`)],
  });
});

// Einsatz: Angaben, Schichten und Teilnehmer
router.get('/einsaetze/:id(\\d+)', loadGranted, (req, res) => {
  const e = req.event;
  const view = registrations.participantView(e, req.query, req.user);
  res.render('leader/event', {
    title: e.name, ...view, shifts: events.stats(e).shifts, extraDefs: events.extraDefs(),
    summary: registrations.dietSummary(view.list, view.exts), scopes: registrations.PARTICIPANT_SCOPES,
    liveTopics: [`event:${e.id}`, `leader:${req.user.id}`],
  });
});

// Teilnehmerliste: Exporte (PDF, Excel, CSV) laufen über die normale Route; die Seite selbst ist die Einsatzansicht
router.get('/einsaetze/:id(\\d+)/teilnehmerliste', loadGranted, (req, res, next) => {
  if (req.query.format) return next('router');
  const qs = new URLSearchParams(req.query).toString();
  res.redirect(`/einsaetze/${req.event.id}${qs ? `?${qs}` : ''}`);
});

// Handbuch ist erlaubt
router.use('/handbuch', (req, res, next) => next('router'));

router.use((req, res) => denied(res));

module.exports = router;
