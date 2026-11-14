'use strict';
const express = require('express');
const db = require('../db');
const settings = require('../services/settings');
const events = require('../services/events');
const shiftTeams = require('../services/shift-teams');
const registrations = require('../services/registrations');
const inquiries = require('../services/inquiries');
const calendar = require('../services/calendar');
const audit = require('../services/audit');
const persons = require('../services/persons');
const leaders = require('../services/leaders');
const externals = require('../services/externals');
const functions = require('../services/functions');
const { sendTable, wantsExport, contentDisposition } = require('../lib/export');
const { flash } = require('../lib/view-helpers');
const h = require('../lib/view-helpers');
const { REG_STATUS, SOURCE, INQUIRY_STATUS, INQUIRY_ROW, MATCH_TYPE, DIET, REG_COUNTING } = require('../lib/labels');
const { ValidationError, ConflictError } = require('../services/errors');
const { BY_RANK } = require('../lib/sorting');
const lists = require('../services/lists');
const { today } = require('../lib/dates');

const router = express.Router();

function formOptions() {
  return {
    leaders: db.all(`SELECT p.id, p.first_name, p.last_name, r.short AS rank_short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
      WHERE p.status = 'aktiv' ORDER BY coalesce(r.sort, 0) DESC, p.last_name`),
    questionTemplates: db.all('SELECT * FROM question_templates ORDER BY sort, name'),
    tenueTemplates: db.all('SELECT * FROM tenue_templates ORDER BY sort, name'),
    extraDefs: events.extraDefs(),
    functionList: functions.all(),
  };
}

function loadEvent(req, res, next) {
  const e = events.get(Number(req.params.id));
  if (!e) return res.status(404).render('pages/error', { title: 'Nicht gefunden', message: 'Dieser Einsatz existiert nicht.' });
  req.event = e;
  res.locals.event = e;
  res.locals.liveTopics = [`event:${e.id}`, 'events'];
  res.locals.tabCounts = {
    registrations: db.one("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND status <> 'ungueltig'", e.id).n,
    // gleiche Zahl wie die Gruppe «Noch offen» im Reiter Anfragen
    inquiries: inquiries.openCount(e.id),
  };
  next();
}

// Liste mit Filter nach Status und Zeitraum
router.get('/einsaetze', (req, res) => {
  const filters = { status: req.query.status ?? 'aktiv', from: req.query.from || '', to: req.query.to || '', q: req.query.q || '' };
  const list = events.list(filters).map((e) => ({ ...e, stats: events.stats(e), inForm: events.isInForm(e) }));
  const format = wantsExport(req);
  if (format) {
    return sendTable(res, format, 'Einsätze', [
      { label: 'Einsatz', value: (e) => e.name },
      { label: 'Datum', value: (e) => h.fmtEventDate(e) },
      { label: 'Antreten', value: (e) => [e.start_time, e.start_place].filter(Boolean).join(' · ') },
      { label: 'Abtreten', value: (e) => e.end_time || '' },
      { label: 'Status', value: (e) => h.labels.EVENT_STATUS[e.status].label },
      { label: 'Im Formular', value: (e) => (e.inForm ? 'ja' : 'nein') },
      { label: 'Einsatzleitung', value: (e) => (e.leader_last ? `${e.leader_rank || ''} ${e.leader_first} ${e.leader_last}`.trim() : '') },
      { label: 'Schichten', value: (e) => e.stats.shifts.map((s) => `${s.name} ${s.ist}/${s.soll ?? '–'}`).join(', ') },
      { label: 'Funktionen', value: (e) => functions.line(functions.summary(e)) },
      { label: 'Neu', value: (e) => e.stats.neu },
      { label: 'Bestätigt', value: (e) => e.stats.bestaetigt },
    ], list);
  }
  res.render('pages/events', { title: 'Einsätze', list, filters, liveTopics: ['events'] });
});

