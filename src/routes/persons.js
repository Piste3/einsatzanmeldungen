'use strict';
const express = require('express');
const multerless = require('../lib/upload');
const db = require('../db');
const auth = require('../auth');
const persons = require('../services/persons');
const registrations = require('../services/registrations');
const inquiries = require('../services/inquiries');
const feedback = require('../services/feedback');
const importer = require('../services/importer');
const audit = require('../services/audit');
const { sendTable, wantsExport } = require('../lib/export');
const { flash } = require('../lib/view-helpers');
const h = require('../lib/view-helpers');
const { DIET, PERSON_STATUS, FEEDBACK, SOURCE, REG_STATUS } = require('../lib/labels');
const { ValidationError, ConflictError } = require('../services/errors');
const { today } = require('../lib/dates');

const router = express.Router();

function options() {
  return {
    ranks: db.all('SELECT * FROM ranks WHERE active = 1 ORDER BY sort, name'),
    teams: db.all('SELECT * FROM teams WHERE active = 1 ORDER BY sort, name'),
  };
}

router.get('/personen', (req, res) => {
  const filters = { q: req.query.q || '', team: req.query.team || '', rank: req.query.rank || '', status: req.query.status || 'aktiv', sort: req.query.sort || 'rang' };
  const list = persons.list(filters);
  const isAdmin = auth.isAdmin(req.user);
  const format = wantsExport(req);
  if (format) {
    const cols = [
      { label: 'Rang', value: (p) => p.rank_short || '' },
      { label: 'Vorname', value: (p) => p.first_name },
      { label: 'Nachname', value: (p) => p.last_name },
      { label: 'Mannschaft / Kader', value: (p) => p.teams || '' },
      { label: 'Jahrgang', value: (p) => h.birthYear(p) },
      { label: 'Mobil', value: (p) => p.mobile || '' },
      { label: 'E-Mail', value: (p) => p.email || '' },
      { label: 'Status', value: (p) => PERSON_STATUS[p.status].label },
    ];
    // Sensible Spalten nur mit Recht
    if (isAdmin) {
      cols.push({ label: 'Geburtsdatum', value: (p) => h.fmtDate(p.birth_date) });
      cols.push({ label: 'Essenseinschränkung', value: (p) => [DIET[p.diet_category], p.diet_text].filter(Boolean).join(': ') });
    }
    cols.push({ label: 'Interne Bemerkung', value: (p) => p.internal_note || '' });
    return sendTable(res, format, 'Personen', cols, list);
  }
  res.render('pages/persons', { title: 'Personen', list, filters, ...options(), liveTopics: ['persons'] });
});

// Sammelaktion (Admin): Status setzen
router.post('/personen/sammel', auth.requireAdmin, (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  const status = req.body.status;
  if (!PERSON_STATUS[status] || !ids.length) throw new ValidationError(['Bitte Personen ankreuzen und einen Status wählen.']);
  for (const id of ids) {
    const p = persons.get(id);
    if (p && p.status !== status) persons.update(id, { ...p, status, team_ids: p.team_ids }, p.version, req.user);
  }
  flash(res, 'success', `${ids.length} Person${ids.length === 1 ? '' : 'en'} auf «${PERSON_STATUS[status].label}» gesetzt.`);
  res.redirect(String(req.body.back || '').startsWith('/') ? req.body.back : '/personen');
});

router.get('/personen/neu', auth.requireAdmin, (req, res) => {
  res.render('pages/person-form', {
    title: 'Neue Person', p: { status: 'aktiv', team_ids: [], first_name: req.query.first_name || '', last_name: req.query.last_name || '' },
    isNew: true, errors: [], from: req.query.from || '', ...options(),
  });
});

router.post('/personen', auth.requireAdmin, (req, res, next) => {
  try {
    const id = persons.create(req.body, req.user);
    // Aus der Klärungsliste: neue Person direkt zuordnen
    if (req.body.from_registration) {
      registrations.assignPerson(Number(req.body.from_registration), id, req.user, { saveAlias: false });
      flash(res, 'success', 'Person angelegt und der Anmeldung zugeordnet.');
      return res.redirect('/klaerungen');
    }
    flash(res, 'success', 'Person angelegt.');
    res.redirect(`/personen/${id}`);
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).render('pages/person-form', { title: 'Neue Person', p: { ...req.body, team_ids: [].concat(req.body.team_ids || []).map(Number) }, isNew: true, errors: err.messages, from: req.body.from_registration || '', ...options() });
    next(err);
  }
});

