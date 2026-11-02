'use strict';
// Einfache PDF-Dateien (Titel, Tabelle, Text) direkt erzeugen, ohne Zusatzbibliothek.
// Schrift: Helvetica (in jedem PDF-Betrachter eingebaut), Zeichensatz WinAnsi (deckt Umlaute, «», –, · ab).
const zlib = require('node:zlib');

// Zeichenbreiten (1/1000 der Schriftgrösse) für die Codes 32–255 in WinAnsi, aus den Adobe-AFM-Dateien
const W_REGULAR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,0,556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,500,278,333,556,556,556,556,260,556,333,737,370,556,584,333,737,333,400,584,333,333,333,556,537,278,333,333,365,556,834,834,834,611,667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,556,556,556,556,556,556,556,584,611,556,556,556,556,500,556,0];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,0,556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,556,278,333,556,556,556,556,280,556,333,737,370,556,584,333,737,333,400,584,333,333,333,611,556,278,333,333,365,556,834,834,834,611,722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,611,611,611,611,611,611,611,584,611,611,611,611,611,556,611,0];

// Unicode-Zeichen ausserhalb von Latin-1 -> WinAnsi-Code
const WIN_ANSI = {
  0x20ac: 128, 0x201a: 130, 0x0192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02c6: 136, 0x2030: 137,
  0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149,
  0x2013: 150, 0x2014: 151, 0x02dc: 152, 0x2122: 153, 0x0161: 154, 0x203a: 155, 0x0153: 156, 0x017e: 158, 0x0178: 159,
};
const REPLACE = { '→': '->', '←': '<-', '✓': 'x', '✕': 'x', ' ': ' ', ' ': ' ', '\t': ' ' };

// Text -> Liste von WinAnsi-Codes; nicht darstellbare Zeichen werden ersetzt
function encode(text) {
  const out = [];
  for (const ch of String(text ?? '').normalize('NFC')) {
    if (REPLACE[ch]) { for (const c of REPLACE[ch]) out.push(c.charCodeAt(0)); continue; }
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp <= 126) out.push(cp);
    else if (cp >= 160 && cp <= 255) out.push(cp);
    else if (WIN_ANSI[cp]) out.push(WIN_ANSI[cp]);
    else if (cp >= 32) out.push(63); // «?»
  }
  return out;
}

const charWidth = (code, bold) => ((bold ? W_BOLD : W_REGULAR)[code - 32] || 556);
function textWidth(text, size, bold = false) {
  let w = 0;
  for (const c of encode(text)) w += charWidth(c, bold);
  return (w * size) / 1000;
}

// PDF-Zeichenkette in Klammern, Sonderzeichen als Oktalcode
function pdfString(text) {
  let s = '(';
  for (const c of encode(text)) {
    if (c === 40 || c === 41 || c === 92) s += `\\${String.fromCharCode(c)}`;
    else if (c < 127) s += String.fromCharCode(c);
    else s += `\\${c.toString(8).padStart(3, '0')}`;
  }
  return `${s})`;
}

