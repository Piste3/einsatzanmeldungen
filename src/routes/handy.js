'use strict';
// Handy-App: schlanke Ansicht für die Übung. Einsatz wählen, Personen anfragen, Anmeldungen ansehen und bestätigen,
// eine Person mit allen kommenden Einsätzen. Einsätze lassen sich hier nicht bearbeiten.
const express = require('express');
const db = require('../db');
const events = require('../services/events');
const inquiries = require('../services/inquiries');
const feedback = require('../services/feedback');
const { ValidationError } = require('../services/errors');
const registrations = require('../services/registrations');
const persons = require('../services/persons');
const undo = require('../services/undo');
const { flash } = require('../lib/view-helpers');
const { ConflictError } = require('../services/errors');
const { today, addDays, fmtDate } = require('../lib/dates');
const { REG_STATUS, REG_STATUS_MANUAL, REG_COUNTING, DIET } = require('../lib/labels');
const { BY_RANK } = require('../lib/sorting');
const userFilters = require('../services/user-filters');

const router = express.Router();

// ---------- Auf dem Handy immer die Handy-App ----------
// Handys erkennt der Einsatzplaner am Browser (Tablets nicht). «Ganze Ansicht» schaltet für eine Stunde auf die PC-Ansicht.
const PHONE = /iPhone|iPod|Android.*Mobile|Mobile.*Firefox|Windows Phone|BlackBerry|Opera Mini/i;
const PC_COOKIE = 'kkb_ansicht';
const KEEP_PC_PATHS = /^\/(handy|handbuch|konto|static|forms|logout)(\/|$)/;

function isPhone(req) {
  return PHONE.test(String(req.get('user-agent') || ''));
}

// Passende Seite in der Handy-App für eine Seite des Einsatzplaners
function handyTarget(path) {
  let m = path.match(/^\/einsaetze\/(\d+)\/anmeldungen$/);
  if (m) return `/handy/einsatz/${m[1]}/anmeldungen`;
  m = path.match(/^\/einsaetze\/(\d+)(\/.*)?$/);
  if (m) return `/handy/einsatz/${m[1]}`;
  m = path.match(/^\/personen\/(\d+)$/);
  if (m) return `/handy/personen/${m[1]}`;
  if (path === '/personen' || path.startsWith('/rueckmeldungen')) return '/handy/personen';
  return '/handy';
}

// Konto-Seiten (Passwort, Zwei-Faktor) zeigt das Handy im Rahmen der Handy-App. Läuft vor den Login-Routen.
function shellMiddleware(req, res, next) {
  if (/^\/konto(\/|$)/.test(req.path) && isPhone(req) && req.cookies?.[PC_COOKIE] !== 'pc' && req.user?.role !== 'einsatzleiter') res.locals.handyShell = true;
  next();
}

router.use((req, res, next) => {
  if (req.method !== 'GET' || req.xhr || !isPhone(req)) return next();
  if (KEEP_PC_PATHS.test(req.path) || req.query.format || req.cookies?.[PC_COOKIE] === 'pc') return next();
  if (!req.accepts('html')) return next();
  res.redirect(handyTarget(req.path));
});

// «Ganze Ansicht»: eine Stunde lang die PC-Ansicht zeigen
router.get('/handy/ganze-ansicht', (req, res) => {
  res.cookie(PC_COOKIE, 'pc', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 3600 * 1000 });
  res.redirect('/');
});

// Jeder Aufruf der Handy-App schaltet wieder auf die Handy-Ansicht
router.use('/handy', (req, res, next) => {
  if (req.method === 'GET' && req.cookies?.[PC_COOKIE]) res.clearCookie(PC_COOKIE, { path: '/' });
  next();
});

// Antworten in der Handy-App: Knopf → Ergebnis des Kontaktversuchs
const ANSWERS = { kann: 'zugesagt', kann_nicht: 'abgesagt', unsicher: 'unsicher', nicht_erreicht: 'nicht_erreicht', gesendet: 'whatsapp' };

