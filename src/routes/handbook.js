'use strict';
// Handbuch in der App: docs/handbuch/*.md wird mit jedem Update mitgeliefert und hier angezeigt.
// Einsatzleiter sehen unter /handbuch nur ihr eigenes, kurzes Handbuch (einsatzleiter.md).
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { marked } = require('marked');
const leaders = require('../services/leaders');

const router = express.Router();
const DIR = path.join(__dirname, '..', '..', 'docs', 'handbuch');
const BOOKS = {
  voll: { file: path.join(DIR, 'handbuch.md'), title: 'Handbuch' },
  einsatzleiter: { file: path.join(DIR, 'einsatzleiter.md'), title: 'Handbuch für Einsatzleiter' },
};

const slug = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Stand des Handbuchs: letzter Git-Commit am Handbuch, sonst Änderungsdatum der Datei
function versionInfo(file) {
  const stat = fs.statSync(file);
  let date = stat.mtime;
  let commit = null;
  try {
    const out = execFileSync('git', ['-c', `safe.directory=${path.join(DIR, '..', '..')}`, 'log', '-1', '--format=%cI %h', '--', 'docs/handbuch'],
      { cwd: path.join(DIR, '..', '..'), encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) { const [iso, hash] = out.split(' '); date = new Date(iso); commit = hash; }
  } catch { /* ohne Git: Dateidatum */ }
  return { date, commit };
}

const cache = new Map();
function load(key) {
  const { file } = BOOKS[key];
  const mtime = fs.statSync(file).mtimeMs;
  const hit = cache.get(key);
  if (hit && hit.mtime === mtime) return hit;
  const md = fs.readFileSync(file, 'utf8');
  const toc = [];
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth, text }) {
    const id = slug(text);
    if (depth <= 2) toc.push({ id, text, depth });
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };
  // Bilder relativ zum Handbuch-Ordner
  renderer.image = function ({ href, title, text }) {
    const src = /^https?:|^\//.test(href) ? href : `/handbuch/${href.replace(/^\.\//, '')}`;
    return `<figure><img src="${src}" alt="${text || ''}" loading="lazy">${title || text ? `<figcaption>${title || text}</figcaption>` : ''}</figure>`;
  };
  const html = marked.parse(md, { renderer });
  const doc = { mtime, html, toc, ...versionInfo(file) };
  cache.set(key, doc);
  return doc;
}

function show(res, key, other) {
  res.render('pages/handbook', { title: BOOKS[key].title, doc: load(key), other });
}

// Einsatzleiter: nur ihr Handbuch. Alle anderen: das volle Handbuch, das Einsatzleiter-Handbuch zum Nachschauen
router.get('/handbuch', (req, res) => (leaders.isLeader(req.user)
  ? show(res, 'einsatzleiter')
  : show(res, 'voll', { href: '/handbuch/einsatzleiter', label: 'Handbuch für Einsatzleiter' })));
router.get('/handbuch/einsatzleiter', (req, res) => (leaders.isLeader(req.user)
  ? res.redirect('/handbuch')
  : show(res, 'einsatzleiter', { href: '/handbuch', label: 'Volles Handbuch' })));

router.use('/handbuch/bilder', express.static(path.join(DIR, 'bilder'), { maxAge: '1h' }));

module.exports = router;
