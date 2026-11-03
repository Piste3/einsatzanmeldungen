'use strict';
// Handbuch in der App: docs/handbuch/*.md wird mit jedem Update mitgeliefert und hier angezeigt.
// Einsatzleiter sehen unter /handbuch nur ihr eigenes, kurzes Handbuch (einsatzleiter.md).
// «Als PDF» liefert das fertig gestaltete PDF aus docs/handbuch/pdf (erzeugt mit «npm run handbuch:pdf»).
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const handbook = require('../lib/handbook');
const leaders = require('../services/leaders');

const router = express.Router();
const { DIR, BOOKS } = handbook;

// Stand des Handbuchs: letzter Push mit Änderungen am Handbuch (wie im PDF), sonst Änderungsdatum der Datei
function versionInfo(file) {
  const v = handbook.sourceVersion();
  return v.commit ? v : { date: fs.statSync(file).mtime, commit: null };
}

const cache = new Map();
function load(key) {
  const { file } = BOOKS[key];
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(key);
  if (hit && hit.mtime === mtime) return hit;
  const { html, toc } = handbook.render(key);
  const doc = { mtime, html, toc, ...versionInfo(file) };
  cache.set(key, doc);
  return doc;
}

function show(res, key, other, pdfHref) {
  res.render('pages/handbook', { title: BOOKS[key].title, doc: load(key), other, pdfHref });
}

// Das gestaltete PDF im Browser öffnen (neuer Tab); herunterladen geht von dort
function sendPdf(res, key) {
  const file = handbook.pdfPath(key);
  if (!fs.existsSync(file)) {
    return res.status(404).render('pages/error', { title: 'PDF fehlt', message: 'Das PDF des Handbuchs ist in dieser Version nicht vorhanden. Die Seite «Handbuch» zeigt denselben Inhalt.' });
  }
  res.set('Content-Type', 'application/pdf');
  res.set('Content-Disposition', `inline; filename="${BOOKS[key].pdf}"`);
  res.set('Cache-Control', 'no-cache');
  return res.sendFile(file);
}

const isLeader = (req) => leaders.isLeader(req.user);

// Einsatzleiter: nur ihr Handbuch. Alle anderen: das volle Handbuch, das Einsatzleiter-Handbuch zum Nachschauen
router.get('/handbuch', (req, res) => (isLeader(req)
  ? show(res, 'einsatzleiter', null, '/handbuch/pdf')
  : show(res, 'voll', { href: '/handbuch/einsatzleiter', label: 'Handbuch für Einsatzleiter' }, '/handbuch/pdf')));
router.get('/handbuch/einsatzleiter', (req, res) => (isLeader(req)
  ? res.redirect('/handbuch')
  : show(res, 'einsatzleiter', { href: '/handbuch', label: 'Volles Handbuch' }, '/handbuch/einsatzleiter/pdf')));
router.get('/handbuch/pdf', (req, res) => sendPdf(res, isLeader(req) ? 'einsatzleiter' : 'voll'));
router.get('/handbuch/einsatzleiter/pdf', (req, res) => sendPdf(res, 'einsatzleiter'));

router.use('/handbuch/bilder', express.static(path.join(DIR, 'bilder'), { maxAge: '1h' }));

module.exports = router;