router.get('/einsaetze/neu', (req, res) => {
  // Standard-Anmeldefrage aus Einstellungen › Vorlagen vorauswählen
  const def = db.one('SELECT * FROM question_templates WHERE id = ?', Number(settings.get('default_question_template')) || 0);
  const question = def ? { question_template_id: def.id, question_text: def.question_text, help_text: def.help_text } : {};
  res.render('pages/event-form', { title: 'Neuer Einsatz', e: { status: 'entwurf', shifts: [], extra: {}, date: req.query.date || '', ...question }, isNew: true, errors: [], ...formOptions() });
});

router.post('/einsaetze', (req, res, next) => {
  try {
    const id = events.create(req.body, req.user);
    // Ohne Datum: erst die Schichten mit ihren Tagen erfassen, dann veröffentlichen
    if (!req.body.date) {
      flash(res, 'success', 'Einsatz als Entwurf gespeichert. Er hat noch kein Datum: Erfasse jetzt die Schichten mit ihrem Tag und veröffentliche ihn danach.');
      return res.redirect(`/einsaetze/${id}/schichten`);
    }
    if (req.body.action === 'publish') events.setStatus(id, 'veroeffentlicht', req.user);
    flash(res, 'success', req.body.action === 'publish' ? 'Einsatz angelegt und veröffentlicht. Er erscheint jetzt im Anmeldeformular.' : 'Einsatz als Entwurf gespeichert.');
    res.redirect(`/einsaetze/${id}`);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).render('pages/event-form', { title: 'Neuer Einsatz', e: { ...req.body, status: 'entwurf', shifts: [], extra: extraFromBody(req.body) }, isNew: true, errors: err.messages, ...formOptions() });
    }
    next(err);
  }
});

function extraFromBody(body) {
  const out = {};
  for (const d of events.extraDefs()) out[d.name] = body[`extra_${d.id}`] || '';
  return out;
}

router.get('/einsaetze/:id/bearbeiten', loadEvent, (req, res) => {
  res.render('pages/event-form', { title: `${req.event.name} bearbeiten`, e: req.event, isNew: false, errors: [], editKey: `event:${req.event.id}`, ...formOptions() });
});

router.post('/einsaetze/:id/bearbeiten', loadEvent, (req, res, next) => {
  try {
    events.update(req.event.id, req.body, req.body.version, req.user, { reason: req.body.reason });
    if (req.body.action === 'publish' && req.event.status === 'entwurf') {
      try {
        events.setStatus(req.event.id, 'veroeffentlicht', req.user);
      } catch (err) {
        if (!(err instanceof ValidationError)) throw err;
        flash(res, 'error', `Gespeichert, aber noch nicht veröffentlicht: ${err.messages.join(' ')}`);
        return res.redirect(`/einsaetze/${req.event.id}/schichten`);
      }
    }
    flash(res, 'success', 'Einsatz gespeichert.');
    res.redirect(`/einsaetze/${req.event.id}`);
  } catch (err) {
    if (err instanceof ValidationError) {
      return res.status(400).render('pages/event-form', { title: `${req.event.name} bearbeiten`, e: { ...req.event, ...req.body, extra: extraFromBody(req.body) }, isNew: false, errors: err.messages, ...formOptions() });
    }
    if (err instanceof ConflictError) return renderEventConflict(req, res, err);
    next(err);
  }
});

// Konflikt: beide Stände zeigen und entscheiden lassen
function renderEventConflict(req, res, err) {
  const current = err.current;
  const mine = { ...req.body };
  const rows = Object.entries(events.FIELD_LABELS)
    .filter(([k]) => !['status', 'show_in_form', 'extra', 'function_targets'].includes(k))
    .map(([k, label]) => ({ key: k, label, theirs: current[k] ?? '', mine: mine[k] ?? '' }))
    .filter((r) => String(r.theirs) !== String(r.mine));
  res.status(409).render('pages/conflict', {
    title: 'Gleichzeitige Änderung', who: err.lastChange?.user_name || 'jemand anderem', when: err.lastChange?.created_at, summary: err.lastChange?.summary,
    rows, action: `/einsaetze/${current.id}/bearbeiten`, version: current.version, mine, backUrl: `/einsaetze/${current.id}`,
    editUrl: `/einsaetze/${current.id}/bearbeiten`,
  });
}

