'use strict';
// Beispieldaten wie in der Anleitung (alle Namen und Nummern frei erfunden).
//   npm run seed            -> nur wenn noch keine Personen existieren
//   npm run seed -- --force -> zusätzlich anlegen
const db = require('../src/db');
const persons = require('../src/services/persons');
const events = require('../src/services/events');
const registrations = require('../src/services/registrations');
const inquiries = require('../src/services/inquiries');
const users = require('../src/services/users');
const submissions = require('../src/services/submissions');
const { today, addDays } = require('../src/lib/dates');

(async () => {
  db.open();
  require('../src/db/defaults')();
  if (db.one('SELECT COUNT(*) AS n FROM persons').n > 0 && !process.argv.includes('--force')) {
    console.log('Es gibt bereits Personen – nichts geändert (mit --force trotzdem anlegen).');
    return db.close();
  }
  const system = { id: null, display_name: 'Beispieldaten', role: 'admin' };
  const rank = Object.fromEntries(db.all('SELECT id, short FROM ranks').map((r) => [r.short, r.id]));
  const team = {};
  for (const [i, t] of ['1. Mannschaft', '2. Mannschaft', '3. Mannschaft', 'Kader'].entries()) {
    team[t] = db.one('SELECT id FROM teams WHERE name = ?', t)?.id || Number(db.run('INSERT INTO teams (name, sort) VALUES (?, ?)', t, i + 1).lastInsertRowid);
  }
  const people = [
    ['Elena', 'Graf', 'Wm', '1. Mannschaft', 2008], ['Anna', 'Roth', 'Kpl', 'Kader', 2008], ['Christian', 'Meier', 'Kpl', '1. Mannschaft', 2009],
    ['Christian', 'Meier', 'Sdt', '3. Mannschaft', 2011], ['Laura', 'Meier', 'Gfr', '2. Mannschaft', 2010], ['Leon', 'Fischer', 'Gfr', '2. Mannschaft', 2010],
    ['Jonas', 'Frei', 'Sdt', '2. Mannschaft', 2010], ['Mia', 'Keller', 'Gfr', '2. Mannschaft', 2010], ['Julia', 'Moser', 'Sdt', '3. Mannschaft', 2011],
    ['Ben', 'Schmid', 'Sdt', '3. Mannschaft', 2011], ['David', 'Suter', 'Sdt', '3. Mannschaft', 2011], ['Tim', 'Weber', 'Gfr', '3. Mannschaft', 2010],
    ['Noah', 'Brunner', 'Sdt', '2. Mannschaft', 2011], ['Luca', 'Steiner', 'Sdt', '3. Mannschaft', 2011], ['Sara', 'Huber', 'Gfr', '2. Mannschaft', 2010],
    ['Nina', 'Baumann', 'Sdt', '2. Mannschaft', 2011], ['Paul', 'Kunz', 'Gfr', '1. Mannschaft', 2009], ['Lea', 'Vogel', 'Sdt', '2. Mannschaft', 2011],
    ['Eva', 'Bühler', 'Sdt', '3. Mannschaft', 2011], ['Marco', 'Rüegg', 'Fw', 'Kader', 2004], ['Lena', 'Meier', 'Kpl', 'Kader', 2006],
    ['Simon', 'Koch', 'Sdt', '1. Mannschaft', 2010], ['Rahel', 'Bader', 'Gfr', '1. Mannschaft', 2009],
  ];
  const ids = {};
  people.forEach(([first, last, r, t, year], i) => {
    const id = persons.create({
      first_name: first, last_name: last, status: 'aktiv', rank_id: rank[r], team_ids: [team[t]], birth_year: year,
      mobile: `079 ${String(100 + i * 7).padStart(3, '0')} ${String(10 + i).padStart(2, '0')} ${String(20 + i * 3).slice(-2)}`,
      email: `${first}.${last}@web.kkb.ch`.toLowerCase().replace('ü', 'ue'),
      diet_category: first === 'Jonas' ? 'allergie' : null, diet_text: first === 'Jonas' ? 'Nüsse' : null,
    }, system);
    ids[`${first} ${last}${ids[`${first} ${last}`] ? ' 2' : ''}`] = id;
  });

  // Benutzer «lena» (Aufgebotsstelle), verknüpft mit Lena Meier
  if (!db.one("SELECT 1 FROM users WHERE username = 'lena'")) {
    await users.create({ username: 'lena', display_name: 'Lena Meier', role: 'aufgebotsstelle', person_id: ids['Lena Meier'], password: 'Aufgebot2026!', must_change_password: false }, null);
    console.log('Benutzer «lena» / Passwort «Aufgebot2026!» (Aufgebotsstelle) angelegt.');
  }
  const lena = db.one("SELECT * FROM users WHERE username = 'lena'");

  const tenue = 'Uniform (orange), VD-Material, VD-Jacke\nBitte dem Wetter entsprechend kleiden!';
  const d1 = addDays(today(), 4);
  // Soll pro Funktion (Formularfelder fn_target_<id>)
  const fn = Object.fromEntries(db.all('SELECT id, short FROM functions').map((f) => [f.short, f.id]));
  const fnTargets = (t) => Object.fromEntries(Object.entries(t).map(([k, n]) => [`fn_target_${fn[k]}`, n]));
  const messe = events.create({
    name: '554. Basler Herbstmesse', date: d1, start_time: '13:30', end_time: '23:00', start_place: 'Tramhaltestelle «Clarastrasse» (Tram 6, 14, 15)',
    tenue, leader_person_id: ids['Marco Rüegg'], description: 'Verkehrsdienst rund um die Messe.', ...fnTargets({ EL: 1, SC: 2, BF: 1, TN: 12 }),
  }, lena);
  const shifts = events.shiftsOf(messe);
  events.updateShift(shifts[0].id, { name: 'Tagschicht', start: '13:30', end: '19:30', target_count: 10 }, lena);
  events.addShift(messe, { name: 'Abendschicht', start: '19:00', end: '23:00', target_count: 6 }, lena);
  events.setStatus(messe, 'veroeffentlicht', lena);
  const stadtlauf = events.create({ name: 'Basler Stadtlauf', date: addDays(today(), 32), start_time: '15:00', end_time: '20:00', start_place: 'Marktplatz, vor dem Rathaus', tenue, leader_person_id: ids['Marco Rüegg'], target_count: 15, ...fnTargets({ EL: 1, SC: 1, TN: 13 }) }, lena);
  events.setStatus(stadtlauf, 'veroeffentlicht', lena);
  const markt = events.create({ name: 'Weihnachtsmarkt Münsterplatz', date: addDays(today(), 46), start_time: '16:00', end_time: '21:00', start_place: 'Münsterplatz', target_count: 12 }, lena);
  events.setStatus(markt, 'veroeffentlicht', lena);
  events.create({ name: 'Neujahrsapéro Rathaus', date: addDays(today(), 74), start_time: '10:00', end_time: '14:00', target_count: 8 }, lena);

  const [tag, abend] = events.shiftsOf(messe);
  const reg = (name, eventId, source, wishes, status) => {
    const id = registrations.create({ eventId, personId: ids[name], enteredFirst: name.split(' ')[0], enteredLast: name.split(' ').slice(1).join(' '), matchType: 'auto', source, wishes, user: source === 'formular' ? null : lena });
    if (status && status !== 'neu') registrations.setStatus(id, status, lena, { silent: true });
    return id;
  };
  for (const n of ['Elena Graf', 'Paul Kunz', 'Lea Vogel', 'Simon Koch', 'Rahel Bader']) reg(n, messe, 'formular', [tag.id], 'bestaetigt');
  reg('Anna Roth', messe, 'formular', [tag.id, abend.id], 'bestaetigt');
  reg('Eva Bühler', messe, 'formular', [abend.id], 'bestaetigt');
  reg('Mia Keller', messe, 'whatsapp', [abend.id], 'rueckfrage');
  reg('Luca Steiner', messe, 'formular', [tag.id], 'warteliste');
  reg('Sara Huber', messe, 'formular', [abend.id], 'zurueckgezogen');
  reg('Noah Brunner', messe, 'telefon', [tag.id]);
  // Funktionen an der Herbstmesse: Marco leitet, zwei Sektorchefs, ein Busfahrer
  const functions = require('../src/services/functions');
  functions.assign(reg('Marco Rüegg', messe, 'manuell', [tag.id], 'bestaetigt'), fn.EL, lena, { silent: true });
  const messeRegs = new Map(db.all('SELECT id, person_id FROM registrations WHERE event_id = ?', messe).map((r) => [r.person_id, r.id]));
  functions.assign(messeRegs.get(ids['Elena Graf']), fn.SC, lena, { silent: true });
  functions.assign(messeRegs.get(ids['Anna Roth']), fn.SC, lena, { silent: true });
  functions.assign(messeRegs.get(ids['Simon Koch']), fn.BF, lena, { silent: true });
  for (const n of ['Elena Graf', 'Jonas Frei', 'Christian Meier', 'Tim Weber', 'Anna Roth', 'Simon Koch']) reg(n, stadtlauf, 'formular', [], n === 'Elena Graf' ? 'bestaetigt' : null);

  // Anfragen
  inquiries.addAttempt(messe, ids['David Suter'], { channel: 'telefon', result: 'nicht_erreicht', note: 'keine Antwort' }, lena);
  inquiries.addAttempt(messe, ids['Leon Fischer'], { channel: 'telefon', result: 'nicht_erreicht' }, lena);
  inquiries.addAttempt(messe, ids['Leon Fischer'], { channel: 'whatsapp', result: 'whatsapp' }, lena);
  inquiries.addAttempt(messe, ids['Nina Baumann'], { channel: 'telefon', result: 'zugesagt' }, lena);
  inquiries.addAttempt(messe, ids['Julia Moser'], { channel: 'telefon', result: 'abgesagt', note: 'in den Ferien' }, lena);

  // Zwei Formular-Absendungen über den echten Eingang: Spitzname + Duplikat-Name
  const formFor = () => submissions.issueForm('127.0.0.1');
  for (const [first, last, shiftsWanted] of [['Jonas', 'Frei', [tag.id]], ['Chrigi', 'Meier', [abend.id]]]) {
    const f = formFor();
    db.run('UPDATE form_tokens SET issued_at = ? WHERE uid = ?', new Date(Date.now() - 60000).toISOString(), f.uid);
    const r = submissions.receive({ submission_uid: f.uid, first_name: first, last_name: last, event_ids: [String(messe)], [`shifts_${messe}`]: shiftsWanted.map(String), [`remark_${messe}`]: first === 'Jonas' ? 'Komme direkt vom Training' : '' }, { ip: '127.0.0.1' });
    submissions.processSubmission(r.submission.id);
  }
  {
    const f = formFor();
    db.run('UPDATE form_tokens SET issued_at = ? WHERE uid = ?', new Date(Date.now() - 60000).toISOString(), f.uid);
    const r = submissions.receive({ submission_uid: f.uid, first_name: 'Christian', last_name: 'Meier', event_ids: [String(stadtlauf)], [`answer_${stadtlauf}`]: 'ja' }, { ip: '127.0.0.1' });
    submissions.processSubmission(r.submission.id);
  }
  // Einsatzleiter «marco» (verknüpft mit Marco Rüegg), für die Herbstmesse freigegeben
  if (!db.one("SELECT 1 FROM users WHERE username = 'marco'")) {
    const { id: marco } = await users.create({ username: 'marco', display_name: 'Marco Rüegg', role: 'einsatzleiter', person_id: ids['Marco Rüegg'], password: 'Leitung2026!', must_change_password: false }, null);
    require('../src/services/leaders').grant(messe, marco, lena);
    console.log('Benutzer «marco» / Passwort «Leitung2026!» (Einsatzleiter, Herbstmesse freigegeben) angelegt.');
  }
  console.log('Beispieldaten angelegt.');
  db.close();
})();