// Zeilenumbruch auf eine Breite; zu lange Wörter werden hart getrennt
function wrap(text, size, maxWidth, bold = false) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/ +/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, bold) <= maxWidth) { line = candidate; continue; }
      if (line) lines.push(line);
      line = '';
      let rest = word;
      while (textWidth(rest, size, bold) > maxWidth && rest.length > 1) {
        let n = rest.length - 1;
        while (n > 1 && textWidth(rest.slice(0, n), size, bold) > maxWidth) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

const num = (n) => (Math.round(n * 100) / 100).toString();
const GRAY = '0.42 0.45 0.52';
const LINE = '0.86 0.88 0.91';
const HEAD_BG = '0.95 0.96 0.97';

/**
 * Dokument mit Kopf, einer Tabelle und Text darunter.
 * opts: {
 *   title, subtitle: [string], landscape: bool,
 *   columns: [{ label, width (Anteil), fit (so breit wie der Inhalt), align: 'left'|'right' }],
 *   rows: [[string | { text, bold }]],
 *   after: [{ label, text }]   – Absätze unter der Tabelle (label fett),
 *   footer: string             – links unten auf jeder Seite (rechts: Seite x / y),
 *   empty: string              – Text, wenn die Tabelle leer ist
 * }
 */
function tablePdf(opts) {
  const [W, H] = opts.landscape ? [842, 595] : [595, 842];
  const M = 40; // Rand
  const bottom = M + 18; // Platz für die Fusszeile
  const usable = W - 2 * M;
  const size = 9.5;
  const lh = size * 1.3;
  const padX = 5;
  const padY = 4.5;
  // Spalten mit fit: so breit wie der längste Eintrag; der Rest wird nach «width» verteilt
  const cellText = (v) => String(v && typeof v === 'object' ? v.text ?? '' : v ?? '');
  const widths = opts.columns.map((c, i) => (c.fit
    ? Math.max(textWidth(String(c.label || '').toUpperCase(), 7.5, true), ...opts.rows.map((r) => textWidth(cellText(r[i]), size, typeof r[i] === 'object' && Boolean(r[i]?.bold)))) + 2 * padX + 1
    : null));
  const free = usable - widths.reduce((s, w) => s + (w || 0), 0);
  const total = opts.columns.reduce((s, c) => s + (c.fit ? 0 : c.width || 1), 0);
  const cols = [];
  let x = M;
  opts.columns.forEach((c, i) => {
    const w = widths[i] ?? (free * (c.width || 1)) / total;
    cols.push({ ...c, x, w });
    x += w;
  });

  const pages = [];
  let ops;
  let y;
  const newPage = () => { ops = []; pages.push(ops); y = H - M; };
  const text = (str, tx, ty, { bold = false, sz = size, color = null } = {}) => {
    if (str === '' || str === null || str === undefined) return;
    ops.push(`BT ${color ? `${color} rg ` : ''}/${bold ? 'F2' : 'F1'} ${num(sz)} Tf ${num(tx)} ${num(ty)} Td ${pdfString(str)} Tj ET${color ? ' 0 g' : ''}`);
  };
  const hline = (ly) => ops.push(`${LINE} RG 0.6 w ${num(M)} ${num(ly)} m ${num(W - M)} ${num(ly)} l S`);

  const header = () => {
    const h = lh + 2 * padY;
    ops.push(`${HEAD_BG} rg ${num(M)} ${num(y - h)} ${num(usable)} ${num(h)} re f 0 g`);
    for (const c of cols) {
      const label = String(c.label || '').toUpperCase();
      const tw = textWidth(label, 7.5, true);
      text(label, c.align === 'right' ? c.x + c.w - padX - tw : c.x + padX, y - padY - size * 0.85, { bold: true, sz: 7.5, color: GRAY });
    }
    y -= h;
    hline(y);
  };

  newPage();
  // Titel und Untertitel
  for (const line of wrap(opts.title || '', 17, usable, true)) { text(line, M, y - 17, { bold: true, sz: 17 }); y -= 21; }
  y -= 2;
  for (const s of opts.subtitle || []) {
    for (const line of wrap(s, 9.5, usable)) { text(line, M, y - 9.5, { sz: 9.5, color: GRAY }); y -= 13; }
  }
  y -= 10;

  header();
  if (!opts.rows.length && opts.empty) {
    text(opts.empty, M + padX, y - padY - size * 0.85, { color: GRAY });
    y -= lh + 2 * padY;
    hline(y);
  }
  for (const row of opts.rows) {
    const cells = cols.map((c, i) => {
      const v = row[i];
      const cell = v && typeof v === 'object' ? v : { text: v ?? '' };
      return { ...cell, lines: wrap(String(cell.text ?? ''), size, c.w - 2 * padX, Boolean(cell.bold)) };
    });
    const h = Math.max(...cells.map((c) => c.lines.length)) * lh + 2 * padY;
    if (y - h < bottom) { newPage(); header(); }
    cells.forEach((cell, i) => {
      const c = cols[i];
      cell.lines.forEach((line, k) => {
        const tw = c.align === 'right' ? textWidth(line, size, cell.bold) : 0;
        text(line, c.align === 'right' ? c.x + c.w - padX - tw : c.x + padX, y - padY - size * 0.85 - k * lh, { bold: cell.bold, color: cell.muted ? GRAY : null });
      });
    });
    y -= h;
    hline(y);
  }

  // Absätze unter der Tabelle
  y -= 8;
  for (const p of opts.after || []) {
    const label = p.label ? `${p.label} ` : '';
    const lw = textWidth(label, size, true);
    const lines = wrap(p.text || '', size, usable - lw);
    if (y - lines.length * lh - 6 < bottom) newPage();
    if (label) text(label, M, y - size, { bold: true });
    lines.forEach((line, k) => text(line, M + lw, y - size - k * lh, { color: p.muted ? GRAY : null }));
    y -= lines.length * lh + 6;
  }

  // Fusszeile mit Seitenzahl
  pages.forEach((p, i) => {
    ops = p;
    if (opts.footer) text(opts.footer, M, M - 4, { sz: 7.5, color: GRAY });
    const nr = `Seite ${i + 1} / ${pages.length}`;
    text(nr, W - M - textWidth(nr, 7.5), M - 4, { sz: 7.5, color: GRAY });
  });

  return buildPdf(pages.map((p) => p.join('\n')), W, H, opts.title || '');
}

function buildPdf(contents, W, H, title) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalog = add(null);
  const pagesId = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const kids = [];
  for (const c of contents) {
    const data = zlib.deflateSync(Buffer.from(c, 'latin1'));
    const stream = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), data, Buffer.from('\nendstream', 'latin1')]));
    kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;
  const info = add(`<< /Title ${pdfString(title)} /Producer (KKB-Einsatzplaner) >>`);

  const parts = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let offset = parts[0].length;
  const offsets = [];
  objs.forEach((body, i) => {
    const buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    offsets.push(offset);
    offset += buf.length;
    parts.push(buf);
  });
  const xref = [`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}

module.exports = { tablePdf, textWidth, wrap, encode };