// Stand einer Person in einfachen Worten: kann, kann nicht oder noch offen
function answerOf(r) {
  if (r.state === 'zugesagt') return 'kann';
  if (r.state === 'abgesagt') return 'kann_nicht';
  if (r.state === 'angemeldet') return ['zurueckgezogen', 'abgesagt'].includes(r.reg_status) ? 'kann_nicht' : 'kann';
  return 'offen';
}

// Text unter dem Status: woher der Stand kommt
function stateLabel(r) {
  const a = answerOf(r);
  if (a === 'kann') return { text: 'Kann', tone: 'green' };
  if (a === 'kann_nicht') return { text: 'Kann nicht', tone: 'red' };
  return {
    offen: { text: 'Noch nicht gefragt', tone: 'gray' },
    nicht_erreicht: { text: 'Nicht erreicht', tone: 'yellow' },
    whatsapp: { text: 'WhatsApp gesendet', tone: 'blue' },
    unsicher: { text: 'Weiss nicht', tone: 'yellow' },
  }[r.state] || { text: 'Noch nicht gefragt', tone: 'gray' };
}

function locked(e, user) {
  return (e.status === 'abgeschlossen' && user.role !== 'admin') || e.status === 'abgesagt';
}

// Der gewählte Einsatz gilt für die Reiter «Anfragen» und «Anmeldungen» in der Leiste unten
const EVENT_COOKIE = 'kkb_handy_einsatz';

function loadEvent(req, res, next) {
  const e = events.get(Number(req.params.id));
  if (!e) return res.status(404).render('handy/fehler', { title: 'Nicht gefunden', message: 'Diesen Einsatz gibt es nicht.' });
  req.event = e;
  res.locals.event = e;
  res.locals.currentEventId = e.id;
  res.locals.liveTopics = [`event:${e.id}`];
  if (req.method === 'GET') res.cookie(EVENT_COOKIE, String(e.id), { httpOnly: true, sameSite: 'lax', path: '/handy', maxAge: 30 * 86400000 });
  next();
}

// Gemerkter Einsatz, sonst der nächste
function currentEventId(req) {
  const list = upcoming(filterOf(req));
  const saved = Number(req.cookies?.[EVENT_COOKIE]);
  if (saved && (list.some((e) => e.id === saved) || events.get(saved))) return saved;
  return list[0]?.id || null;
}

router.use('/handy', (req, res, next) => {
  if (res.locals.currentEventId === undefined) res.locals.currentEventId = Number(req.cookies?.[EVENT_COOKIE]) || null;
  next();
});

// Knöpfe «Rückgängig» und «Wiederholen» oben: eigene Aktionen der letzten 30 Minuten
router.use('/handy', (req, res, next) => {
  if (req.method === 'GET' && req.user) res.locals.handySteps = undo.state(req.user);
  next();
});

function stepRoute(fn, done) {
  return (req, res) => {
    const b = String(req.body.back || '');
    const target = /^\/handy(\/|$|\?)/.test(b) ? b : '/handy';
    try {
      flash(res, 'success', done(fn(req.user)));
    } catch (err) {
      if (!err.messages) throw err;
      flash(res, 'error', err.messages.join(' '));
    }
    res.redirect(target);
  };
}
router.post('/handy/rueckgaengig', stepRoute(undo.undoLast, (r) => `Rückgängig gemacht: ${r.label}.${r.mailSent ? ' Die Bestätigungsmail war schon verschickt.' : ''}`));
router.post('/handy/wiederholen', stepRoute(undo.redoNext, (r) => `Wiederholt: ${r.label}.`));

// Reiter der Leiste unten
router.get('/handy/anfragen', (req, res) => {
  const id = currentEventId(req);
  res.redirect(id ? `/handy/einsatz/${id}` : '/handy');
});
router.get('/handy/anmeldungen', (req, res) => {
  const id = currentEventId(req);
  res.redirect(id ? `/handy/einsatz/${id}/anmeldungen` : '/handy');
});

function countAnswers(list) {
  const c = { offen: 0, kann: 0, kann_nicht: 0 };
  for (const r of list) c[answerOf(r)] += 1;
  return c;
}

