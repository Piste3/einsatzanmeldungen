'use strict';
// Formulare: Status, Absendungen, Spamverdacht, Fehlerübersicht (nur Admin)
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const events = require('../services/events');
const submissions = require('../services/submissions');
const audit = require('../services/audit');
const { sendTable, wantsExport } = require('../lib/export');
const { flash } = require('../lib/view-helpers');
const h = require('../lib/view-helpers');

const router = express.Router();
router.use('/formulare', auth.requireAdmin);

router.get('/formulare', (req, res) => {
  const status = req.query.status || '';
  const list = submissions.list({ status });
  for (const s of list) {
    try { s.data = JSON.parse(s.payload); } catch { s.data = { answers: [] }; }
  }
  const format = wantsExport(req);
  if (format) {
    return sendTable(res, format, 'Formular-Eingang', [
      { label: 'Eingang', value: (s) => h.fmtDateTime(s.received_at) },
      { label: 'Vorname', value: (s) => s.first_name },
      { label: 'Nachname', value: (s) => s.last_name },
      { label: 'Einsätze', value: (s) => s.data.answers.map((a) => `${a.event_name}: ${a.answer === 'nein' ? 'Nein' : a.shifts.length ? a.shifts.map((x) => x.name).join(', ') : 'Ja'}`).join('\n') },
      { label: 'Status', value: (s) => h.labels.SUBMISSION_STATUS[s.status].label },
      { label: 'Hinweis', value: (s) => s.error || s.spam_reason || '' },
    ], list);
  }
  res.render('pages/forms', {
    title: 'Formulare', list, status, counts: submissions.counts(), openEvents: events.openForForm(),
    formUrl: `${config.baseUrl}/forms/anmeldung`, frameAncestors: config.formFrameAncestors,
    outbox: db.all('SELECT * FROM mail_outbox ORDER BY id DESC LIMIT 20'), liveTopics: ['forms'],
  });
});

router.post('/formulare/:sid/verarbeiten', (req, res) => {
  const id = Number(req.params.sid);
  const sub = submissions.processSubmission(id, { force: true });
  audit.log({ entity: 'submission', entityId: id, action: 'process', summary: `${req.user.display_name} hat Formular-Eingang #${id} erneut verarbeitet`, user: req.user });
  flash(res, sub?.status === 'verarbeitet' ? 'success' : 'error', sub?.status === 'verarbeitet' ? 'Eingang verarbeitet.' : `Verarbeitung fehlgeschlagen: ${sub?.error || ''}`);
  res.redirect('/formulare');
});

router.post('/formulare/:sid/spam', (req, res) => {
  submissions.markSpam(Number(req.params.sid), req.user);
  flash(res, 'success', 'Als Spam markiert.');
  res.redirect('/formulare');
});

module.exports = router;
