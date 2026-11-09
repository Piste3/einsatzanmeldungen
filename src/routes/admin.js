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
const { sanitize: sanitizeHtml } = require('../lib/html');
const { flash } = require('../lib/view-helpers');
const { ValidationError } = require('../services/errors');
const { today } = require('../lib/dates');

const router = express.Router();
const twofaOptions = require('../auth/twofa').REMEMBER_OPTIONS;
const msEnabled = () => Boolean(auth.provider('microsoft'));
router.use('/verwaltung', auth.requireAdmin);

// Einstellungen öffnen beim ersten Reiter (Auswahllisten), nicht bei Benutzer
router.get('/verwaltung', (req, res) => res.redirect('/verwaltung/listen'));

function personOptions() {
  return db.all(`SELECT p.id, p.first_name, p.last_name, r.short AS rank_short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.status = 'aktiv' ORDER BY ${BY_RANK}`);
}

// ---- Benutzer ----
router.get('/verwaltung/benutzer', (req, res) => {
  res.render('admin/users', { title: 'Benutzer', list: users.list(), providers: auth.providers().map((p) => p.id), msProviderConfigured: config.authProviders.includes('microsoft') });
});

router.get('/verwaltung/benutzer/neu', (req, res) => {
  res.render('admin/user-form', { title: 'Neues Benutzerkonto', u: { role: 'aufgebotsstelle', active: 1 }, isNew: true, errors: [], persons: personOptions(), twofaOptions, msEnabled: msEnabled() });
});

router.post('/verwaltung/benutzer', async (req, res, next) => {
  try {
    const { id, password } = await users.create({ ...req.body, password: req.body.password || null }, req.user);
    res.render('admin/user-created', { title: 'Benutzerkonto angelegt', u: users.get(id), password: req.body.password ? null : password });
  } catch (err) {
    if (err instanceof ValidationError) return res.status(400).render('admin/user-form', { title: 'Neues Benutzerkonto', u: req.body, isNew: true, errors: err.messages, persons: personOptions(), twofaOptions, msEnabled: msEnabled() });
    next(err);
  }
});

router.get('/verwaltung/benutzer/:id', (req, res) => {
  const u = users.get(Number(req.params.id));
  if (!u) return res.redirect('/verwaltung/benutzer');
  res.render('admin/user-form', { title: u.display_name, u, isNew: false, errors: [], persons: personOptions(), twofaOptions, msEnabled: msEnabled() });
});

router.post('/verwaltung/benutzer/:id', (req, res) => {
  const id = Number(req.params.id);
  try {
    users.update(id, req.body, req.user);
    flash(res, 'success', 'Benutzerkonto gespeichert.');
    res.redirect('/verwaltung/benutzer');
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    res.status(400).render('admin/user-form', { title: 'Benutzerkonto', u: { ...users.get(id), ...req.body }, isNew: false, errors: err.messages, persons: personOptions(), twofaOptions, msEnabled: msEnabled() });
  }
});

router.post('/verwaltung/benutzer/:id/passwort', async (req, res) => {
  const u = users.get(Number(req.params.id));
  if (!u) return res.status(404).render('pages/error', { title: 'Nicht gefunden', message: 'Benutzerkonto nicht gefunden.' });
  let password;
  try {
    password = await users.resetPassword(u.id, req.user);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    flash(res, 'error', err.messages.join(' '));
    return res.redirect(`/verwaltung/benutzer/${u.id}`);
  }
  res.render('admin/user-created', { title: 'Passwort zurückgesetzt', u, password, reset: true });
});

router.post('/verwaltung/benutzer/:id/2fa-zuruecksetzen', (req, res) => {
  users.resetTwofa(Number(req.params.id), req.user);
  flash(res, 'success', 'Zwei-Faktor-Anmeldung zurückgesetzt. Das Konto wurde abgemeldet.');
  res.redirect(`/verwaltung/benutzer/${Number(req.params.id)}`);
});

router.post('/verwaltung/benutzer/:id/loeschen', (req, res) => {
  const u = users.get(Number(req.params.id));
  users.remove(Number(req.params.id), req.user);
  flash(res, 'success', `Benutzerkonto «${u.username}» gelöscht.`);
  res.redirect('/verwaltung/benutzer');
});