router.post('/einsaetze/:id/status', loadEvent, (req, res) => {
  events.setStatus(req.event.id, req.body.status, req.user, { reason: req.body.reason });
  const msgs = { veroeffentlicht: 'Veröffentlicht – der Einsatz erscheint jetzt im Anmeldeformular.', abgeschlossen: 'Einsatz abgeschlossen. Die Daten sind jetzt schreibgeschützt.', abgesagt: 'Einsatz abgesagt. Alle Daten bleiben erhalten.', entwurf: 'Einsatz ist wieder ein Entwurf.' };
  flash(res, 'success', msgs[req.body.status] || 'Status geändert.');
  res.redirect(`/einsaetze/${req.event.id}`);
});

router.post('/einsaetze/:id/formular', loadEvent, (req, res) => {
  events.setShowInForm(req.event.id, req.body.show_in_form === '1', req.user);
  flash(res, 'success', req.body.show_in_form === '1' ? 'Der Einsatz steht wieder im Formular.' : 'Der Einsatz wurde aus dem Formular genommen.');
  res.redirect(h.withQuery(`/einsaetze/${req.event.id}`, {}));
});

// Übersicht
router.get('/einsaetze/:id', loadEvent, (req, res) => {
  const e = req.event;
  res.render('pages/event', {
    title: e.name, tab: 'uebersicht', stats: events.stats(e), checklist: events.checklist(e), inForm: events.isInForm(e),
    lastEnd: events.lastEnd(e), extraDefs: events.extraDefs(),
    leaderAccess: leaders.forEvent(e.id), leaderCandidates: leaders.candidates(e.id),
    externals: externals.forEvent(e.id, e.shifts), unitOptions: externals.units({ activeOnly: true }),
    ...functionPanel(e),
  });
});

// Karte «Funktionen» in der Übersicht: Ist/Soll, wer welche Funktion hat, Vorschläge für den Einsatzleiter-Zugriff
function functionPanel(e) {
  const fnSummary = functions.summary(e);
  // Zum Zuweisen angeboten: zugeordnete Anmeldungen, die zur Besetzung zählen (Neu, Rückfrage, Bestätigt)
  const assignable = registrations.listForEvent(e.id).filter((r) => r.person_id && REG_COUNTING.includes(r.status));
  // Personen mit einer Funktion (ausser Einsatzteilnehmer), die ein Einsatzleiter-Konto ohne Freigabe für diesen Einsatz haben
  const withFn = new Map(assignable.filter((r) => !r.func.is_default).map((r) => [r.person_id, r]));
  const leaderSuggestions = leaders.candidates(e.id).filter((u) => u.person_id && withFn.has(u.person_id))
    .map((u) => ({ ...u, func: withFn.get(u.person_id).func }));
  return { fnSummary, assignable, leaderSuggestions, functionOptions: functions.all({ activeOnly: true }) };
}

// Einsatzleiter für diesen Einsatz freigeben / Freigabe entfernen (Aufgebotsstelle und Admin)
router.post('/einsaetze/:id/einsatzleiter', loadEvent, (req, res) => {
  const added = leaders.grant(req.event.id, req.body.user_id, req.user);
  flash(res, 'success', added ? 'Freigegeben. Der Einsatzleiter sieht den Einsatz jetzt unter «Meine Einsätze».' : 'War bereits freigegeben.');
  res.redirect(`/einsaetze/${req.event.id}`);
});

router.post('/einsaetze/:id/einsatzleiter/:uid/entfernen', loadEvent, (req, res) => {
  leaders.revoke(req.event.id, Number(req.params.uid), req.user);
  flash(res, 'success', 'Freigabe entfernt.');
  res.redirect(`/einsaetze/${req.event.id}`);
});

