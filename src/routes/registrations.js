'use strict';
const express = require('express');
const db = require('../db');
const registrations = require('../services/registrations');
const functions = require('../services/functions');
const { flash } = require('../lib/view-helpers');
const { REG_STATUS } = require('../lib/labels');
const { ConflictError, ValidationError } = require('../services/errors');

const router = express.Router();

function back(req, reg) {
  const b = String(req.body.back || '');
  return b.startsWith('/') && !b.startsWith('//') ? b : `/einsaetze/${reg.event_id}/anmeldungen`;
}

function load(req) {
  const reg = registrations.get(Number(req.params.rid));
  if (!reg) throw new ValidationError(['Anmeldung nicht gefunden.']);
  return reg;
}

// Einzelaktion «Bestätigen» usw. (prüft den erwarteten Vorzustand)
router.post('/anmeldungen/:rid/status', (req, res) => {
  const reg = load(req);
  const r = registrations.setStatus(reg.id, req.body.status, req.user, { expected: req.body.expected || null });
  if (r.changed) flash(res, 'success', `${registrations.personLabel(reg)}: ${REG_STATUS[req.body.status].label}.`);
  res.redirect(back(req, reg));
});

// Ganz löschen (zurücksetzen, als wäre nie etwas eingegangen)
router.post('/anmeldungen/:rid/loeschen', (req, res) => {
  const reg = load(req);
  registrations.remove(reg.id, req.user);
  flash(res, 'success', `${['zurueckgezogen', 'abgesagt'].includes(reg.status) ? 'Abmeldung' : 'Anmeldung'} von ${registrations.personLabel(reg)} gelöscht.`);
  res.redirect(back(req, reg));
});

// Sammelaktionen
router.post('/einsaetze/:id/anmeldungen/sammel', (req, res) => {
  const ids = [].concat(req.body.ids || []).map(Number).filter(Boolean);
  const eventId = Number(req.params.id);
  const valid = ids.filter((id) => db.one('SELECT 1 FROM registrations WHERE id = ? AND event_id = ?', id, eventId));
  if (!valid.length) {
    flash(res, 'error', 'Bitte zuerst Anmeldungen ankreuzen.');
  } else if (req.body.function_select) {
    const { changed, errors } = functions.bulkAssign(valid, Number(req.body.function_select), req.user);
    flash(res, errors.length ? 'error' : 'success', `Funktion bei ${changed} Anmeldung${changed === 1 ? '' : 'en'} gesetzt.${errors.length ? ` ${[...new Set(errors)].join(' ')}` : ''}`);
  } else if (req.body.bulk_action === 'export') {
    return res.redirect(`/einsaetze/${eventId}/anmeldungen?format=${req.body.format === 'csv' ? 'csv' : 'xlsx'}`);
  } else {
    const { changed, errors } = registrations.bulkStatus(valid, req.body.status_button || req.body.status_select, req.user);
    flash(res, errors.length ? 'error' : 'success', `${changed} Anmeldung${changed === 1 ? '' : 'en'} geändert.${errors.length ? ` ${[...new Set(errors)].join(' ')}` : ''}`);
  }
  res.redirect(String(req.body.back || '').startsWith('/') ? req.body.back : `/einsaetze/${eventId}/anmeldungen`);
});

// Funktion zuweisen (EL, SC, BF, Einsatzteilnehmer …)
router.post('/anmeldungen/:rid/funktion', (req, res) => {
  const reg = load(req);
  const r = functions.assign(reg.id, Number(req.body.function_id) || null, req.user);
  if (r.changed) flash(res, 'success', `${registrations.personLabel(reg)}: Funktion ${r.target.name} (${r.target.short}).`);
  res.redirect(back(req, reg));
});

router.post('/anmeldungen/:rid/notiz', (req, res) => {
  const reg = load(req);
  try {
    registrations.updateNote(reg.id, req.body.internal_note, req.body.version, req.user);
    flash(res, 'success', 'Interne Bemerkung gespeichert.');
    res.redirect(back(req, reg));
  } catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    res.status(409).render('pages/conflict', {
      title: 'Gleichzeitige Änderung', who: err.lastChange?.user_name || 'jemand anderem', when: err.lastChange?.created_at, summary: err.lastChange?.summary,
      rows: [{ key: 'internal_note', label: 'Interne Bemerkung', theirs: err.current.internal_note || '', mine: req.body.internal_note || '' },
        { key: 'status', label: 'Status', theirs: REG_STATUS[err.current.status].label, mine: REG_STATUS[reg.status].label, info: true }],
      action: `/anmeldungen/${reg.id}/notiz`, version: err.current.version, mine: { internal_note: req.body.internal_note, back: back(req, reg) },
      backUrl: back(req, reg), editUrl: back(req, reg),
    });
  }
});

router.post('/anmeldungen/:rid/schichten', (req, res) => {
  const reg = load(req);
  const ids = String(req.body.shift_ids ?? '').split(',').concat(req.body.shift_id || []).map(Number).filter(Boolean);
  if (req.body.add_shift) ids.push(...reg.assigned.map((a) => a.id), Number(req.body.add_shift));
  registrations.setShifts(reg.id, ids, req.user);
  if (!req.xhr && req.get('accept')?.includes('json')) return res.json({ ok: true });
  flash(res, 'success', 'Schichtzuteilung gespeichert.');
  res.redirect(String(req.body.back || '').startsWith('/') ? req.body.back : `/einsaetze/${reg.event_id}/schichten`);
});

// Anmeldung von Hand erfassen
router.post('/einsaetze/:id/anmeldungen', (req, res) => {
  const eventId = Number(req.params.id);
  const person = db.one('SELECT * FROM persons WHERE id = ?', Number(req.body.person_id));
  if (!person) throw new ValidationError(['Bitte eine Person wählen.']);
  const source = ['manuell', 'telefon', 'whatsapp', 'muendlich'].includes(req.body.source) ? req.body.source : 'manuell';
  registrations.create({
    eventId, personId: person.id, enteredFirst: person.first_name, enteredLast: person.last_name, matchType: 'manuell', source,
    answer: 'ja', wishes: [].concat(req.body.shift_ids || []).map(Number), remark: String(req.body.remark || '').trim() || null, user: req.user,
  });
  flash(res, 'success', `Anmeldung für ${person.first_name} ${person.last_name} erfasst.`);
  res.redirect(`/einsaetze/${eventId}/anmeldungen`);
});

// Umhängen auf eine andere Person (auch aus den Klärungen)
router.post('/anmeldungen/:rid/zuordnen', (req, res) => {
  const reg = load(req);
  const r = registrations.assignPerson(reg.id, Number(req.body.person_id), req.user, {
    saveAlias: req.body.save_alias === '1', keepShifts: req.body.keep_shifts !== '0',
  });
  if (r.changed) flash(res, 'success', `Zugeordnet.${r.aliasSaved ? ' Die Schreibweise wird künftig automatisch erkannt.' : ''}`);
  const b = String(req.body.back || '');
  res.redirect(b.startsWith('/') && !b.startsWith('//') ? b : `/einsaetze/${reg.event_id}/anmeldungen`);
});

module.exports = router;
