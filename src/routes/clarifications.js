'use strict';
const express = require('express');
const db = require('../db');
const registrations = require('../services/registrations');
const matching = require('../services/matching');
const { flash } = require('../lib/view-helpers');

const router = express.Router();

// Klärungen: Anmeldungen ohne gesicherte Personenzuordnung, über alle Einsätze
router.get('/klaerungen', (req, res) => {
  const list = registrations.unresolved();
  const selected = req.query.id ? list.find((r) => r.id === Number(req.query.id)) : list[0];
  let candidates = [];
  let searchResults = null;
  const q = String(req.query.q || '').trim();
  if (selected) {
    candidates = matching.match(selected.entered_first_name, selected.entered_last_name).candidates || [];
    if (q) {
      const like = `%${q.toLowerCase()}%`;
      searchResults = db.all(`SELECT p.*, r.short AS rank_short,
          (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams
        FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
        WHERE p.status = 'aktiv' AND (lower(p.first_name || ' ' || p.last_name) LIKE ? OR lower(p.last_name || ' ' || p.first_name) LIKE ?)
        ORDER BY p.last_name, p.first_name LIMIT 30`, like, like);
    }
  }
  res.render('pages/clarifications', {
    title: 'Klärungen', list, selected, candidates, searchResults, q, liveTopics: ['clarifications'],
  });
});

router.post('/klaerungen/:rid/ungueltig', (req, res) => {
  registrations.setStatus(Number(req.params.rid), 'ungueltig', req.user);
  flash(res, 'success', 'Als ungültig markiert.');
  res.redirect('/klaerungen');
});

module.exports = router;