// Zahlen pro Einsatz: angemeldet (zählt zur Besetzung) und noch offen (wie im Reiter Anfragen)
function eventCounts(eventId) {
  const ph = REG_COUNTING.map(() => '?').join(',');
  return {
    angemeldet: db.one(`SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status IN (${ph})`, eventId, ...REG_COUNTING).n,
    offen: inquiries.openCount(eventId),
  };
}

// ---------- Filter: welche Einsätze die Handy-App zeigt (pro Handy, als Cookie) ----------
const FILTER_COOKIE = 'kkb_handy_filter';
const RANGES = {
  1: { days: 31, label: 'Nächster Monat' },
  3: { days: 92, label: 'Nächste 3 Monate' },
  6: { days: 183, label: 'Nächste 6 Monate' },
  12: { days: 366, label: 'Nächste 12 Monate' },
  alle: { days: null, label: 'Alle kommenden' },
};
const DEFAULT_FILTER = { zeit: '6', entwurf: true };

// Gespeichert pro Benutzer (gilt auf allen Geräten); alte Handy-Cookies zählen nur, solange nichts gespeichert ist
function filterOf(req) {
  const saved = userFilters.get(req.user?.id, 'handy');
  const q = new URLSearchParams(saved ? { ...saved } : String(req.cookies?.[FILTER_COOKIE] || ''));
  const zeit = RANGES[q.get('zeit')] ? q.get('zeit') : DEFAULT_FILTER.zeit;
  const entwurf = q.has('entwurf') ? q.get('entwurf') !== '0' : DEFAULT_FILTER.entwurf;
  const label = `${RANGES[zeit].label}${entwurf ? '' : ' · ohne Entwürfe'}`;
  return { zeit, entwurf, label, isDefault: zeit === DEFAULT_FILTER.zeit && entwurf === DEFAULT_FILTER.entwurf };
}

// Laufende und kommende Einsätze nach Filter. Vergangene, abgeschlossene und abgesagte nie.
function upcoming(f = DEFAULT_FILTER) {
  const t = today();
  const days = RANGES[f.zeit].days;
  return db.all(`SELECT e.*, p.first_name AS leader_first, p.last_name AS leader_last, p.mobile AS leader_mobile, r.short AS leader_rank
    FROM events e LEFT JOIN persons p ON p.id = e.leader_person_id LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE e.status IN (${f.entwurf ? "'veroeffentlicht','entwurf'" : "'veroeffentlicht'"}) AND e.date_to >= ?${days ? ' AND e.date_from <= ?' : ''}
    ORDER BY e.date_from, e.start_time, e.id`, t, ...(days ? [addDays(t, days)] : []));
}
const hiddenCount = (shown) => upcoming({ zeit: 'alle', entwurf: true }).length - shown;

router.get('/handy/filter', (req, res) => {
  const t = today();
  const ranges = Object.entries(RANGES).map(([key, r]) => ({ key, label: r.label, until: r.days ? fmtDate(addDays(t, r.days)) : '' }));
  res.render('handy/filter', { title: 'Filter', f: filterOf(req), ranges, total: upcoming({ zeit: 'alle', entwurf: true }).length });
});

router.post('/handy/filter', (req, res) => {
  const zeit = RANGES[req.body.zeit] ? String(req.body.zeit) : DEFAULT_FILTER.zeit;
  const entwurf = req.body.entwurf === '0' ? '0' : '1';
  userFilters.set(req.user.id, 'handy', { zeit, entwurf });
  res.clearCookie(FILTER_COOKIE, { path: '/handy' });
  res.redirect('/handy');
});

// Startseite: laufende und kommende Einsätze (heute zuerst)
router.get('/handy', (req, res) => {
  const f = filterOf(req);
  const list = upcoming(f).map((e) => ({ ...e, counts: eventCounts(e.id) }));
  res.render('handy/start', { title: 'Einsatz wählen', list, todayYmd: today(), f, hidden: hiddenCount(list.length), liveTopics: ['events'] });
});

