'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeName, nameKey } = require('../src/lib/normalize');
const { writeXlsx, readXlsx } = require('../src/lib/xlsx');
const { writeCsv, readCsv } = require('../src/lib/csv');
const { buildCalendar, fold } = require('../src/lib/ics');
const { render } = require('../src/lib/template');
const html = require('../src/lib/html');
const passwords = require('../src/auth/passwords');

test('Namen werden robust normalisiert', () => {
  assert.equal(normalizeName('  Müller-Lüdenscheidt '), 'mueller luedenscheidt');
  assert.equal(nameKey('Zoë', 'Brändli'), nameKey('zoe', 'braendli'));
  assert.equal(nameKey('René', 'Égli'), nameKey('rene', 'egli'));
});

test('XLSX: Schreiben und Lesen ergibt dieselben Werte', () => {
  const buf = writeXlsx(['Name', 'Zahl', 'Text'], [['Anna «Roth»', 3, 'a & b < c'], ['Ümlaut', 0, '']]);
  const rows = readXlsx(buf);
  assert.deepEqual(rows[0], ['Name', 'Zahl', 'Text']);
  assert.equal(rows[1][0], 'Anna «Roth»');
  assert.equal(Number(rows[1][1]), 3);
  assert.equal(rows[1][2], 'a & b < c');
  assert.equal(rows[2][0], 'Ümlaut');
});

test('CSV: Semikolon, BOM und Schutz vor Formeln', () => {
  const buf = writeCsv(['A', 'B'], [['=SUMME(1)', 'x;y']]);
  const text = Buffer.from(buf).toString('utf8');
  assert.ok(text.startsWith('﻿'));
  assert.ok(text.includes("'=SUMME(1)"));
  const rows = readCsv(Buffer.from(buf));
  assert.equal(rows[1][1], 'x;y');
});

test('ICS: gültiger Kalender mit Zeitzone, Zeilenumbruch und Escaping', () => {
  const ics = buildCalendar([{ uid: 'e1@kkb', sequence: 2, start: '2026-11-03T13:30', end: '2026-11-03T19:30', summary: 'Messe, Basel; Tag', description: 'Zeile 1\nZeile 2', attendees: [{ name: 'Anna Roth', email: 'anna@example.ch' }], reminderMinutes: 1440 }]);
  assert.match(ics, /BEGIN:VTIMEZONE/);
  assert.match(ics, /DTSTART;TZID=Europe\/Zurich:20261103T133000/);
  assert.match(ics, /SEQUENCE:2/);
  assert.match(ics, /SUMMARY:Messe\\, Basel\\; Tag/);
  assert.match(ics, /Zeile 1\\nZeile 2/);
  assert.ok(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75));
  assert.ok(fold('x'.repeat(200)).split('\r\n').length > 1);
});

test('Bausteine: leere Zeilen werden weggelassen', () => {
  const out = render('A {{a}}\nB {{b}}\nC', { a: '1', b: '' }, { omitEmptyLines: true });
  assert.equal(out, 'A 1\nC');
});

test('Passwörter: Hash prüfen und Richtlinie', async () => {
  const hash = await passwords.hashPassword('Sehr-geheim-2026');
  assert.ok(await passwords.verifyPassword('Sehr-geheim-2026', hash));
  assert.ok(!(await passwords.verifyPassword('falsch-falsch', hash)));
  assert.ok(passwords.checkPolicy('kurz', { username: 'x' }).length);
  assert.ok(passwords.checkPolicy('anna-1234567890', { username: 'anna' }).length);
  assert.equal(passwords.checkPolicy('Sehr-geheim-2026', { username: 'anna' }).length, 0);
});

