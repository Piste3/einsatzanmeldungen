'use strict';
// Handbuch in der App: docs/handbuch/handbuch.md wird mit jedem Update mitgeliefert und hier angezeigt
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { marked } = require('marked');

const router = express.Router();
const DIR = path.join(__dirname, '..', '..', 'docs', 'handbuch');
const FILE = path.join(DIR, 'handbuch.md');

const slug = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Stand des Handbuchs: letzter Git-Commit am Handbuch, sonst Änderungsdatum der Datei
function versionInfo() {
  const stat = fs.statSync(FILE);
  let date = stat.mtime;
  let commit = null;
  try {
    const out = execFileSync('git', ['-c', `safe.directory=${path.join(DIR, '..', '..')}`, 'log', '-1', '--format=%cI %h', '--', 'docs/handbuch'],
      { cwd: path.join(DIR, '..', '..'), encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) { const [iso, hash] = out.split(' '); date = new Date(iso); commit = hash; }
  } catch { /* ohne Git: Dateidatum */ }
  return { date, commit };
}

let cache = null;
function load() {
  const mtime = fs.statSync(FILE).mtimeMs;
  if (cache && cache.mtime === mtime) return cache;
  const md = fs.readFileSync(FILE, 'utf8');
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
  cache = { mtime, html, toc, ...versionInfo() };
  return cache;
}

router.get('/handbuch', (req, res) => {
  const doc = load();
  res.render('pages/handbook', { title: 'Handbuch', doc });
});

router.use('/handbuch/bilder', express.static(path.join(DIR, 'bilder'), { maxAge: '1h' }));

module.exports = router;
