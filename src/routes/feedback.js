'use strict';
const express = require('express');
const db = require('../db');
const feedback = require('../services/feedback');
const history = require('../services/history');
const { sendTable, wantsExport } = require('../lib/export');
const { FEEDBACK, FEEDBACK_DETAIL } = require('../lib/labels');
const h = require('../lib/view-helpers');
const { flash } = h;

const router = express.Router();

// Export: bei «Andere Schicht» steht dabei, ob sie sich zeitlich überschneidet
const cellLabel = (c) => (c.state === 'andere' && FEEDBACK_DETAIL[c.detail] ? FEEDBACK_DETAIL[c.detail].label : FEEDBACK[c.state].label);

router.get('/rueckmeldungen', (req, res) => {
  const filters = {
    team: req.query.team || '', period: req.query.period || '3m', sort: req.query.sort || 'rang', drafts: req.query.drafts || '',
    q: String(req.query.q || '').trim(), only: req.query.only || '', view: req.query.view === 'einsatz' ? 'einsatz' : 'tabelle',
  };
  const data = feedback.matrix({ ...filters, includeDrafts: filters.drafts === '1' });
  const format = wantsExport(req);
  if (format) {
    const cols = [
      { label: 'Rang', value: (r) => r.person.rank_short || '' },
      { label: 'Vorname', value: (r) => r.person.first_name },
      { label: 'Nachname', value: (r) => r.person.last_name },
      { label: 'Mannschaft', value: (r) => r.person.teams || '' },
      ...data.columns.map((c, i) => ({ label: `${c.event.name} (${h.fmtEventDate(c.event, 'dm')})${c.shift ? ` – ${c.shift.name}` : ''}`, value: (r) => cellLabel(r.cells[i]) })),
    ];
    return sendTable(res, format, 'Rückmeldungen', cols, data.rows);
  }
  res.render('pages/feedback', {
    title: 'Rückmeldungen', ...data, filters, periods: feedback.PERIODS, teams: db.all('SELECT * FROM teams WHERE active = 1 ORDER BY sort, name'),
    allUsers: db.all("SELECT id, display_name FROM users WHERE active = 1 AND role <> 'einsatzleiter' ORDER BY display_name"), liveTopics: ['feedback', 'events'],
    shiftChoices: feedback.shiftChoices(data.events.map((e) => e.id)),
  });
});

// Historie einer Person bei einem Einsatz (wird im Kontaktversuch-Fenster nachgeladen)
router.get('/rueckmeldungen/verlauf', (req, res) => {
  const personId = Number(req.query.person);
  const eventId = Number(req.query.event);
  if (!personId || !eventId) return res.status(400).send('');
  const entries = history.forPair(eventId, personId);
  res.render('partials/status-history', { entries, cleared: entries.cleared, personId, eventId });
});

// Verlauf einer Person bei einem Einsatz leeren (Rückmeldung und Anmeldung bleiben)
router.post('/rueckmeldungen/verlauf/loeschen', (req, res) => {
  const n = history.clear(Number(req.body.event_id), Number(req.body.person_id), req.user);
  flash(res, 'success', `Verlauf gelöscht (${n} Eintr${n === 1 ? 'ag' : 'äge'}), der neueste Eintrag bleibt stehen. Rückmeldung und Anmeldung sind unverändert.`);
  const b = String(req.body.back || '');
  res.redirect(b.startsWith('/') && !b.startsWith('//') ? b : '/rueckmeldungen');
});

module.exports = router;
