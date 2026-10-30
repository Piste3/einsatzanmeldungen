'use strict';
// Verwaltung: Benutzer, Auswahllisten, Vorlagen, Einstellungen (nur Admin)
const express = require('express');
const db = require('../db');
const auth = require('../auth');
const config = require('../config');
const users = require('../services/users');
const settings = require('../services/settings');
const events = require('../services/events');
const calendar = require('../services/calendar');
const backup = require('../services/backup');
const audit = require('../services/audit');
const mailer = require('../lib/mailer');
const { render } = require('../lib/template');
const { flash } = require('../lib/view-helpers');
const { ValidationError } = require('../services/errors');
const { today } = require('../lib/dates');

const router = express.Router();
router.use('/verwaltung', auth.requireAdmin);

router.get('/verwaltung', (req, res) => res.redirect('/verwaltung/benutzer'));

function personOptions() {
  return db.all(`SELECT p.id, p.first_name, p.last_name, r.short AS rank_short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.status = 'aktiv' ORDER BY p.last_name, p.first_name`);
}

// ---- Benutzer ----
router.get('/verwaltung/benutzer', (req, res) => {
  res.render('admin/users', { title: 'Benutzer', list: users.list(), providers: auth.providers().map((p) => p.id), msProviderConfigured: config.authProviders.includes('microsoft') });
});

router.get('/verwaltung/benutzer/neu', (req, res) => {
  res.render('admin/user-form', { title: 'Neues Benutzerkonto', u: { role: 'aufgebotsstelle', active: 1 }, isNew: true, errors: [], persons: personOptions() });
});

router.post('/verwaltung/benutzer', async (req, res, next) => {
  try {
    const { id, password } = await users.create({ ...req.body, password: req.body.password || null }, req.user);
    res.render('admin/user-created', { title: 'Benutzerkonto angelegt', u: users.get(id), password: req.body.password ? null : password });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).render('admin/user-form', { title: 'Neues Benutzerkonto', u: req.body, isNew: true, errors: err.messages, persons: personOptions() });
    next(err);
  }
});

router.get('/verwaltung/benutzer/:id', (req, res) => {
  const u = users.get(Number(req.params.id));
  if (!u) return res.redirect('/verwaltung/benutzer');
  res.render('admin/user-form', { title: u.display_name, u, isNew: false, errors: [], persons: personOptions() });
});

router.post('/verwaltung/benutzer/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    users.update(id, req.body, req.user);
    flash(res, 'success', 'Benutzerkonto gespeichert.');
    res.redirect('/verwaltung/benutzer');
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    res.status(400).render('admin/user-form', { title: 'Benutzerkonto', u: { ...users.get(id), ...req.body }, isNew: false, errors: err.messages, persons: personOptions() });
  }
});

router.post('/verwaltung/benutzer/:id/passwort', async (req, res) => {
  const u = users.get(Number(req.params.id));
  const password = await users.resetPassword(u.id, req.user);
  res.render('admin/user-created', { title: 'Passwort zurückgesetzt', u, password, reset: true });
});

router.post('/verwaltung/benutzer/:id/entsperren', (req, res) => {
  users.unlock(Number(req.params.id), req.user);
  flash(res, 'success', 'Konto entsperrt.');
  res.redirect('/verwaltung/benutzer');
});

// ---- Auswahllisten: Ränge, Mannschaften ----
router.get('/verwaltung/listen', (req, res) => {
  res.render('admin/lists', {
    title: 'Auswahllisten',
    ranks: db.all('SELECT r.*, (SELECT COUNT(*) FROM persons p WHERE p.rank_id = r.id) AS used FROM ranks r ORDER BY sort, name'),
    teams: db.all('SELECT t.*, (SELECT COUNT(*) FROM person_teams pt WHERE pt.team_id = t.id) AS used FROM teams t ORDER BY sort, name'),
  });
});