// Externe Abteilungen am Einsatz: hinzufügen, ändern, entfernen
const backToEvent = (req) => (/^\/einsaetze\/\d+(\/schichten)?$/.test(String(req.body.back || '')) ? req.body.back : `/einsaetze/${req.event.id}#externe`);
router.post('/einsaetze/:id/externe', loadEvent, (req, res) => {
  events.assertEditable(req.event, req.user, req.body.reason);
  externals.add(req.event, req.body, req.user);
  flash(res, 'success', 'Externe Abteilung hinzugefügt. Die Personen zählen jetzt in der Besetzung mit.');
  res.redirect(backToEvent(req));
});

router.post('/einsaetze/:id/externe/:xid', loadEvent, (req, res) => {
  events.assertEditable(req.event, req.user, req.body.reason);
  externals.update(req.event, Number(req.params.xid), req.body, req.user);
  flash(res, 'success', 'Externe Abteilung gespeichert.');
  res.redirect(backToEvent(req));
});

router.post('/einsaetze/:id/externe/:xid/loeschen', loadEvent, (req, res) => {
  events.assertEditable(req.event, req.user, req.body.reason);
  externals.remove(req.event, Number(req.params.xid), req.user);
  flash(res, 'success', 'Externe Abteilung entfernt.');
  res.redirect(backToEvent(req));
});

// Reiter «Anmeldungen»
router.get('/einsaetze/:id/anmeldungen', loadEvent, (req, res) => {
  const e = req.event;
  const filters = { status: req.query.status || '', q: req.query.q || '', sort: ['neu', 'rang_ab', 'funktion'].includes(req.query.sort) ? req.query.sort : 'rang' };
  const list = registrations.listForEvent(e.id, filters);
  const canSeeDiet = (r) => r.person_id && persons.canSeeDiet(req.user, r.person_id);
  const dietOf = (r) => {
    if (!r.person_id) return '';
    const p = db.one('SELECT diet_category, diet_text FROM persons WHERE id = ?', r.person_id);
    if (!p?.diet_category && !p?.diet_text) return '';
    return canSeeDiet(r) ? [DIET[p.diet_category], p.diet_text].filter(Boolean).join(': ') : 'Hinweis vorhanden';
  };
  const format = wantsExport(req);
  if (format) {
    return sendTable(res, format, `Anmeldungen ${e.name}`, [
      { label: 'Rang', value: (r) => r.rank_short || '' },
      { label: 'Vorname', value: (r) => r.first_name || r.entered_first_name },
      { label: 'Nachname', value: (r) => r.last_name || r.entered_last_name },
      { label: 'Eingegebener Name', value: (r) => r.entered_name },
      { label: 'Mannschaft', value: (r) => r.teams || '' },
      { label: 'Zuordnung', value: (r) => (r.person_id ? MATCH_TYPE[r.match_type] || '' : r.match_info || 'unsicher') },
      { label: 'Quelle', value: (r) => SOURCE[r.source] },
      { label: 'Angemeldet', value: (r) => h.fmtDateTime(r.registered_at) },
      { label: 'Schichtwunsch', value: (r) => e.shifts.filter((s) => r.wishes.includes(s.id)).map((s) => s.name).join(', ') },
      { label: 'Zugeteilt', value: (r) => r.assigned.map((a) => a.name).join(', ') },
      { label: 'Funktion', value: (r) => (r.person_id && !functions.INACTIVE_REG.includes(r.status) ? r.func.short : '') },
      { label: 'Bemerkung', value: (r) => r.remark || '' },
      { label: 'Interne Bemerkung', value: (r) => r.internal_note || '' },
      { label: 'Status', value: (r) => REG_STATUS[r.status].label },
      { label: 'Mobil', value: (r) => r.mobile || '' },
      { label: 'Verpflegung', value: dietOf },
    ], list);
  }
  const all = registrations.listForEvent(e.id);
  const counts = {};
  for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
  const available = db.all(`SELECT p.id, p.first_name, p.last_name, r.short AS rank_short FROM persons p LEFT JOIN ranks r ON r.id = p.rank_id
    WHERE p.status = 'aktiv' AND NOT EXISTS (SELECT 1 FROM registrations g WHERE g.event_id = ? AND g.person_id = p.id) ORDER BY ${BY_RANK}`, e.id);
  res.render('pages/event', {
    title: `${e.name} · Anmeldungen`, tab: 'anmeldungen', list, counts, total: all.length, filters, available, dietOf,
    diets: Object.fromEntries(list.map((r) => [r.id, dietOf(r)])), // für die Browser-App (Funktionen gehen nicht über JSON)
    functionOptions: functions.all({ activeOnly: true }), fnSummary: functions.summary(e),
  });
});

