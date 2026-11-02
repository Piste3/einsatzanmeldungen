'use strict';
// Grundausstattung beim ersten Start: Ränge, Funktionen, Vorlagen
const db = require('./index');

module.exports = function seedDefaults() {
  if (db.one('SELECT COUNT(*) AS n FROM ranks').n === 0) {
    const ranks = [['Soldat', 'Sdt'], ['Gefreiter', 'Gfr'], ['Korporal', 'Kpl'], ['Wachtmeister', 'Wm'], ['Feldweibel', 'Fw'], ['Leutnant', 'Lt'], ['Oberleutnant', 'Oblt'], ['Hauptmann', 'Hptm']];
    ranks.forEach(([name, short], i) => db.run('INSERT INTO ranks (name, short, sort) VALUES (?, ?, ?)', name, short, i + 1));
  }
  if (db.one('SELECT COUNT(*) AS n FROM functions').n === 0) {
    const fns = [['Einsatzleiter', 'EL'], ['Sektorchef', 'SC'], ['Busfahrer', 'BF'], ['Einsatzteilnehmer', 'TN']];
    fns.forEach(([name, short], i) => db.run('INSERT INTO functions (name, short, sort, is_default) VALUES (?, ?, ?, ?)', name, short, i + 1, short === 'TN' ? 1 : 0));
  }
  migrateTargets();
  if (db.one('SELECT COUNT(*) AS n FROM question_templates').n === 0) {
    db.run('INSERT INTO question_templates (name, question_text, help_text, sort) VALUES (?, ?, ?, ?)', 'Teilnahme Ja / Nein', 'Kannst du teilnehmen?', null, 1);
    db.run('INSERT INTO question_templates (name, question_text, help_text, sort) VALUES (?, ?, ?, ?)', 'Schichtauswahl', 'Für welche Schichten kannst du?', 'Mehrere Schichten möglich.', 2);
  }
  if (db.one('SELECT COUNT(*) AS n FROM tenue_templates').n === 0) {
    db.run('INSERT INTO tenue_templates (name, text, sort) VALUES (?, ?, ?)', 'Uniform orange + VD', 'Uniform (orange), VD-Material, VD-Jacke\nBitte dem Wetter entsprechend kleiden!', 1);
    db.run('INSERT INTO tenue_templates (name, text, sort) VALUES (?, ?, ?)', 'Ausgangsuniform', 'Ausgangsuniform', 2);
  }
};

// Soll pro Funktion gehört zur Schicht; das Soll der Schicht ist die Summe davon.
// Ältere Stände angleichen (läuft bei jedem Start, ändert nur, was noch nicht passt):
// 1) Soll pro Funktion am Einsatz -> in jede Schicht übernehmen, die noch keines hat
// 2) Schicht mit Soll-Anzahl, aber ohne Soll pro Funktion -> alles als Standardfunktion (Einsatzteilnehmer)
// 3) Soll der Schicht = Summe
function migrateTargets() {
  const parse = (s) => { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const sum = (t) => Object.values(t).reduce((a, n) => a + (Number(n) > 0 ? Number(n) : 0), 0);
  const def = db.one('SELECT id FROM functions WHERE is_default = 1 ORDER BY sort LIMIT 1');
  for (const e of db.all("SELECT id, function_targets FROM events WHERE function_targets NOT IN ('', '{}')")) {
    const t = parse(e.function_targets);
    for (const s of db.all("SELECT id, target_count FROM shifts WHERE event_id = ? AND function_targets IN ('', '{}')", e.id)) {
      if (!sum(t)) continue;
      // Hatte die Schicht schon ein Soll, bleibt es: EL/SC/BF … übernehmen, der Rest sind Einsatzteilnehmer
      const out = { ...t };
      if (def && s.target_count > 0) {
        delete out[def.id];
        const rest = s.target_count - sum(out);
        if (rest > 0) out[def.id] = rest;
      }
      db.run('UPDATE shifts SET function_targets = ? WHERE id = ?', JSON.stringify(out), s.id);
    }
    db.run("UPDATE events SET function_targets = '{}' WHERE id = ?", e.id);
  }
  if (def) {
    for (const s of db.all("SELECT id, target_count FROM shifts WHERE function_targets IN ('', '{}') AND target_count > 0")) {
      db.run('UPDATE shifts SET function_targets = ? WHERE id = ?', JSON.stringify({ [def.id]: s.target_count }), s.id);
    }
  }
  for (const s of db.all("SELECT id, target_count, function_targets FROM shifts WHERE function_targets NOT IN ('', '{}')")) {
    const n = sum(parse(s.function_targets)) || null;
    if (n !== s.target_count) db.run('UPDATE shifts SET target_count = ? WHERE id = ?', n, s.id);
  }
}
