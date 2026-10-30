'use strict';
// Namens-Normalisierung gemäss Konzept 7.1:
// Kleinschreibung, Ränder/Mehrfachleerzeichen, Umlaute/Akzente (ä→ae, é→e, ß→ss), Bindestriche als Trenner.
const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', å: 'a' };

function normalizeName(s) {
  let out = String(s || '').toLowerCase();
  out = out.replace(/[äöüßæœøå]/g, (c) => UMLAUTS[c]);
  out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  out = out.replace(/[-‐‑–—_.,']/g, ' ');
  out = out.replace(/[^a-z0-9 ]/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

function nameKey(first, last) {
  return `${normalizeName(first)}|${normalizeName(last)}`;
}

module.exports = { normalizeName, nameKey };