router.post('/verwaltung/benutzer/:id/entsperren', (req, res) => {
  users.unlock(Number(req.params.id), req.user);
  flash(res, 'success', 'Konto entsperrt.');
  res.redirect('/verwaltung/benutzer');
});

// ---- Auswahllisten: Ränge, Mannschaften, externe Abteilungen ----
router.get('/verwaltung/listen', (req, res) => {
  res.render('admin/lists', {
    title: 'Auswahllisten',
    ranks: db.all('SELECT r.*, (SELECT COUNT(*) FROM persons p WHERE p.rank_id = r.id) AS used FROM ranks r ORDER BY sort, name'),
    teams: db.all('SELECT t.*, (SELECT COUNT(*) FROM person_teams pt WHERE pt.team_id = t.id) AS used FROM teams t ORDER BY sort, name'),
    externalUnits: db.all('SELECT u.*, (SELECT COUNT(DISTINCT x.event_id) FROM event_externals x WHERE x.unit_id = u.id) AS used FROM external_units u ORDER BY sort, name COLLATE NOCASE'),
    functionList: db.all(`SELECT f.*, (SELECT COUNT(DISTINCT e.id) FROM events e WHERE EXISTS (SELECT 1 FROM shifts s WHERE s.event_id = e.id AND json_extract(s.function_targets, '$."' || f.id || '"') IS NOT NULL)
        OR EXISTS (SELECT 1 FROM registrations g WHERE g.event_id = e.id AND g.function_id = f.id)
        OR EXISTS (SELECT 1 FROM event_externals x WHERE x.event_id = e.id AND x.function_id = f.id)) AS used
      FROM functions f ORDER BY sort, name COLLATE NOCASE`),
  });
});

// Ein Abschnitt wird als Ganzes gespeichert: Felder heissen «feld__<id>» bzw. «feld__neu»,
// «row__<id>» markiert jede Zeile (für nicht angekreuzte Checkboxen), «delete__<id>» löscht.
function sectionRows(body) {
  const rows = new Map();
  for (const [key, value] of Object.entries(body)) {
    const m = /^([a-z_]+)__(\d+|neu)$/.exec(key);
    if (!m) continue;
    if (!rows.has(m[2])) rows.set(m[2], { id: m[2] === 'neu' ? 0 : Number(m[2]) });
    rows.get(m[2])[m[1]] = Array.isArray(value) ? value[value.length - 1] : value;
  }
  const list = [...rows.values()];
  return {
    existing: list.filter((r) => r.id && r.row !== undefined),
    added: list.filter((r) => !r.id && String(r.name || '').trim()),
  };
}