test('PDF: Umlaute, Seitenumbruch und gültige Querverweise', () => {
  const zlib = require('node:zlib');
  const { tablePdf, encode, wrap } = require('../src/lib/pdf');
  assert.deepEqual(encode('äÖ«»–·€→'), [0xe4, 0xd6, 0xab, 0xbb, 150, 0xb7, 128, 45, 62]);
  assert.deepEqual(wrap('eins zwei drei', 10, 30), ['eins', 'zwei', 'drei']);
  const rows = Array.from({ length: 80 }, (_, i) => [String(i + 1), { text: `Person (${i})`, bold: true }, '079 000 00 00']);
  const buf = tablePdf({ title: 'Teilnehmerliste · Zolli', columns: [{ label: 'Nr.', fit: true }, { label: 'Name', width: 2 }, { label: 'Mobil', fit: true }], rows, footer: 'Test' });
  const s = buf.toString('latin1');
  assert.match(s, /\/Count 3 /);
  // Jeder xref-Eintrag zeigt genau auf «n 0 obj»
  const start = Number(s.match(/startxref\n(\d+)/)[1]);
  const entries = s.slice(start).match(/\d{10} 00000 n/g).map((e) => Number(e.slice(0, 10)));
  entries.forEach((off, i) => assert.equal(s.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  // Klammern im Text sind maskiert, Umlaute als Oktalcode
  const first = s.indexOf('stream\n') + 7;
  const len = Number(s.slice(0, first).match(/\/Length (\d+)[^\n]*\nstream\n$/)[1]);
  const content = zlib.inflateSync(buf.subarray(first, first + len)).toString('latin1');
  assert.match(content, /\(Person \\\(0\\\)\) Tj/);
  assert.match(content, /\(Teilnehmerliste \\267 Zolli\) Tj/);
});

test('Formatierte Vorlage: Bausteine, leere Zeilen, Tabellenzeilen und Klartext', () => {
  const tpl = '<div>Hallo <b>{{person.vorname}}</b></div><div><br></div><div>Tenue: <span style="color: red">{{einsatz.tenue}}</span></div>'
    + '<table><tbody><tr><td>Antreten</td><td>{{antreten.zeit}}</td></tr><tr><td>Schicht</td><td>{{schicht.name}}</td></tr></tbody></table>'
    + '<div>Teilnehmende:<br>{{liste}}</div>';
  const r = html.renderTemplate(tpl, { 'person.vorname': 'Anna <x>', 'einsatz.tenue': '', 'antreten.zeit': '08:00', 'schicht.name': '', liste: 'Hptm A\nLt B' }, { omitEmptyLines: true });
  assert.match(r.html, /<b>Anna &lt;x&gt;<\/b>/);
  assert.doesNotMatch(r.html, /Tenue|Schicht/);
  assert.match(r.html, /<td>Antreten<\/td><td>08:00<\/td>/);
  assert.match(r.html, /Hptm A<br>Lt B/);
  assert.equal(r.text, 'Hallo Anna <x>\n\nAntreten | 08:00\n\nTeilnehmende:\nHptm A\nLt B');
});

test('Formatierte Vorlage: gefährliches HTML wird entfernt', () => {
  const out = html.sanitize('<p onclick="x()">a<script>alert(1)</script><a href="javascript:alert(1)">b</a><span style="color:red;background:url(x)">c</span><img src=x onerror=y></p>');
  assert.equal(out, '<p>a<a>b</a><span style="color: red">c</span></p>');
  assert.equal(html.toText(html.textToHtml('a\n\nb')), 'a\n\nb');
});

test('ICS: formatierte Beschreibung als X-ALT-DESC', () => {
  const ics = buildCalendar([{ uid: 'e2@kkb', start: '2026-11-03T13:30', end: '2026-11-03T19:30', summary: 'X', description: 'fett', descriptionHtml: '<b>fett</b>' }]);
  const unfolded = ics.replace(/\r\n /g, '');
  assert.match(unfolded, /DESCRIPTION:fett\r\n/);
  assert.match(unfolded, /X-ALT-DESC;FMTTYPE=text\/html:<!DOCTYPE html>.*<b>fett<\/b>/);
});

test('Handbuch: die PDFs passen zum aktuellen Text, zu den Bildern und zur Vorlage', () => {
  const fs = require('node:fs');
  const handbook = require('../src/lib/handbook');
  const stand = handbook.readStand();
  for (const key of Object.keys(handbook.BOOKS)) {
    assert.ok(fs.existsSync(handbook.pdfPath(key)), `${handbook.BOOKS[key].pdf} fehlt – «npm run handbuch:pdf» ausführen`);
    assert.equal(stand[key]?.quelle, handbook.sourceHash(key),
      `Das PDF «${handbook.BOOKS[key].pdf}» ist veraltet – nach Änderungen am Handbuch «npm run handbuch:pdf» ausführen`);
    for (const src of handbook.images(handbook.source(key))) assert.ok(fs.existsSync(`${handbook.DIR}/${src}`), `Bild fehlt: ${src}`);
  }
});

test('Handbuch-PDF: Seitenzahlen der Kapitel aus den Sprungzielen lesen', () => {
  const { pageNumbers } = require('../scripts/handbuch-pdf');
  const pdf = Buffer.from([
    '%PDF-1.4', '1 0 obj <</Type /Catalog /Pages 2 0 R /Dests 9 0 R>> endobj',
    '2 0 obj <</Type /Pages /Count 3 /Kids [3 0 R 6 0 R]>> endobj',
    '3 0 obj <</Type /Pages /Count 2 /Kids [4 0 R 5 0 R]>> endobj',
    '4 0 obj <</Type /Page /Parent 3 0 R>> endobj', '5 0 obj <</Type /Page /Parent 3 0 R>> endobj',
    '6 0 obj <</Type /Page /Parent 2 0 R>> endobj',
    '9 0 obj <</1-warum [5 0 R /XYZ 0 841 0]\n/2-ablauf#2Dx [6 0 R /XYZ 0 841 0]>> endobj',
    'trailer <</Root 1 0 R>>',
  ].join('\n'), 'latin1');
  assert.deepEqual(pageNumbers(pdf), { '1-warum': 2, '2-ablauf-x': 3 });
});