router.post('/verwaltung/listen/:kind', (req, res) => {
  const kind = req.params.kind;
  const table = { raenge: 'ranks', mannschaften: 'teams' }[kind];
  if (!table) return res.redirect('/verwaltung/listen');
  const name = String(req.body.name || '').trim();
  const id = Number(req.body.id || 0);
  if (req.body.delete === '1' && id) {
    const used = table === 'ranks' ? db.one('SELECT COUNT(*) AS n FROM persons WHERE rank_id = ?', id).n : db.one('SELECT COUNT(*) AS n FROM person_teams WHERE team_id = ?', id).n;
    if (used) throw new ValidationError(['Wird noch verwendet – stattdessen deaktivieren.']);
    db.run(`DELETE FROM ${table} WHERE id = ?`, id);
  } else {
    if (!name) throw new ValidationError(['Name fehlt.']);
    const sort = Number(req.body.sort || 0);
    const active = req.body.active === '1' || !id ? 1 : 0;
    if (table === 'ranks') {
      const short = String(req.body.short || '').trim() || name;
      if (id) db.run('UPDATE ranks SET name = ?, short = ?, sort = ?, active = ? WHERE id = ?', name, short, sort, active, id);
      else db.run('INSERT INTO ranks (name, short, sort) VALUES (?, ?, ?)', name, short, sort || (db.one('SELECT max(sort) AS m FROM ranks').m || 0) + 1);
    } else if (id) db.run('UPDATE teams SET name = ?, sort = ?, active = ? WHERE id = ?', name, sort, active, id);
    else db.run('INSERT INTO teams (name, sort) VALUES (?, ?)', name, sort || (db.one('SELECT max(sort) AS m FROM teams').m || 0) + 1);
  }
  audit.log({ entity: 'settings', action: 'lists', summary: `${req.user.display_name} hat die Auswahlliste «${kind === 'raenge' ? 'Ränge' : 'Mannschaften'}» geändert`, user: req.user });
  flash(res, 'success', 'Gespeichert.');
  res.redirect('/verwaltung/listen');
});

// ---- Vorlagen: Anmeldefragen, Tenue, Zusatzfelder ----
router.get('/verwaltung/vorlagen', (req, res) => {
  res.render('admin/templates', {
    title: 'Vorlagen',
    questions: db.all('SELECT * FROM question_templates ORDER BY sort, name'),
    tenues: db.all('SELECT * FROM tenue_templates ORDER BY sort, name'),
    extras: events.extraDefs(),
  });
});

router.post('/verwaltung/vorlagen/:kind', (req, res) => {
  const id = Number(req.body.id || 0);
  const del = req.body.delete === '1';
  const sort = Number(req.body.sort || 0);
  const name = String(req.body.name || '').trim();
  if (!del && !name) throw new ValidationError(['Name fehlt.']);
  switch (req.params.kind) {
    case 'fragen': {
      if (del) db.run('UPDATE events SET question_template_id = NULL WHERE question_template_id = ?', id), db.run('DELETE FROM question_templates WHERE id = ?', id);
      else if (id) db.run('UPDATE question_templates SET name = ?, question_text = ?, help_text = ?, sort = ? WHERE id = ?', name, String(req.body.question_text || '').trim() || name, String(req.body.help_text || '').trim() || null, sort, id);
      else db.run('INSERT INTO question_templates (name, question_text, help_text, sort) VALUES (?, ?, ?, ?)', name, String(req.body.question_text || '').trim() || name, String(req.body.help_text || '').trim() || null, sort);
      break;
    }
    case 'tenue': {
      if (del) db.run('DELETE FROM tenue_templates WHERE id = ?', id);
      else if (id) db.run('UPDATE tenue_templates SET name = ?, text = ?, sort = ? WHERE id = ?', name, String(req.body.text || ''), sort, id);
      else db.run('INSERT INTO tenue_templates (name, text, sort) VALUES (?, ?, ?)', name, String(req.body.text || ''), sort);
      break;
    }
    case 'zusatzfelder': {
      const type = ['text', 'textarea', 'number', 'date', 'checkbox'].includes(req.body.field_type) ? req.body.field_type : 'text';
      if (!del && /[{}]/.test(name)) throw new ValidationError(['Der Feldname darf keine geschweiften Klammern enthalten.']);
      if (del) db.run('DELETE FROM extra_fields WHERE id = ?', id);
      else if (id) db.run('UPDATE extra_fields SET name = ?, field_type = ?, required = ?, sort = ? WHERE id = ?', name, type, req.body.required ? 1 : 0, sort, id);
      else {
        if (db.one('SELECT 1 FROM extra_fields WHERE name = ?', name)) throw new ValidationError(['Dieses Zusatzfeld gibt es schon.']);
        db.run('INSERT INTO extra_fields (name, field_type, required, sort) VALUES (?, ?, ?, ?)', name, type, req.body.required ? 1 : 0, sort);
      }
      break;
    }
    default: return res.redirect('/verwaltung/vorlagen');
  }
  audit.log({ entity: 'settings', action: 'templates', summary: `${req.user.display_name} hat Vorlagen geändert`, user: req.user });
  flash(res, 'success', 'Gespeichert.');
  res.redirect('/verwaltung/vorlagen');
});

