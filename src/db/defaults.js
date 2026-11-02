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
  // Einsätze mit nur einer Schicht: Soll der Schicht = Total aus «Soll pro Funktion» (ältere Einträge angleichen)
  for (const e of db.all("SELECT id, function_targets FROM events WHERE function_targets NOT IN ('', '{}')")) {
    let total = 0;
    try { total = Object.values(JSON.parse(e.function_targets)).reduce((a, n) => a + (Number(n) > 0 ? Number(n) : 0), 0); } catch { total = 0; }
    const shifts = db.all('SELECT id, target_count FROM shifts WHERE event_id = ?', e.id);
    if (total > 0 && shifts.length === 1 && shifts[0].target_count !== total) db.run('UPDATE shifts SET target_count = ? WHERE id = ?', total, shifts[0].id);
  }
  if (db.one('SELECT COUNT(*) AS n FROM question_templates').n === 0) {
    db.run('INSERT INTO question_templates (name, question_text, help_text, sort) VALUES (?, ?, ?, ?)', 'Teilnahme Ja / Nein', 'Kannst du teilnehmen?', null, 1);
    db.run('INSERT INTO question_templates (name, question_text, help_text, sort) VALUES (?, ?, ?, ?)', 'Schichtauswahl', 'Für welche Schichten kannst du?', 'Mehrere Schichten möglich.', 2);
  }
  if (db.one('SELECT COUNT(*) AS n FROM tenue_templates').n === 0) {
    db.run('INSERT INTO tenue_templates (name, text, sort) VALUES (?, ?, ?)', 'Uniform orange + VD', 'Uniform (orange), VD-Material, VD-Jacke\nBitte dem Wetter entsprechend kleiden!', 1);
    db.run('INSERT INTO tenue_templates (name, text, sort) VALUES (?, ?, ?)', 'Ausgangsuniform', 'Ausgangsuniform', 2);
  }
};