// Import aus ClubDesk (Excel/CSV)
router.get('/personen/import', auth.requireAdmin, (req, res) => {
  res.render('pages/import', { title: 'Personen importieren', preview: null, fields: importer.FIELDS, errors: [] });
});

router.post('/personen/import', auth.requireAdmin, multerless.single('datei', 10 * 1024 * 1024), (req, res) => {
  try {
    let preview;
    if (req.file) preview = importer.createPreview(req.file.buffer, req.file.filename);
    else if (req.body.preview_id) {
      const mapping = {};
      for (const k of Object.keys(importer.FIELDS)) if (req.body[`map_${k}`] !== undefined && req.body[`map_${k}`] !== '') mapping[k] = Number(req.body[`map_${k}`]);
      if (req.body.commit === '1') {
        const actions = {};
        for (const [k, v] of Object.entries(req.body)) if (k.startsWith('action_')) actions[k.slice(7)] = v;
        const stats = importer.commit(req.body.preview_id, mapping, actions, req.user);
        flash(res, 'success', `Import abgeschlossen: ${stats.created} angelegt, ${stats.updated} ergänzt, ${stats.skipped} übersprungen.`);
        return res.redirect('/personen');
      }
      preview = importer.getPreview(req.body.preview_id, mapping);
      if (!preview) throw new Error('Die Vorschau ist abgelaufen. Bitte die Datei erneut hochladen.');
    } else throw new Error('Bitte eine Datei wählen.');
    res.render('pages/import', { title: 'Personen importieren', preview, fields: importer.FIELDS, errors: [] });
  } catch (err) {
    res.status(400).render('pages/import', { title: 'Personen importieren', preview: null, fields: importer.FIELDS, errors: [err.message] });
  }
});

// Seite eines Mitglieds
router.get('/personen/:id', (req, res) => {
  const p = persons.get(Number(req.params.id));
  if (!p) return res.status(404).render('pages/error', { title: 'Nicht gefunden', message: 'Diese Person existiert nicht.' });
  const regs = registrations.listForPerson(p.id);
  const inqs = inquiries.forPerson(p.id);
  const upcoming = feedback.upcomingEvents('12m').filter((e) => e.status === 'veroeffentlicht');
  const groups = { an: [], ab: [], unsicher: [], offen: [] };
  for (const e of upcoming) {
    const reg = regs.find((r) => r.event_id === e.id);
    const inq = inqs.find((i) => i.event_id === e.id);
    const c = feedback.cellState(reg, inq);
    groups[c.state].push({ event: e, reg, inq });
  }
  // Anmeldungen bei Entwürfen trotzdem zeigen
  for (const reg of regs.filter((r) => r.event_date >= today() && !upcoming.some((e) => e.id === r.event_id) && ['entwurf', 'veroeffentlicht'].includes(r.event_status))) {
    const c = feedback.cellState(reg, inqs.find((i) => i.event_id === reg.event_id));
    groups[c.state].push({ event: { id: reg.event_id, name: reg.event_name, date: reg.event_date }, reg, inq: null });
  }
  const past = regs.filter((r) => r.event_date < today() || ['abgeschlossen', 'abgesagt'].includes(r.event_status));
  const format = wantsExport(req);
  if (format) {
    const rows = [
      ...Object.entries(groups).flatMap(([state, items]) => items.map((i) => ({ ...i, state }))),
      ...past.map((reg) => ({ event: { name: reg.event_name, date: reg.event_date }, reg, state: 'frueher' })),
    ];
    return sendTable(res, format, `${p.first_name} ${p.last_name}`, [
      { label: 'Datum', value: (r) => h.fmtDate(r.event.date) },
      { label: 'Einsatz', value: (r) => r.event.name },
      { label: 'Rückmeldung', value: (r) => (r.state === 'frueher' ? 'Früherer Einsatz' : FEEDBACK[r.state].label) },
      { label: 'Status', value: (r) => (r.reg ? REG_STATUS[r.reg.status].label : r.inq ? h.labels.INQUIRY_STATUS[r.inq.status].label : '') },
      { label: 'Schicht', value: (r) => r.reg?.assigned.map((a) => a.name).join(', ') || '' },
      { label: 'Quelle', value: (r) => (r.reg ? SOURCE[r.reg.source] : '') },
      { label: 'Angemeldet', value: (r) => (r.reg ? h.fmtDateTime(r.reg.registered_at) : '') },
    ], rows);
  }
  res.render('pages/person', {
    title: `${p.first_name} ${p.last_name}`, p, groups, past, inqs, canSeeDiet: persons.canSeeDiet(req.user, p.id),
    log: audit.forPerson(p.id, 30), shiftChoices: require('../services/feedback').shiftChoices(), allUsers: db.all('SELECT id, display_name FROM users WHERE active = 1 ORDER BY display_name'),
    linkedUser: db.one('SELECT username, display_name, role FROM users WHERE person_id = ?', p.id), liveTopics: [`person:${p.id}`],
  });
});