function personList(e, query) {
  const filters = { team: query.team || '', sort: query.sort === 'rang_ab' ? 'rang_ab' : 'rang' };
  const all = inquiries.listForEvent(e.id, filters);
  for (const r of all) { r.answer = answerOf(r); r.label = stateLabel(r); }
  const counts = countAnswers(all);
  const show = ['offen', 'kann', 'kann_nicht', 'alle'].includes(query.zeige) ? query.zeige : 'offen';
  const list = show === 'alle' ? Array.from(all) : all.filter((r) => r.answer === show);
  return { list, counts, total: all.length, show, filters };
}

// Personen anfragen
router.get('/handy/einsatz/:id', loadEvent, (req, res) => {
  const e = req.event;
  const data = personList(e, req.query);
  res.render('handy/einsatz', {
    title: e.name, ...data, locked: locked(e, req.user),
    shifts: feedback.shiftChoices([e.id])[e.id] || [],
    teams: db.all('SELECT * FROM teams WHERE active = 1 ORDER BY sort, name'),
  });
});

function cardRow(e, personId) {
  const r = inquiries.rowFor(e.id, personId);
  if (!r) return null;
  r.answer = answerOf(r);
  r.label = stateLabel(r);
  return r;
}

// Nach einer Aktion per Script: der Knopf «Rückgängig» oben bekommt die neue letzte Aktion
function undoHeader(req, res) {
  const st = undo.state(req.user);
  if (st.undo) res.set('X-H-Undo', encodeURIComponent(st.undo));
}

function personName(id) {
  const p = db.one('SELECT first_name, last_name FROM persons WHERE id = ?', id);
  return p ? `${p.first_name} ${p.last_name}` : 'Person';
}

const ANSWER_LABEL = { kann: 'Kann', kann_nicht: 'Kann nicht', unsicher: 'Weiss nicht', nicht_erreicht: 'Nicht erreicht', gesendet: 'WhatsApp gesendet' };

function renderCard(req, res, personId) {
  undoHeader(req, res);
  const e = req.event;
  const r = cardRow(e, personId);
  if (!r) return res.status(404).send('');
  res.render('handy/_person', {
    r, cardEvent: e, mode: req.body.ansicht === 'person' ? 'person' : 'einsatz',
    locked: locked(e, req.user), shifts: feedback.shiftChoices([e.id])[e.id] || [],
  });
}

function back(req) {
  const b = String(req.body.back || '');
  return /^\/handy(\/|$|\?)/.test(b) ? b : `/handy/einsatz/${req.event.id}`;
}

// Antwort eintragen. Mit Script kommt nur die neue Karte zurück, ohne Script die ganze Seite.
router.post('/handy/einsatz/:id/antwort', loadEvent, (req, res) => {
  const personId = Number(req.body.person_id);
  const result = ANSWERS[req.body.antwort];
  try {
    if (!result) throw new ValidationError(['Bitte eine Antwort wählen.']);
    const channel = ['telefon', 'whatsapp', 'muendlich'].includes(req.body.channel) ? req.body.channel : 'muendlich';
    undo.record(req.user, { eventId: req.event.id, personId }, `«${ANSWER_LABEL[req.body.antwort]}» für ${personName(personId)} · ${req.event.name}`,
      () => inquiries.addAttempt(req.event.id, personId, { channel, result, shift_ids: req.body.shift_ids, note: req.body.note }, req.user));
  } catch (err) {
    if (!req.xhr) throw err;
    return res.status(400).type('text').send(err.messages ? err.messages.join(' ') : 'Speichern ging nicht. Bitte neu laden.');
  }
  if (req.xhr) return renderCard(req, res, personId);
  res.redirect(`${back(req)}#p${personId}`);
});