router.post('/verwaltung/listen/:kind', (req, res) => {
  const kind = req.params.kind;
  const table = { raenge: 'ranks', mannschaften: 'teams', externe: 'external_units', funktionen: 'functions' }[kind];
  const usedSql = {
    ranks: 'SELECT COUNT(*) AS n FROM persons WHERE rank_id = ?', teams: 'SELECT COUNT(*) AS n FROM person_teams WHERE team_id = ?', external_units: 'SELECT COUNT(*) AS n FROM event_externals WHERE unit_id = ?',
    functions: `SELECT (SELECT COUNT(*) FROM registrations WHERE function_id = ?1) + (SELECT COUNT(*) FROM event_externals WHERE function_id = ?1)
      + (SELECT COUNT(*) FROM shifts WHERE json_extract(function_targets, '$."' || ?1 || '"') IS NOT NULL) + (SELECT COUNT(*) FROM functions WHERE id = ?1 AND is_default = 1) AS n`,
  }[table];
  const hasShort = table === 'ranks' || table === 'functions';
  if (!table) return res.redirect('/verwaltung/listen');
  const { existing, added } = sectionRows(req.body);
  const problems = [];
  let changes = 0;
  db.tx(() => {
    for (const r of existing) {
      const name = String(r.name || '').trim();
      if (r.delete === '1') {
        const used = db.one(usedSql, r.id).n;
        if (used) { problems.push(`«${name}» wird noch verwendet – stattdessen deaktivieren.`); continue; }
        db.run(`DELETE FROM ${table} WHERE id = ?`, r.id);
        changes++;
        continue;
      }
      if (!name) { problems.push('Ein Name fehlt.'); continue; }
      const sort = Number(r.sort || 0);
      const active = r.active === '1' ? 1 : 0;
      const res2 = hasShort
        ? db.run(`UPDATE ${table} SET name = ?, short = ?, sort = ?, active = ? WHERE id = ? AND (name IS NOT ? OR short IS NOT ? OR sort IS NOT ? OR active IS NOT ?)`, name, String(r.short || '').trim() || name, sort, active, r.id, name, String(r.short || '').trim() || name, sort, active)
        : db.run(`UPDATE ${table} SET name = ?, sort = ?, active = ? WHERE id = ? AND (name IS NOT ? OR sort IS NOT ? OR active IS NOT ?)`, name, sort, active, r.id, name, sort, active);
      changes += Number(res2.changes);
    }
    for (const r of added) {
      const name = String(r.name).trim();
      const sort = Number(r.sort || 0) || (db.one(`SELECT max(sort) AS m FROM ${table}`).m || 0) + 1;
      if (hasShort) db.run(`INSERT INTO ${table} (name, short, sort) VALUES (?, ?, ?)`, name, String(r.short || '').trim() || name, sort);
      else db.run(`INSERT INTO ${table} (name, sort) VALUES (?, ?)`, name, sort);
      changes++;
    }
    // Funktionen: genau eine ist Standard (wer keine Funktion hat, zählt als diese) – sie bleibt immer aktiv
    if (table === 'functions') {
      const def = Number(req.body.default_function);
      if (def && db.one('SELECT 1 FROM functions WHERE id = ?', def) && !db.one('SELECT 1 FROM functions WHERE id = ? AND is_default = 1', def)) {
        db.run('UPDATE functions SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END', def);
        changes++;
      }
      db.run('UPDATE functions SET active = 1 WHERE is_default = 1');
    }
  });
  if (changes) audit.log({ entity: 'settings', action: 'lists', summary: `${req.user.display_name} hat die Auswahlliste «${{ raenge: 'Ränge', mannschaften: 'Mannschaften', externe: 'Externe Abteilungen', funktionen: 'Funktionen' }[kind]}» geändert`, user: req.user });
  if (problems.length) flash(res, 'error', `${changes ? 'Gespeichert, aber: ' : ''}${problems.join(' ')}`);
  else flash(res, 'success', changes ? 'Gespeichert.' : 'Keine Änderungen.');
  res.redirect('/verwaltung/listen');
});

// ---- Vorlagen: Anmeldefragen, Tenue, Zusatzfelder ----
router.get('/verwaltung/vorlagen', (req, res) => {
  res.render('admin/templates', {
    title: 'Vorlagen',
    questions: db.all('SELECT * FROM question_templates ORDER BY sort, name'),
    defaultQuestion: Number(settings.get('default_question_template')) || null,
    tenues: db.all('SELECT * FROM tenue_templates ORDER BY sort, name'),
    extras: events.extraDefs(),
  });
});