// ---- Allgemeine Einstellungen + Anmeldebestätigung ----
router.get('/verwaltung/einstellungen', (req, res) => {
  res.render('admin/settings', {
    title: 'Einstellungen', s: {
      verein_name: settings.get('verein_name'), aufgebot_email: settings.get('aufgebot_email'), email_domain: settings.get('email_domain'),
      form: settings.get('form'), confirmation: settings.get('confirmation'),
    },
    smtp: mailer.isConfigured(), backups: backup.list(), backupDir: backup.backupDir(),
  });
});

router.post('/verwaltung/einstellungen', (req, res) => {
  const b = req.body;
  const email = String(b.aufgebot_email || '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError(['Aufgebots-E-Mail ist ungültig.']);
  settings.set('verein_name', String(b.verein_name || '').trim() || settings.DEFAULTS.verein_name);
  settings.set('aufgebot_email', email);
  settings.set('email_domain', String(b.email_domain || '').trim());
  settings.set('form', { title: String(b.form_title || '').trim() || 'Einsatzanmeldung', intro: String(b.form_intro || '').trim(), min_seconds: Math.max(0, Number(b.form_min_seconds) || 0) });
  audit.log({ entity: 'settings', action: 'settings', summary: `${req.user.display_name} hat die Einstellungen geändert`, user: req.user });
  flash(res, 'success', 'Einstellungen gespeichert.');
  res.redirect('/verwaltung/einstellungen');
});

router.post('/verwaltung/sicherung', (req, res) => {
  const r = backup.runBackup();
  flash(res, 'success', r.skipped ? 'Die heutige Sicherung besteht bereits.' : 'Sicherung erstellt.');
  res.redirect('/verwaltung/einstellungen');
});

// ---- Kalendertermin-Vorlage ----
function previewEvent(id) {
  const chosen = id ? events.get(Number(id)) : null;
  if (chosen) return chosen;
  const next = db.one("SELECT id FROM events WHERE status IN ('veroeffentlicht','entwurf') AND date >= ? ORDER BY date LIMIT 1", today())
    || db.one('SELECT id FROM events ORDER BY date DESC LIMIT 1');
  return next ? events.get(next.id) : null;
}

router.get('/verwaltung/kalendertermin', (req, res) => {
  const tpl = settings.get('calendar');
  const e = previewEvent(req.query.einsatz);
  const preview = e ? calendar.renderEntry(e, e.shifts.length > 1 ? e.shifts[0] : null, req.user, tpl) : null;
  res.render('admin/calendar', {
    title: 'Kalendertermin', tpl, groups: calendar.blockGroups(), preview, previewEvent: e,
    eventOptions: db.all('SELECT id, name, date FROM events ORDER BY date DESC LIMIT 50'),
  });
});

router.post('/verwaltung/kalendertermin', (req, res) => {
  const b = req.body;
  const tpl = {
    title: String(b.title || ''), location: String(b.location || ''), description: String(b.description || ''),
    omit_empty_lines: b.omit_empty_lines === '1', attendees: b.attendees === '1', reminder_minutes: Number(b.reminder_minutes) || 0,
  };
  if (b.preview === '1') {
    const e = previewEvent(b.einsatz);
    const preview = e ? calendar.renderEntry(e, e.shifts.length > 1 ? e.shifts[0] : null, req.user, tpl) : null;
    return res.render('admin/calendar', {
      title: 'Kalendertermin', tpl, groups: calendar.blockGroups(), preview, previewEvent: e,
      eventOptions: db.all('SELECT id, name, date FROM events ORDER BY date DESC LIMIT 50'), unsaved: true,
    });
  }
  settings.set('calendar', tpl);
  audit.log({ entity: 'settings', action: 'calendar', summary: `${req.user.display_name} hat die Vorlage für den Kalendertermin geändert`, user: req.user });
  flash(res, 'success', 'Vorlage gespeichert.');
  res.redirect(`/verwaltung/kalendertermin${b.einsatz ? `?einsatz=${Number(b.einsatz)}` : ''}`);
});

// ---- Bestätigungsmail ----
function confirmationPage(req, res, conf, extra = {}) {
  const e = previewEvent(req.body?.einsatz || req.query.einsatz);
  let preview = null;
  if (e) {
    // Vorschau mit einer echten bestätigten Anmeldung, sonst mit Beispielnamen
    const reg = db.one(`SELECT g.id, p.first_name, p.last_name, p.email FROM registrations g JOIN persons p ON p.id = g.person_id
      WHERE g.event_id = ? AND g.status = 'bestaetigt' ORDER BY p.last_name LIMIT 1`, e.id);
    const person = reg || { first_name: 'Vorname', last_name: 'Nachname' };
    const assigned = reg
      ? db.all('SELECT s.* FROM shift_assignments a JOIN shifts s ON s.id = a.shift_id WHERE a.registration_id = ? ORDER BY s.sort, s.starts_at', reg.id)
      : e.shifts.slice(0, 1);
    preview = { ...calendar.renderConfirmation(e, assigned, person, req.user, conf), to: reg?.email || null, person };
  }
  const groups = [...calendar.blockGroups()];
  groups.splice(1, 0, { name: 'Person', items: [['person.vorname', 'Vorname'], ['person.nachname', 'Nachname']] });
  res.render('admin/confirmation', {
    title: 'Bestätigungsmail', conf, groups, preview, previewEvent: e, smtp: mailer.isConfigured(),
    testTo: req.body?.test_to || req.user.email || '',
    eventOptions: db.all('SELECT id, name, date FROM events ORDER BY date DESC LIMIT 50'), ...extra,
  });
}

router.get('/verwaltung/bestaetigungsmail', (req, res) => confirmationPage(req, res, settings.get('confirmation')));

router.post('/verwaltung/bestaetigungsmail', async (req, res, next) => {
  try {
    const b = req.body;
    const conf = { enabled: b.enabled === '1', subject: String(b.subject || ''), body: String(b.body || '') };
    if (b.action === 'preview' || b.preview === '1') return confirmationPage(req, res, conf, { unsaved: true });
    if (b.action === 'test') {
      const to = String(b.test_to || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ValidationError(['Bitte eine gültige E-Mail-Adresse für die Testmail angeben.']);
      const e = previewEvent(b.einsatz);
      if (!e) throw new ValidationError(['Für die Testmail braucht es mindestens einen Einsatz.']);
      const { subject, body } = calendar.renderConfirmation(e, e.shifts.slice(0, 1), { first_name: 'Vorname', last_name: 'Nachname' }, req.user, conf);
      const r = await mailer.send({ to, subject: `[Test] ${subject}`, body });
      const msg = r.sent ? `Testmail an ${to} verschickt.`
        : r.error ? `Testmail konnte nicht verschickt werden: ${r.error}`
          : 'Es ist kein Mailserver (SMTP) eingerichtet – die Testmail liegt nur im Postausgang.';
      return confirmationPage(req, res, conf, { unsaved: true, testResult: { ok: !!r.sent, msg } });
    }
    settings.set('confirmation', conf);
    audit.log({ entity: 'settings', action: 'confirmation', summary: `${req.user.display_name} hat die Bestätigungsmail geändert`, user: req.user });
    flash(res, 'success', 'Bestätigungsmail gespeichert.');
    res.redirect(`/verwaltung/bestaetigungsmail${b.einsatz ? `?einsatz=${Number(b.einsatz)}` : ''}`);
  } catch (err) { next(err); }
});

// ---- System: Version, Update, Neustart ----
const updater = require('../services/updater');

router.get('/verwaltung/system', async (req, res, next) => {
  try {
    res.render('admin/system', {
      title: 'System', version: await updater.currentVersion(), st: await updater.status(), check: null,
      node: process.version, platform: process.platform,
    });
  } catch (err) { next(err); }
});

router.post('/verwaltung/system/pruefen', async (req, res, next) => {
  try {
    res.render('admin/system', {
      title: 'System', version: await updater.currentVersion(), st: await updater.status(), check: await updater.check(),
      node: process.version, platform: process.platform,
    });
  } catch (err) { next(err); }
});

router.post('/verwaltung/system/update', (req, res) => {
  if (!updater.canRestart()) throw new ValidationError(['Der Server wurde noch mit dem alten Startskript gestartet. Bitte einmalig auf dem Server update.cmd (bzw. update.sh) ausführen.']);
  updater.update(req.user).catch((err) => console.error('Update fehlgeschlagen:', err));
  res.redirect(303, '/verwaltung/system');
});

router.post('/verwaltung/system/neustart', (req, res) => {
  if (!updater.canRestart()) throw new ValidationError(['Der Server wurde noch mit dem alten Startskript gestartet. Bitte einmalig auf dem Server neustart.cmd (bzw. neustart.sh) ausführen.']);
  updater.restart(req.user);
  res.redirect(303, '/verwaltung/system?neustart=1');
});

router.get('/verwaltung/system/status', async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await updater.status());
});

// Kleine Vorschau-API für Textfelder (Bestätigungsmail)
router.post('/verwaltung/vorschau-text', (req, res) => {
  const e = previewEvent(req.body.einsatz);
  if (!e) return res.json({ text: '' });
  const { values } = calendar.context(e, null, req.user, { 'person.vorname': 'Jonas', 'person.nachname': 'Frei' });
  res.json({ text: render(String(req.body.text || ''), values, { omitEmptyLines: true }) });
});

module.exports = router;