// Letzten Eintrag rückgängig machen (falsch getippt)
router.post('/handy/einsatz/:id/zuruecknehmen', loadEvent, (req, res) => {
  const personId = Number(req.body.person_id);
  try {
    undo.record(req.user, { eventId: req.event.id, personId }, `Zurücksetzen bei ${personName(personId)} · ${req.event.name}`, () => {
    if (req.body.attempt_id) inquiries.removeAttempt(req.event.id, Number(req.body.attempt_id), req.user);
    else {
      // Von Hand eingetragene Anmeldung ohne Kontaktversuch: löschen wie am PC. Formular-Anmeldungen bleiben.
      const reg = registrations.get(Number(req.body.reg_id));
      if (!reg || reg.event_id !== req.event.id || reg.person_id !== personId) throw new ValidationError(['Die Anmeldung gibt es nicht mehr. Bitte neu laden.']);
      if (reg.source === 'formular') throw new ValidationError(['Eine Anmeldung aus dem Formular lässt sich hier nicht zurücksetzen.']);
      registrations.remove(reg.id, req.user);
    }
    });
  } catch (err) {
    if (!req.xhr) throw err;
    return res.status(400).type('text').send(err.messages ? err.messages.join(' ') : 'Zurücksetzen ging nicht. Bitte neu laden.');
  }
  if (req.xhr) return renderCard(req, res, personId);
  res.redirect(`${back(req)}#p${personId}`);
});

// Interne Bemerkung zur letzten Antwort
router.post('/handy/einsatz/:id/notiz', loadEvent, (req, res) => {
  const personId = Number(req.body.person_id);
  try {
    undo.record(req.user, { eventId: req.event.id, personId }, `Bemerkung bei ${personName(personId)} · ${req.event.name}`,
      () => inquiries.setAttemptNote(req.event.id, Number(req.body.attempt_id), req.body.note, req.user));
  } catch (err) {
    if (!req.xhr) throw err;
    return res.status(400).type('text').send(err.messages ? err.messages.join(' ') : 'Speichern ging nicht. Bitte neu laden.');
  }
  if (req.xhr) return renderCard(req, res, personId);
  res.redirect(`${back(req)}#${req.body.ansicht === 'person' ? `e${req.event.id}` : `p${personId}`}`);
});

// ---------- Anmeldungen (wie am PC, nur lesen und bestätigen) ----------
const REG_GROUPS = {
  offen: { label: 'Zu bearbeiten', st: ['neu', 'unsicher', 'rueckfrage'] },
  bestaetigt: { label: 'Bestätigt', st: ['bestaetigt'] },
  uebrige: { label: 'Übrige', st: ['warteliste', 'zurueckgezogen', 'abgesagt', 'ungueltig'] },
};

function regCard(e, r, user) {
  if (r.person_id) {
    const p = db.one('SELECT diet_category, diet_text, mobile FROM persons WHERE id = ?', r.person_id) || {};
    r.mobile = p.mobile;
    const has = p.diet_category || p.diet_text;
    r.dietText = !has ? '' : persons.canSeeDiet(user, r.person_id) ? [DIET[p.diet_category], p.diet_text].filter(Boolean).join(': ') : 'Hinweis vorhanden';
  }
  const shiftName = (id) => (e.shifts.find((s) => s.id === id) || {}).name;
  r.shiftText = r.answer === 'nein' ? '' : r.assigned.length ? r.assigned.map((a) => a.name).join(' + ') : r.wishes.length ? `Wunsch: ${r.wishes.map(shiftName).filter(Boolean).join(' + ')}` : '';
  return r;
}

router.get('/handy/einsatz/:id/anmeldungen', loadEvent, (req, res) => {
  const e = req.event;
  const all = registrations.listForEvent(e.id, { sort: req.query.sort === 'rang_ab' ? 'rang_ab' : 'rang' });
  const counts = { offen: 0, bestaetigt: 0, uebrige: 0 };
  const groupOf = (r) => Object.keys(REG_GROUPS).find((k) => REG_GROUPS[k].st.includes(r.status)) || 'uebrige';
  for (const r of all) counts[groupOf(r)] += 1;
  const show = ['offen', 'bestaetigt', 'uebrige', 'alle'].includes(req.query.zeige) ? req.query.zeige : 'alle';
  const list = (show === 'alle' ? all.filter((r) => groupOf(r) !== 'uebrige') : all.filter((r) => groupOf(r) === show)).map((r) => regCard(e, r, req.user));
  res.render('handy/anmeldungen', {
    title: `${e.name} · Anmeldungen`, list, counts, total: all.length, show, groups: REG_GROUPS,
    shifts: events.stats(e).shifts, locked: locked(e, req.user), statusOptions: REG_STATUS_MANUAL,
  });
});

