'use strict';
const express = require('express');
const db = require('../db');
const cockpit = require('../services/cockpit');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('pages/cockpit', { title: 'Cockpit', ...cockpit.data(), liveTopics: ['cockpit', 'events', 'forms', 'clarifications'] });
});

// Globale Suche: Personen, Einsätze und Anmeldungen nach Name
router.get('/suche', (req, res) => {
  const q = String(req.query.q || '').trim();
  let people = [];
  let evts = [];
  let regs = [];
  if (q.length >= 2) {
    const like = `%${q.toLowerCase()}%`;
    people = db.all(`SELECT p.*, r.short AS rank_short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
      WHERE lower(p.first_name || ' ' || p.last_name) LIKE ? OR lower(p.last_name || ' ' || p.first_name) LIKE ?
         OR EXISTS (SELECT 1 FROM person_aliases a WHERE a.person_id = p.id AND lower(a.first_name || ' ' || a.last_name) LIKE ?)
      ORDER BY p.status, p.last_name LIMIT 30`, like, like, like);
    evts = db.all('SELECT * FROM events WHERE lower(name) LIKE ? ORDER BY date DESC LIMIT 30', like);
    regs = db.all(`SELECT g.*, e.name AS event_name, e.date AS event_date, p.first_name, p.last_name FROM registrations g
      JOIN events e ON e.id = g.event_id LEFT JOIN persons p ON p.id = g.person_id
      WHERE lower(coalesce(g.entered_first_name,'') || ' ' || coalesce(g.entered_last_name,'')) LIKE ?
         OR lower(coalesce(p.first_name,'') || ' ' || coalesce(p.last_name,'')) LIKE ?
      ORDER BY e.date DESC LIMIT 50`, like, like);
  }
  // Ein einziger Treffer -> direkt öffnen
  if (req.query.go && people.length + evts.length === 1 && !regs.length) {
    return res.redirect(people.length ? `/personen/${people[0].id}` : `/einsaetze/${evts[0].id}`);
  }
  res.render('pages/search', { title: 'Suche', q, people, evts, regs });
});

module.exports = router;