// Teilnehmerliste: wer kommt, mit Mobil und Essenseinschränkungen – zum Drucken (PDF), als Excel oder CSV.
// Für den ganzen Einsatz, pro Schicht (schicht=alle) oder für eine Schicht (schicht=<id>).
const FORMAT_LABEL = { pdf: 'PDF', csv: 'CSV', xlsx: 'Excel' };
const unresolvedCount = (eventId) => db.one("SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND person_id IS NULL AND status = 'unsicher'", eventId).n;
const variantText = (v) => (v.shift ? ` (${v.shift.name})` : v.perShift ? ' (pro Schicht)' : '');

function sendPdf(res, baseName, pdf) {
  const file = `${lists.fileName(baseName)}_${today()}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', contentDisposition(file).replace(/^attachment/, 'inline'));
  return res.send(pdf);
}

router.get('/einsaetze/:id/teilnehmerliste', loadEvent, (req, res) => {
  const e = req.event;
  const v = registrations.participantView(e, req.query, req.user);
  const format = req.query.format === 'pdf' ? 'pdf' : wantsExport(req);
  if (format) {
    audit.log({
      entity: 'event', entityId: e.id, eventId: e.id, action: 'export',
      summary: `${req.user.display_name} hat die Teilnehmerliste${variantText(v)} für «${e.name}» exportiert (${FORMAT_LABEL[format]}, ${v.list.length} Personen${v.extTotal ? ` + ${v.extTotal} extern` : ''})`,
      user: req.user,
    });
    const baseName = lists.participantName(e, v);
    if (format === 'pdf') return sendPdf(res, baseName, lists.participantPdf(e, v));
    const { cols, rows } = lists.participantTable(e, v);
    return sendTable(res, format, baseName, cols, rows);
  }
  res.render('pages/participants', {
    title: `${e.name} · Teilnehmerliste`, ...v,
    summary: registrations.dietSummary(v.list, v.exts), scopes: registrations.PARTICIPANT_SCOPES, unresolved: unresolvedCount(e.id),
  });
});

// Verpflegungsliste: Anzahl Essen und Essenseinschränkungen (eigene Personen + externe Abteilungen) – Seite, PDF, Excel, CSV
router.get('/einsaetze/:id/verpflegungsliste', loadEvent, (req, res) => {
  const e = req.event;
  const v = registrations.mealView(e, req.query, req.user);
  const format = req.query.format === 'pdf' ? 'pdf' : wantsExport(req);
  if (format) {
    audit.log({
      entity: 'event', entityId: e.id, eventId: e.id, action: 'export',
      summary: `${req.user.display_name} hat die Verpflegungsliste${variantText(v)} für «${e.name}» exportiert (${FORMAT_LABEL[format]}, ${v.all.total} Essen)`,
      user: req.user,
    });
    const baseName = lists.mealName(e, v);
    if (format === 'pdf') return sendPdf(res, baseName, lists.mealPdf(e, v));
    const { cols, rows } = lists.mealTable(e, v);
    return sendTable(res, format, baseName, cols, rows);
  }
  res.render('pages/meals', {
    title: `${e.name} · Verpflegungsliste`, ...v, scopes: registrations.PARTICIPANT_SCOPES, unresolved: unresolvedCount(e.id),
    leaderView: leaders.isLeader(req.user),
  });
});

// Reiter «Anfragen»
router.get('/einsaetze/:id/anfragen', loadEvent, (req, res) => {
  const e = req.event;
  // Standard: «Noch nicht angefragt»; «alle» zeigt alle. Ist niemand mehr offen, zeigt der Standard alle.
  const asked = req.query.status;
  const filters = { status: asked === undefined ? 'offen' : asked === 'alle' ? '' : asked, team: req.query.team || '', q: req.query.q || '', sort: req.query.sort === 'rang_ab' ? 'rang_ab' : 'rang' };
  let list = inquiries.listForEvent(e.id, filters);
  if (asked === undefined && !list.counts.offen) {
    filters.status = '';
    list = inquiries.listForEvent(e.id, filters);
  }
  const format = wantsExport(req);
  if (format) {
    return sendTable(res, format, `Anfragen ${e.name}`, [
      { label: 'Rang', value: (r) => r.rank_short || '' },
      { label: 'Vorname', value: (r) => r.first_name },
      { label: 'Nachname', value: (r) => r.last_name },
      { label: 'Mannschaft', value: (r) => r.teams || '' },
      { label: 'Mobil', value: (r) => r.mobile || '' },
      { label: 'Anfrage', value: (r) => (INQUIRY_ROW[r.state] || INQUIRY_STATUS[r.inquiry_status]).label },
      { label: 'Kontaktversuche', value: (r) => r.attempts.map((a) => `${inquiries.attemptLabel(a)} ${a.sent_by_name}${a.note ? ` (${a.note})` : ''}`).join('\n') },
    ], list);
  }
  const allUsers = db.all("SELECT id, display_name FROM users WHERE active = 1 AND role <> 'einsatzleiter' ORDER BY display_name");
  res.render('pages/event', { title: `${e.name} · Anfragen`, tab: 'anfragen', list, filters, allUsers, shiftChoices: require('../services/feedback').shiftChoices([e.id]), teams: db.all('SELECT * FROM teams WHERE active = 1 ORDER BY sort, name') });
});

router.post('/einsaetze/:id/anfragen/versuch', loadEvent, (req, res) => {
  // einzeln (person_id) oder für mehrere Ausgewählte auf einmal (person_ids)
  const ids = [...new Set([].concat(req.body.person_ids || req.body.person_id || []).map(Number).filter(Boolean))];
  if (!ids.length) throw new ValidationError(['Bitte zuerst Personen auswählen.']);
  db.tx(() => { for (const pid of ids) inquiries.addAttempt(req.event.id, pid, req.body, req.user); });
  const who = ids.length === 1 ? '' : ` für ${ids.length} Personen`;
  flash(res, 'success', req.body.result === 'zugesagt' ? `Kontaktversuch${who} erfasst – Anmeldung erstellt.` : `Kontaktversuch${who} erfasst.`);
  res.redirect(/^\/(?!\/)/.test(String(req.body.back || '')) ? req.body.back : `/einsaetze/${req.event.id}/anfragen`);
});

// Alles für eine Person bei einem Einsatz zurücksetzen (aus dem Kontaktversuch-Fenster)
router.post('/anfragen/zuruecksetzen', (req, res) => {
  const eventId = Number(req.body.event_id);
  const r = inquiries.resetPerson(eventId, Number(req.body.person_id), req.user);
  flash(res, 'success', r.registration || r.inquiry ? 'Zurückgesetzt. Die Person gilt für diesen Einsatz wieder als offen.' : 'Es gab nichts zurückzusetzen.');
  const b = String(req.body.back || '');
  res.redirect(b.startsWith('/') && !b.startsWith('//') ? b : `/einsaetze/${eventId}/anfragen`);
});

// Anfrage aus den Rückmeldungen oder der Mitgliederseite erfassen
router.post('/anfragen/versuch', (req, res) => {
  const eventId = Number(req.body.event_id);
  if (!db.one('SELECT 1 FROM events WHERE id = ?', eventId)) throw new ValidationError(['Einsatz nicht gefunden.']);
  inquiries.addAttempt(eventId, Number(req.body.person_id), req.body, req.user);
  flash(res, 'success', req.body.result === 'zugesagt' ? 'Kontaktversuch erfasst – Anmeldung erstellt.' : 'Kontaktversuch erfasst.');
  const b = String(req.body.back || '');
  res.redirect(b.startsWith('/') && !b.startsWith('//') ? b : '/rueckmeldungen');
});

router.post('/einsaetze/:id/anfragen/status', loadEvent, (req, res) => {
  inquiries.setStatus(req.event.id, Number(req.body.person_id), req.body.status, req.user);
  flash(res, 'success', 'Anfrage aktualisiert.');
  res.redirect(`/einsaetze/${req.event.id}/anfragen`);
});

router.post('/einsaetze/:id/anfragen/versuch/:aid/loeschen', loadEvent, (req, res) => {
  const r = inquiries.removeAttempt(req.event.id, Number(req.params.aid), req.user);
  flash(res, 'success', r.regRemoved ? 'Kontaktversuch zurückgenommen – die daraus erstellte Anmeldung wurde gelöscht.' : 'Kontaktversuch zurückgenommen.');
  res.redirect(`/einsaetze/${req.event.id}/anfragen`);
});

// Reiter «Schichten»
router.get('/einsaetze/:id/schichten', loadEvent, (req, res) => {
  const e = req.event;
  const stats = events.stats(e);
  const regs = registrations.listForEvent(e.id).filter((r) => r.person_id && !['zurueckgezogen', 'abgesagt', 'ungueltig'].includes(r.status));
  const exts = externals.forEvent(e.id, e.shifts);
  const columns = stats.shifts.map((s) => ({ ...s, regs: regs.filter((r) => r.assigned.some((a) => a.id === s.id)), exts: exts.filter((x) => externals.coversShift(x, s.id)) }));
  const unassigned = regs.filter((r) => !r.assigned.length);
  // Auswahlfeld: alle Kombinationen der Schichten («Tag + Abend»)
  const combos = [];
  const n = e.shifts.length;
  for (let mask = 1; mask < (1 << n) && n <= 4; mask++) {
    const ids = e.shifts.filter((_, i) => mask & (1 << i)).map((s) => s.id);
    combos.push({ value: ids.join(','), label: e.shifts.filter((s) => ids.includes(s.id)).map((s) => (ids.length > 1 ? s.name.replace(/schicht$/i, '') : s.name)).join(' + ') });
  }
  combos.sort((a, b) => a.value.split(',').length - b.value.split(',').length);
  // Vorgesehene Mannschaften pro Schicht: wer nicht vorgesehen ist, wird markiert (nicht gesperrt)
  const teamList = db.all('SELECT id, name, sort, active FROM teams ORDER BY sort, name');
  const pInfo = shiftTeams.personInfo(regs.map((r) => r.person_id));
  const notPlanned = (r, s) => !shiftTeams.allows(s, pInfo.get(r.person_id), shiftTeams.shiftDay(s, e));
  res.render('pages/event', { title: `${e.name} · Schichten`, tab: 'schichten', stats, columns, unassigned, combos, overlaps: registrations.overlaps(e.id), regs,
    teamList, notPlanned, rankList: shiftTeams.allRanks(),
    fnCols: functions.all().filter((f) => f.active || f.is_default || e.shifts.some((s) => s.targets[f.id])), ...functionPanel(e) });
});

router.post('/einsaetze/:id/schichten', loadEvent, (req, res) => {
  events.addShift(req.event.id, req.body, req.user, { reason: req.body.reason });
  flash(res, 'success', 'Schicht hinzugefügt.');
  res.redirect(`/einsaetze/${req.event.id}/schichten`);
});

// Tabelle «Schichten verwalten»: ein Speichern-Knopf für alle Zeilen (Felder <feld>__<schicht-id>, neue Zeile <feld>__neu)
router.post('/einsaetze/:id/schichten/speichern', loadEvent, (req, res) => {
  const rows = {};
  let newRow = null;
  for (const [key, value] of Object.entries(req.body)) {
    const m = /^(\w+?)__(\d+|neu)$/.exec(key);
    if (!m) continue;
    // Mannschaften: mehrere Häkchen pro Zeile -> Liste behalten
    const v = m[1] === 'teams' ? [].concat(value) : Array.isArray(value) ? value[value.length - 1] : value;
    if (m[2] === 'neu') (newRow ||= {})[m[1]] = v;
    else (rows[m[2]] ||= {})[m[1]] = v;
  }
  const r = events.saveShifts(req.event.id, rows, newRow, req.user, { reason: req.body.reason });
  const parts = [];
  if (r.updated) parts.push(r.updated === 1 ? '1 Schicht gespeichert' : `${r.updated} Schichten gespeichert`);
  if (r.added) parts.push('neue Schicht hinzugefügt');
  flash(res, parts.length ? 'success' : 'info', parts.length ? `${parts.join(', ').replace(/^./, (c) => c.toUpperCase())}.` : 'Keine Änderungen – nichts zu speichern.');
  res.redirect(`/einsaetze/${req.event.id}/schichten`);
});

router.post('/schichten/:sid', (req, res) => {
  const s = db.one('SELECT * FROM shifts WHERE id = ?', Number(req.params.sid));
  if (!s) return res.redirect('/einsaetze');
  events.updateShift(s.id, req.body, req.user, { reason: req.body.reason });
  flash(res, 'success', 'Schicht gespeichert.');
  res.redirect(`/einsaetze/${s.event_id}/schichten`);
});

router.post('/schichten/:sid/loeschen', (req, res) => {
  const s = db.one('SELECT * FROM shifts WHERE id = ?', Number(req.params.sid));
  if (!s) return res.redirect('/einsaetze');
  events.deleteShift(s.id, req.user, { reason: req.body.reason });
  flash(res, 'success', 'Schicht gelöscht.');
  res.redirect(`/einsaetze/${s.event_id}/schichten`);
});

// Reiter «Formular»: Vorschau des Einsatzblocks
router.get('/einsaetze/:id/formular', loadEvent, (req, res) => {
  const e = req.event;
  const openShifts = e.shifts.filter((s) => !events.shiftEnded(s, e));
  res.render('pages/event', { title: `${e.name} · Formular`, tab: 'formular', preview: { ...e, openShifts }, inForm: events.isInForm(e), lastEnd: events.lastEnd(e) });
});

// Reiter «Verlauf»
router.get('/einsaetze/:id/verlauf', loadEvent, (req, res) => {
  const log = audit.forEvent(req.event.id);
  const format = wantsExport(req);
  if (format) {
    return sendTable(res, format, `Verlauf ${req.event.name}`, [
      { label: 'Zeitpunkt', value: (l) => h.fmtDateTime(l.created_at) },
      { label: 'Benutzer', value: (l) => l.user_name || '' },
      { label: 'Ereignis', value: (l) => l.summary },
    ], log);
  }
  res.render('pages/event', { title: `${req.event.name} · Verlauf`, tab: 'verlauf', log });
});

// Kalendertermin (.ics)
router.get('/einsaetze/:id/kalender', loadEvent, (req, res) => {
  const { ics, file } = calendar.exportIcs(req.event.id, { scope: req.query.scope || 'event', shiftId: req.query.shift }, req.user);
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', contentDisposition(file.replace(/[\\/:*?"<>|]/g, '_')));
  res.send(ics);
});

module.exports = router;