// Status einer Anmeldung setzen (Bestätigen usw.)
router.post('/handy/einsatz/:id/anmeldung/:rid/status', loadEvent, (req, res) => {
  const reg = registrations.get(Number(req.params.rid));
  const to = String(req.body.status || '');
  try {
    if (!reg || reg.event_id !== req.event.id) throw new ValidationError(['Anmeldung nicht gefunden.']);
    if (!REG_STATUS[to]) throw new ValidationError(['Unbekannter Status.']);
    undo.record(req.user, { eventId: req.event.id, personId: reg.person_id, regId: reg.id }, `«${REG_STATUS[to].label}» für ${registrations.personLabel(reg)} · ${req.event.name}`,
      () => registrations.setStatus(reg.id, to, req.user, { expected: req.body.expected || null }));
  } catch (err) {
    if (!req.xhr) throw err;
    const text = err instanceof ConflictError ? 'Jemand anderes hat diese Anmeldung inzwischen geändert. Bitte neu laden.'
      : err.messages ? err.messages.join(' ') : 'Speichern ging nicht. Bitte neu laden.';
    return res.status(400).type('text').send(text);
  }
  if (req.xhr) {
    undoHeader(req, res);
    return res.render('handy/_registration', { r: regCard(req.event, registrations.get(reg.id), req.user), locked: locked(req.event, req.user), statusOptions: REG_STATUS_MANUAL });
  }
  res.redirect(`${back(req)}#r${reg.id}`);
});

// ---------- Profil: Konto, Darstellung, Ganze Ansicht, Abmelden ----------
router.get('/handy/profil', (req, res) => {
  res.render('handy/profil', { title: 'Profil', twofaOn: require('../auth/twofa').isEnabled(req.user) });
});

// ---------- Personen: eine Person, alle kommenden Einsätze ----------
router.get('/handy/personen', (req, res) => {
  const f = filterOf(req);
  const evts = upcoming(f);
  const ids = evts.map((e) => e.id);
  const list = db.all(`SELECT p.id, p.first_name, p.last_name, r.short AS rank_short,
      (SELECT group_concat(t.name, ', ') FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = p.id) AS teams
    FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id WHERE p.status = 'aktiv' ORDER BY ${BY_RANK}`);
  // Zahl der kommenden Einsätze, für die die Person angemeldet ist
  const regs = new Map();
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    for (const x of db.all(`SELECT person_id, COUNT(*) AS n FROM registrations WHERE event_id IN (${ph}) AND person_id IS NOT NULL
        AND status IN (${REG_COUNTING.map(() => '?').join(',')}) GROUP BY person_id`, ...ids, ...REG_COUNTING)) regs.set(x.person_id, x.n);
  }
  for (const p of list) p.angemeldet = regs.get(p.id) || 0;
  res.render('handy/personen', { title: 'Personen', list, eventCount: evts.length, f, hidden: hiddenCount(evts.length), liveTopics: ['events', 'persons'] });
});

router.get('/handy/personen/:pid', (req, res) => {
  const p = db.one('SELECT p.*, r.short AS rank_short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id WHERE p.id = ?', Number(req.params.pid));
  if (!p) return res.status(404).render('handy/fehler', { title: 'Nicht gefunden', message: 'Diese Person gibt es nicht.' });
  p.teams = db.all('SELECT t.name FROM person_teams pt JOIN teams t ON t.id = pt.team_id WHERE pt.person_id = ? ORDER BY t.sort, t.name', p.id).map((t) => t.name).join(', ');
  const f = filterOf(req);
  const evts = upcoming(f);
  const choices = feedback.shiftChoices(evts.map((e) => e.id));
  const cards = evts.map((e) => ({ e, r: cardRow(e, p.id), shifts: choices[e.id] || [], locked: locked(e, req.user) })).filter((c) => c.r);
  res.render('handy/person', { title: `${p.first_name} ${p.last_name}`, p, cards, f, hidden: hiddenCount(evts.length), liveTopics: [`person:${p.id}`, 'events'] });
});

module.exports = router;
module.exports.answerOf = answerOf;
module.exports.isPhone = isPhone;
module.exports.shellMiddleware = shellMiddleware;
