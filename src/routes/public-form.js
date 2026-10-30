'use strict';
// Öffentliches Anmeldeformular mit fester URL /forms/anmeldung (wird einmal in ClubDesk eingebettet)
const express = require('express');
const submissions = require('../services/submissions');
const settings = require('../services/settings');
const events = require('../services/events');
const auth = require('../auth');
const h = require('../lib/view-helpers');

const router = express.Router();

// Einfache Begrenzung pro IP gegen Massen-Absendungen
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const list = (hits.get(req.ip) || []).filter((t) => now - t < 10 * 60000);
  if (list.length >= 30) return res.status(429).render('form/error', { h, title: 'Zu viele Anfragen', message: 'Bitte in einigen Minuten erneut versuchen.' });
  list.push(now);
  hits.set(req.ip, list);
  if (hits.size > 5000) hits.clear();
  next();
}

function renderForm(req, res, { values = {}, errors = [], preview = false } = {}) {
  let form;
  if (preview) {
    // Vorschau für angemeldete Benutzer: auch Entwürfe zeigen
    const list = events.list({ status: 'aktiv' }).filter((e) => events.lastEnd(e) > h.localNow())
      .map((e) => ({ ...e, openShifts: e.shifts.filter((s) => !events.shiftEnded(s, e)) }));
    const only = req.query.einsatz ? list.filter((e) => e.id === Number(req.query.einsatz)) : list.filter((e) => events.isInForm(e));
    form = { uid: '', events: only };
  } else {
    form = submissions.issueForm(req.ip);
  }
  res.render('form/anmeldung', {
    h, title: settings.get('form').title, form, values, errors, preview, verein: settings.get('verein_name'),
    intro: settings.get('form').intro, questionFor: submissions.questionFor,
  });
}

router.get('/anmeldung', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.query.vorschau) {
    auth.loadSession(req, res, () => {
      if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
      renderForm(req, res, { preview: true });
    });
    return;
  }
  renderForm(req, res);
});

router.post('/anmeldung', rateLimit, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  let result;
  try {
    result = submissions.receive(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  } catch (err) {
    // Speichern fehlgeschlagen: das Mitglied muss es wissen
    console.error('Formular-Eingang konnte nicht gespeichert werden:', err);
    return res.status(500).render('form/error', { h, title: 'Nicht gespeichert', message: 'Anmeldung nicht gespeichert, bitte erneut versuchen.' });
  }
  if (!result.ok) return renderForm(req, res, { values: req.body, errors: result.errors });
  const sub = result.submission;
  // Verarbeitung im Hintergrund (Worker); die Bestätigung hängt nur am Speichern
  if (!result.duplicate && sub.status === 'neu') setImmediate(() => submissions.processSubmission(sub.id));
  res.render('form/danke', { h, title: 'Danke', firstName: sub.first_name, items: submissions.confirmationList(sub), verein: settings.get('verein_name') });
});

module.exports = router;