router.get('/personen/:id/bearbeiten', auth.requireAdmin, (req, res) => {
  const p = persons.get(Number(req.params.id));
  if (!p) return res.redirect('/personen');
  res.render('pages/person-form', { title: `${p.first_name} ${p.last_name} bearbeiten`, p, isNew: false, errors: [], from: '', editKey: `person:${p.id}`, impact: persons.deletionImpact(p.id), ...options() });
});

router.post('/personen/:id/bearbeiten', auth.requireAdmin, (req, res, next) => {
  const id = Number(req.params.id);
  try {
    persons.update(id, req.body, req.body.version, req.user);
    flash(res, 'success', 'Stammdaten gespeichert.');
    res.redirect(`/personen/${id}`);
  } catch (err) {
    const p = persons.get(id);
    if (err instanceof ValidationError) return res.status(400).render('pages/person-form', { title: 'Person bearbeiten', p: { ...p, ...req.body, team_ids: [].concat(req.body.team_ids || []).map(Number) }, isNew: false, errors: err.messages, from: '', ...options() });
    if (err instanceof ConflictError) {
      const ranks = Object.fromEntries(db.all('SELECT id, short FROM ranks').map((r) => [r.id, r.short]));
      const show = (k, v) => (k === 'rank_id' ? ranks[v] || '' : v ?? '');
      const rows = Object.entries(persons.FIELD_LABELS).filter(([k]) => k !== 'teams')
        .map(([k, label]) => ({ key: k, label, theirs: show(k, p[k]), mine: show(k, req.body[k]) }))
        .filter((r) => String(r.theirs) !== String(r.mine));
      return res.status(409).render('pages/conflict', {
        title: 'Gleichzeitige Änderung', who: err.lastChange?.user_name || 'jemand anderem', when: err.lastChange?.created_at, summary: err.lastChange?.summary,
        rows, action: `/personen/${id}/bearbeiten`, version: p.version, mine: req.body, backUrl: `/personen/${id}`, editUrl: `/personen/${id}/bearbeiten`,
      });
    }
    next(err);
  }
});

router.post('/personen/:id/loeschen', auth.requireAdmin, (req, res) => {
  const name = persons.remove(Number(req.params.id), req.user);
  flash(res, 'success', `${name} wurde gelöscht.`);
  res.redirect('/personen');
});

router.post('/personen/:id/alias', auth.requireAdmin, (req, res) => {
  const first = String(req.body.first_name || '').trim();
  const last = String(req.body.last_name || '').trim();
  if (!first || !last) throw new ValidationError(['Vor- und Nachname der Namensvariante angeben.']);
  persons.addAlias(Number(req.params.id), first, last, req.user);
  flash(res, 'success', 'Namensvariante gespeichert.');
  res.redirect(`/personen/${req.params.id}/bearbeiten`);
});

router.post('/personen/:id/alias/:aid/loeschen', auth.requireAdmin, (req, res) => {
  persons.removeAlias(Number(req.params.aid), req.user);
  flash(res, 'success', 'Namensvariante entfernt.');
  res.redirect(`/personen/${req.params.id}/bearbeiten`);
});

module.exports = router;
