'use strict';
// Vorlagen mit Bausteinen wie {{einsatz.name}} (Kalendertermin, Anmeldebestätigung)

const TOKEN = /\{\{\s*([\w.\-äöüÄÖÜ ]+?)\s*\}\}/g;

/**
 * Ersetzt Bausteine. Ist omitEmptyLines gesetzt, entfällt jede Zeile,
 * in der ein Baustein leer ist (Konzept 9.5 «Leere Bausteine»).
 */
function render(template, values, { omitEmptyLines = false } = {}) {
  const lines = String(template || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    let hasEmpty = false;
    const replaced = line.replace(TOKEN, (_, key) => {
      const v = lookup(values, key);
      if (v === null || v === undefined || v === '') {
        hasEmpty = true;
        return '';
      }
      return String(v);
    });
    if (omitEmptyLines && hasEmpty) continue;
    out.push(replaced);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function lookup(values, key) {
  if (Object.prototype.hasOwnProperty.call(values, key)) return values[key];
  // Zusatzfelder: Gross-/Kleinschreibung tolerieren
  const lower = key.toLowerCase();
  const found = Object.keys(values).find((k) => k.toLowerCase() === lower);
  return found ? values[found] : '';
}

function tokensIn(template) {
  return [...String(template || '').matchAll(TOKEN)].map((m) => m[1]);
}

module.exports = { render, tokensIn };
