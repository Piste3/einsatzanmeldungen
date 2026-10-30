'use strict';
// CSV für Excel (Schweiz): Semikolon, UTF-8 mit BOM

function cell(v) {
  if (v === null || v === undefined) return '';
  let s = String(v);
  // Schutz vor Formel-Injektion in Excel
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[;"\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function writeCsv(headers, rows) {
  const lines = [headers, ...rows].map((r) => r.map(cell).join(';'));
  return Buffer.from(`﻿${lines.join('\r\n')}\r\n`, 'utf8');
}

// CSV lesen; Trennzeichen (; , Tab) wird erkannt. Akzeptiert UTF-8 und Windows-1252.
function readCsv(buf) {
  let text = buf.toString('utf8');
  if (text.includes('�')) text = buf.toString('latin1');
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/)[0] || '';
  const delim = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

module.exports = { writeCsv, readCsv };
