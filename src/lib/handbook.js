'use strict';
// Handbücher (docs/handbuch/*.md): Markdown → HTML, Inhaltsverzeichnis und Prüfsumme.
// Wird von der Seite «Handbuch» (src/routes/handbook.js) und vom PDF-Erzeuger
// (scripts/handbuch-pdf.js) gemeinsam benutzt, damit beide dasselbe zeigen.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { marked } = require('marked');

const DIR = path.join(__dirname, '..', '..', 'docs', 'handbuch');
const PDF_DIR = path.join(DIR, 'pdf');
const STAND_FILE = path.join(PDF_DIR, 'stand.json');

const BOOKS = {
  voll: {
    file: path.join(DIR, 'handbuch.md'),
    title: 'Handbuch',
    subtitle: 'Anleitung für die Aufgebotsstelle und die Admins',
    pdf: 'KKB-Einsatzplaner_Handbuch.pdf',
  },
  einsatzleiter: {
    file: path.join(DIR, 'einsatzleiter.md'),
    title: 'Handbuch für Einsatzleiter',
    subtitle: 'Kurzanleitung für die Rolle «Einsatzleiter»',
    pdf: 'KKB-Einsatzplaner_Handbuch_Einsatzleiter.pdf',
  },
};

const slug = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Markdown einlesen (Zeilenenden vereinheitlicht, damit Windows-Checkouts dieselbe Prüfsumme ergeben)
function source(key) {
  return fs.readFileSync(BOOKS[key].file, 'utf8').replace(/\r\n/g, '\n');
}

// Bilder, die ein Handbuch verwendet (relativ zu docs/handbuch)
function images(md) {
  return [...md.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((m) => m[1]).filter((src) => !/^https?:|^\//.test(src));
}

// Markdown → { html, toc }. imageSrc bestimmt, wie Bildpfade im HTML stehen;
// linkHref darf Links umschreiben (null = nur Text, z. B. App-Links im PDF).
function render(key, { imageSrc = (src) => `/handbuch/${src}`, linkHref = (href) => href } = {}) {
  const md = source(key);
  const toc = [];
  const renderer = new marked.Renderer();
  renderer.heading = function ({ tokens, depth, text }) {
    const id = slug(text);
    if (depth <= 3) toc.push({ id, text, depth });
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
  };
  renderer.image = function ({ href, title, text }) {
    const local = !/^https?:|^\//.test(href);
    const src = local ? imageSrc(href.replace(/^\.\//, '')) : href;
    return `<figure><img src="${src}" alt="${text || ''}" loading="lazy">${title || text ? `<figcaption>${title || text}</figcaption>` : ''}</figure>`;
  };
  const baseLink = renderer.link.bind(renderer);
  renderer.link = function (token) {
    const href = linkHref(token.href);
    if (href === null) return `<span class="applink">${this.parser.parseInline(token.tokens)}</span>`;
    return baseLink({ ...token, href });
  };
  const html = marked.parse(md, { renderer });
  return { md, html, toc };
}

// Prüfsumme über Text, Bilder und PDF-Vorlage: ändert sich etwas davon, muss das PDF neu erzeugt werden
const PDF_TEMPLATE = path.join(__dirname, '..', '..', 'scripts', 'handbuch-pdf.js');
function sourceHash(key) {
  const md = source(key);
  const h = crypto.createHash('sha256').update(md);
  for (const src of [...new Set(images(md))].sort()) {
    h.update(`\0${src}\0`);
    h.update(fs.readFileSync(path.join(DIR, src)));
  }
  h.update(fs.readFileSync(PDF_TEMPLATE, 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 16);
}

function pdfPath(key) {
  return path.join(PDF_DIR, BOOKS[key].pdf);
}

function readStand() {
  try { return JSON.parse(fs.readFileSync(STAND_FILE, 'utf8')); } catch { return {}; }
}

module.exports = { DIR, PDF_DIR, STAND_FILE, BOOKS, slug, source, images, render, sourceHash, pdfPath, readStand };