router.post('/verwaltung/vorlagen/:kind', (req, res) => {
  const kind = req.params.kind;
  if (!['fragen', 'tenue', 'zusatzfelder'].includes(kind)) return res.redirect('/verwaltung/vorlagen');
  const { existing, added } = sectionRows(req.body);
  const problems = [];
  let changes = 0;
  const TYPES = ['text', 'textarea', 'number', 'date', 'checkbox'];
  db.tx(() => {
    const table = { fragen: 'question_templates', tenue: 'tenue_templates', zusatzfelder: 'extra_fields' }[kind];
    for (const r of [...existing, ...added]) {
      const name = String(r.name || '').trim();
      // neue Einträge ohne Reihenfolge kommen ans Ende
      const sort = Number(r.sort || 0) || (r.id ? 0 : (db.one(`SELECT max(sort) AS m FROM ${table}`).m || 0) + 1);
      if (r.id && r.delete === '1') {
        if (kind === 'fragen') { db.run('UPDATE events SET question_template_id = NULL WHERE question_template_id = ?', r.id); db.run('DELETE FROM question_templates WHERE id = ?', r.id); }
        if (kind === 'tenue') db.run('DELETE FROM tenue_templates WHERE id = ?', r.id);
        if (kind === 'zusatzfelder') db.run('DELETE FROM extra_fields WHERE id = ?', r.id);
        changes++;
        continue;
      }
      if (!name) { problems.push('Ein Name fehlt.'); continue; }
      if (kind === 'fragen') {
        const q = String(r.question_text || '').trim() || name;
        const help = String(r.help_text || '').trim() || null;
        changes += Number((r.id
          ? db.run('UPDATE question_templates SET name = ?, question_text = ?, help_text = ?, sort = ? WHERE id = ? AND (name IS NOT ? OR question_text IS NOT ? OR help_text IS NOT ? OR sort IS NOT ?)', name, q, help, sort, r.id, name, q, help, sort)
          : db.run('INSERT INTO question_templates (name, question_text, help_text, sort) VALUES (?, ?, ?, ?)', name, q, help, sort)).changes);
      } else if (kind === 'tenue') {
        const text = String(r.text || '');
        changes += Number((r.id
          ? db.run('UPDATE tenue_templates SET name = ?, text = ?, sort = ? WHERE id = ? AND (name IS NOT ? OR text IS NOT ? OR sort IS NOT ?)', name, text, sort, r.id, name, text, sort)
          : db.run('INSERT INTO tenue_templates (name, text, sort) VALUES (?, ?, ?)', name, text, sort)).changes);
      } else {
        if (/[{}]/.test(name)) { problems.push('Ein Feldname darf keine geschweiften Klammern enthalten.'); continue; }
        const type = TYPES.includes(r.field_type) ? r.field_type : 'text';
        const required = r.required === '1' ? 1 : 0;
        const dup = db.one('SELECT id FROM extra_fields WHERE name = ? AND id <> ?', name, r.id || 0);
        if (dup) { problems.push(`Das Zusatzfeld «${name}» gibt es schon.`); continue; }
        changes += Number((r.id
          ? db.run('UPDATE extra_fields SET name = ?, field_type = ?, required = ?, sort = ? WHERE id = ? AND (name IS NOT ? OR field_type IS NOT ? OR required IS NOT ? OR sort IS NOT ?)', name, type, required, sort, r.id, name, type, required, sort)
          : db.run('INSERT INTO extra_fields (name, field_type, required, sort) VALUES (?, ?, ?, ?)', name, type, required, sort)).changes);
      }
    }
    // Standard-Anmeldefrage für neue Einsätze («neu» = die gerade hinzugefügte Vorlage)
    if (kind === 'fragen' && 'default_question' in req.body) {
      let def = req.body.default_question === 'neu' ? added.find((r) => String(r.name || '').trim()) && db.one('SELECT max(id) AS id FROM question_templates').id || null : Number(req.body.default_question) || null;
      if (def && !db.one('SELECT 1 FROM question_templates WHERE id = ?', def)) def = null;
      if (def !== (Number(settings.get('default_question_template')) || null)) { settings.set('default_question_template', def); changes++; }
    }
  });
  if (changes) audit.log({ entity: 'settings', action: 'templates', summary: `${req.user.display_name} hat Vorlagen geändert`, user: req.user });
  if (problems.length) flash(res, 'error', `${changes ? 'Gespeichert, aber: ' : ''}${problems.join(' ')}`);
  else flash(res, 'success', changes ? 'Gespeichert.' : 'Keine Änderungen.');
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

// ---- Server-Einstellungen (Werte aus der .env) ----
const serverSettings = require('../services/server-settings');
const isHttps = (req) => req.secure || String(req.get('x-forwarded-proto') || '').split(',')[0].trim() === 'https';

router.get('/verwaltung/server', (req, res) => {
  res.render('admin/server', { title: 'Server', ...serverSettings.rows(), smtp: mailer.isConfigured(), testTo: req.user.email || '' });
});

router.post('/verwaltung/server', (req, res) => {
  const changed = serverSettings.save(req.body, { user: req.user, secure: isHttps(req) });
  flash(res, 'success', changed.length ? `Gespeichert, gilt ab sofort: ${changed.join(', ')}.` : 'Keine Änderungen.');
  res.redirect('/verwaltung/server');
});

router.post('/verwaltung/server/testmail', async (req, res, next) => {
  try {
    const to = String(req.body.test_to || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ValidationError(['Bitte eine gültige E-Mail-Adresse für die Testmail angeben.']);
    const r = await mailer.send({ to, subject: '[Test] Mailserver KKB-Einsatzplaner', body: `Diese Testmail hat ${req.user.display_name} unter Einstellungen › Server verschickt. Der Mailversand funktioniert.` });
    if (r.sent) flash(res, 'success', `Testmail an ${to} verschickt.`);
    else flash(res, 'error', r.error ? `Testmail konnte nicht verschickt werden: ${r.error}` : 'Es ist kein Mailserver (SMTP) eingetragen – die Testmail liegt nur im Postausgang.');
    res.redirect('/verwaltung/server');
  } catch (err) { next(err); }
});

// ---- Kalendertermin-Vorlage ----
function previewEvent(id) {
  const chosen = id ? events.get(Number(id)) : null;
  if (chosen) return chosen;
  const next = db.one("SELECT id FROM events WHERE status IN ('veroeffentlicht','entwurf') AND date_to >= ? ORDER BY date_from LIMIT 1", today())
    || db.one('SELECT id FROM events ORDER BY date_from DESC LIMIT 1');
  return next ? events.get(next.id) : null;
}

router.get('/verwaltung/kalendertermin', (req, res) => {
  const tpl = settings.get('calendar');
  const e = previewEvent(req.query.einsatz);
  const preview = e ? calendar.renderEntry(e, e.shifts.length > 1 ? e.shifts[0] : null, req.user, tpl) : null;
  res.render('admin/calendar', {
    title: 'Kalendertermin', tpl, groups: calendar.blockGroups(), preview, previewEvent: e,
    eventOptions: db.all('SELECT id, name, date, date_from, date_to FROM events ORDER BY date_from DESC LIMIT 50'),
  });
});

router.post('/verwaltung/kalendertermin', (req, res) => {
  const b = req.body;
  const format = b.description_format === 'html' ? 'html' : 'text';
  const tpl = {
    title: String(b.title || ''), location: String(b.location || ''),
    description: format === 'html' ? sanitizeHtml(String(b.description || '')) : String(b.description || ''), format,
    html_mode: b.html_mode === 'description' ? 'description' : 'alt',
    omit_empty_lines: b.omit_empty_lines === '1', attendees: b.attendees === '1', reminder_minutes: Number(b.reminder_minutes) || 0,
  };
  if (b.preview === '1') {
    const e = previewEvent(b.einsatz);
    const preview = e ? calendar.renderEntry(e, e.shifts.length > 1 ? e.shifts[0] : null, req.user, tpl) : null;
    return res.render('admin/calendar', {
      title: 'Kalendertermin', tpl, groups: calendar.blockGroups(), preview, previewEvent: e,
      eventOptions: db.all('SELECT id, name, date, date_from, date_to FROM events ORDER BY date_from DESC LIMIT 50'), unsaved: true,
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
    eventOptions: db.all('SELECT id, name, date, date_from, date_to FROM events ORDER BY date_from DESC LIMIT 50'), ...extra,
  });
}

router.get('/verwaltung/bestaetigungsmail', (req, res) => confirmationPage(req, res, settings.get('confirmation')));

router.post('/verwaltung/bestaetigungsmail', async (req, res, next) => {
  try {
    const b = req.body;
    const format = b.body_format === 'html' ? 'html' : 'text';
    const conf = {
      enabled: b.enabled === '1', subject: String(b.subject || ''),
      body: format === 'html' ? sanitizeHtml(String(b.body || '')) : String(b.body || ''), format,
    };
    if (b.action === 'preview' || b.preview === '1') return confirmationPage(req, res, conf, { unsaved: true });
    if (b.action === 'test') {
      const to = String(b.test_to || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new ValidationError(['Bitte eine gültige E-Mail-Adresse für die Testmail angeben.']);
      const e = previewEvent(b.einsatz);
      if (!e) throw new ValidationError(['Für die Testmail braucht es mindestens einen Einsatz.']);
      const { subject, body, html } = calendar.renderConfirmation(e, e.shifts.slice(0, 1), { first_name: 'Vorname', last_name: 'Nachname' }, req.user, conf);
      const r = await mailer.send({ to, subject: `[Test] ${subject}`, body, html });
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
const { BY_RANK } = require('../lib/sorting');

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
