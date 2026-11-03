'use strict';
// Status-Historie pro Person und Einsatz: jede Rückmeldung, jeder Statuswechsel und jeder Kontakt
// mit wer und wann. Quelle ist das Protokoll (audit_log) plus die verschickten Bestätigungsmails,
// damit auch alles einfliesst, was schon vor dieser Ansicht erfasst wurde.
const db = require('../db');
const audit = require('./audit');
const live = require('../lib/live');
const { ValidationError } = require('./errors');
const { SOURCE, CHANNEL, REG_STATUS, INQUIRY_STATUS, ATTEMPT_RESULT } = require('../lib/labels');
const { fmtDateTime, fmtRelative, toLocal } = require('../lib/dates');

const SELF = 'Person selbst';

// Anmeldestatus / Anfragestatus -> Symbol der Rückmeldungen-Tabelle
function stateOfReg(status) {
  if (!status) return null;
  if (status === 'ungueltig') return 'offen';
  if (['zurueckgezogen', 'abgesagt'].includes(status)) return 'ab';
  if (['rueckfrage', 'unsicher'].includes(status)) return 'unsicher';
  return 'an';
}
function stateOfResult(result) {
  if (result === 'zugesagt') return 'an';
  if (result === 'abgesagt') return 'ab';
  if (result === 'offen') return 'offen';
  return result ? 'unsicher' : null;
}

function parse(json) {
  try { return json ? JSON.parse(json) : {}; } catch { return {}; }
}

// Text vor « hat » = wer es getan hat (ältere Einträge ohne Details)
const actorOf = (summary) => String(summary || '').split(' hat ')[0];

/** Einen Protokolleintrag in einen kurzen Historie-Eintrag übersetzen */
function entryFromAudit(a) {
  const d = parse(a.details);
  const by = a.user_name || 'System';
  const base = { id: `a${a.id}`, kind: `${a.entity_type}:${a.action}`, userId: a.user_id, at: a.created_at, by, state: null, text: '', note: null };
  const s = a.summary || '';
  switch (`${a.entity_type}:${a.action}`) {
    case 'registration:create': {
      const source = d.quelle || Object.keys(SOURCE).find((k) => s.includes(`· ${SOURCE[k]}`)) || null;
      const no = d.antwort ? d.antwort === 'nein' : / hat für «.*» abgesagt/.test(s);
      const self = !a.user_id && (source === 'formular' || (!source && by === 'System'));
      return {
        ...base, by: self ? SELF : by, self,
        state: no ? 'ab' : (d.status === 'unsicher' || s.includes('Zuordnung unsicher') ? 'unsicher' : 'an'),
        text: `${no ? 'Abgemeldet' : 'Angemeldet'}${source ? ` · ${SOURCE[source]}` : ''}`,
      };
    }
    case 'registration:duplicate': {
      const again = s.includes('erneut angemeldet');
      const late = s.includes('nachträglich');
      return {
        ...base, by: SELF, self: true, state: again ? 'an' : late ? 'unsicher' : null,
        text: again ? 'Erneut angemeldet (vorher abgemeldet)' : late ? 'Nachträglich «Nein» gesendet, Rückfrage nötig' : 'Formular nochmals abgeschickt',
      };
    }
    case 'registration:status': {
      const to = d.status?.neu;
      return { ...base, state: stateOfReg(to), detail: { bestaetigt: 'bestaetigt', warteliste: 'warteliste', rueckfrage: 'rueckfrage' }[to] || null, text: to ? `Anmeldung: ${REG_STATUS[to]?.label || to}` : s };
    }
    case 'registration:assign':
      return { ...base, state: null, text: d.vorher ? `Anmeldung von ${d.vorher} hierher umgehängt` : 'Formular-Anmeldung dieser Person zugeordnet' };
    case 'registration:unassign':
      return { ...base, state: 'offen', text: 'Anmeldung zu einer anderen Person umgehängt' };
    case 'registration:shifts': {
      const m = s.match(/umgeteilt: (.*)$/);
      return { ...base, text: m ? `Schicht: ${m[1]}` : 'Schicht geändert' };
    }
    case 'registration:note':
      return { ...base, text: 'Interne Bemerkung geändert', note: d.internal_note?.neu || null };
    case 'registration:delete':
      return { ...base, state: 'offen', text: `${['zurueckgezogen', 'abgesagt'].includes(d.status) ? 'Abmeldung' : 'Anmeldung'} gelöscht` };
    case 'inquiry:attempt': {
      const ch = d.kanal ? CHANNEL[d.kanal]?.label : null;
      const result = d.ergebnis;
      const sentBy = d.gesendet_von || actorOf(s);
      return {
        ...base, by: sentBy, state: stateOfResult(result), detail: d.kanal === 'muendlich' && !['zugesagt', 'abgesagt'].includes(result) ? 'muendlich' : ({ whatsapp: 'whatsapp', nicht_erreicht: 'telefon' }[result] || null),
        text: `${ch ? `${ch}: ` : ''}${ATTEMPT_RESULT[result] || result || 'Kontakt'}`,
        when: d.zeitpunkt || null,
        enteredBy: d.erfasst_von && d.erfasst_von !== sentBy ? d.erfasst_von : null,
        note: d.notiz || null,
      };
    }
    case 'inquiry:status':
      return { ...base, state: stateOfResult(d.status?.neu), text: `Anfrage: ${INQUIRY_STATUS[d.status?.neu]?.label || d.status?.neu}` };
    case 'inquiry:attempt_delete':
      return { ...base, text: `Kontaktversuch zurückgenommen${d.kanal ? ` (${CHANNEL[d.kanal]?.label})` : ''}` };
    case 'inquiry:reset':
      return { ...base, state: 'offen', text: 'Alles zurückgesetzt' };
    default:
      return { ...base, text: s.replace(/ · [^·]+$/, '') };
  }
}

const MAIL_STATUS = { gesendet: 'gesendet', offen: 'wird gesendet', nicht_konfiguriert: 'nicht gesendet (kein Mailserver)', fehler: 'Fehler beim Senden' };
function entryFromMail(m) {
  return { id: `m${m.id}`, at: m.created_at, by: 'automatisch', state: null, text: `Bestätigungsmail an ${m.to_address}: ${MAIL_STATUS[m.status] || m.status}` };
}

// Ein Kontaktversuch legt die Anmeldung gleich mit an bzw. zieht sie zurück: diese Begleit-Einträge
// direkt vor dem Kontaktversuch weglassen, sonst steht dasselbe zweimal da
function dropEchoes(list) {
  return list.filter((e, i) => {
    const next = list[i + 1];
    if (!next || next.kind !== 'inquiry:attempt' || !['registration:create', 'registration:status'].includes(e.kind)) return true;
    return !(e.userId === next.userId && Math.abs(new Date(next.at) - new Date(e.at)) < 5000);
  });
}

function finish(list) {
  // neueste zuerst, nach dem Zeitpunkt des Geschehens (Kontaktversuche können nachträglich erfasst sein);
  // bei gleicher Minute der später erfasste zuerst
  const key = (e) => {
    const m = e.when && e.when.match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}:\d{2})$/);
    return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4]}` : toLocal(new Date(e.at));
  };
  const order = new Map(list.map((e, i) => [e, [key(e), e.at, i]]));
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  list.sort((x, y) => { const [kx, ax, ix] = order.get(x); const [ky, ay, iy] = order.get(y); return cmp(ky, kx) || cmp(ay, ax) || iy - ix; });
  for (const e of list) { e.atText = e.when || fmtDateTime(e.at); e.atShort = fmtRelative(e.at); }
  return list;
}

const RELEVANT = "a.entity_type IN ('registration','inquiry')";
const CLEAR = 'history_clear';

/** Komplette Historie einer Person bei einem Einsatz, neueste zuerst (nach dem letzten «Verlauf löschen») */
function forPair(eventId, personId) {
  const regIds = db.all('SELECT id FROM registrations WHERE event_id = ? AND person_id = ?', eventId, personId).map((r) => r.id);
  const ph = regIds.map(() => '?').join(',');
  let audits = db.all(`SELECT a.* FROM audit_log a WHERE ${RELEVANT} AND a.event_id = ? AND (a.person_id = ?${regIds.length ? ` OR (a.entity_type = 'registration' AND a.entity_id IN (${ph}))` : ''})
    ORDER BY a.id`, eventId, personId, ...regIds);
  let mails = regIds.length ? db.all(`SELECT * FROM mail_outbox WHERE registration_id IN (${ph}) ORDER BY id`, ...regIds) : [];
  const clearIdx = audits.map((a) => a.action).lastIndexOf(CLEAR);
  const cleared = clearIdx >= 0 ? audits[clearIdx] : null;
  if (cleared) {
    // der beim Löschen neueste Eintrag (aktueller Stand) bleibt stehen
    const keep = parse(cleared.details).behalten || '';
    audits = audits.filter((a, i) => i > clearIdx || `a${a.id}` === keep);
    mails = mails.filter((m) => m.created_at > cleared.created_at || `m${m.id}` === keep);
  }
  const list = finish([...dropEchoes(audits.filter((a) => a.action !== CLEAR).map(entryFromAudit)), ...mails.map(entryFromMail)]);
  list.cleared = cleared ? { by: cleared.user_name || 'System', atText: fmtDateTime(cleared.created_at) } : null;
  return list;
}

/**
 * Verlauf einer Person bei einem Einsatz leeren. Rückmeldung, Anmeldung und Kontaktversuche bleiben unverändert
 * (dafür gibt es «Alles zurücksetzen»). Im Protokoll des Einsatzes bleibt festgehalten, wer den Verlauf wann geleert hat.
 */
function clear(eventId, personId, user) {
  const event = db.one('SELECT id, name FROM events WHERE id = ?', eventId);
  const person = db.one('SELECT id, first_name, last_name FROM persons WHERE id = ?', personId);
  if (!event || !person) throw new ValidationError(['Einsatz oder Person nicht gefunden.']);
  const entries = forPair(eventId, personId);
  // Nur der neueste Stand bleibt: der Eintrag, der das aktuelle Symbol gesetzt hat (sonst der neueste überhaupt)
  const keep = entries.find((e) => e.state) || entries[0] || null;
  const n = Math.max(0, entries.length - (keep ? 1 : 0));
  audit.log({
    entity: 'inquiry', eventId, personId, action: CLEAR,
    summary: `${user.display_name} hat den Verlauf von ${person.first_name} ${person.last_name} bis auf den neuesten Eintrag gelöscht (${n} Einträge) · ${event.name}`,
    details: { eintraege: n, behalten: keep?.id || null }, user,
  });
  live.notify(`event:${eventId}`, 'feedback', `person:${personId}`);
  return n;
}

/**
 * Letzter Eintrag, der den Stand verändert hat, pro «personId:eventId» (für das Icon in der Tabelle).
 * Einträge ohne Statusbezug (z. B. Schicht, Bemerkung) zählen nur, wenn es sonst nichts gibt.
 */
function latestByPair(eventIds) {
  const out = new Map();
  if (!eventIds.length) return out;
  const ph = eventIds.map(() => '?').join(',');
  // Formular-Anmeldungen ohne Person (später zugeordnet) über die Anmeldung der Person finden
  const regPerson = new Map(db.all(`SELECT id, person_id FROM registrations WHERE event_id IN (${ph}) AND person_id IS NOT NULL`, ...eventIds).map((r) => [r.id, r.person_id]));
  const rows = db.all(`SELECT a.* FROM audit_log a WHERE ${RELEVANT} AND a.event_id IN (${ph}) ORDER BY a.id`, ...eventIds);
  const byPair = new Map();
  const clearedAt = new Map();
  const keptMail = new Map();
  for (const a of rows) {
    const personId = a.person_id || (a.entity_type === 'registration' ? regPerson.get(a.entity_id) : null);
    if (!personId) continue;
    const key = `${personId}:${a.event_id}`;
    if (a.action === CLEAR) {
      const keep = parse(a.details).behalten || '';
      byPair.set(key, (byPair.get(key) || []).filter((e) => e.id === keep));
      clearedAt.set(key, a.created_at);
      keptMail.set(key, keep);
      continue;
    }
    if (!byPair.has(key)) byPair.set(key, []);
    byPair.get(key).push(entryFromAudit(a));
  }
  // Bestätigungsmails zählen im Verlauf mit
  const mails = new Map();
  for (const m of db.all(`SELECT o.id, g.person_id, g.event_id, o.created_at FROM mail_outbox o JOIN registrations g ON g.id = o.registration_id
    WHERE g.event_id IN (${ph}) AND g.person_id IS NOT NULL`, ...eventIds)) {
    const key = `${m.person_id}:${m.event_id}`;
    if (clearedAt.has(key) && m.created_at <= clearedAt.get(key) && keptMail.get(key) !== `m${m.id}`) continue;
    mails.set(key, (mails.get(key) || 0) + 1);
  }
  for (const [key, all] of byPair) {
    const list = dropEchoes(all);
    if (!list.length) continue;
    const e = [...list].reverse().find((x) => x.state) || list[list.length - 1];
    e.count = list.length + (mails.get(key) || 0);
    out.set(key, finish([e])[0]);
  }
  return out;
}

/**
 * Protokollzeilen (z. B. «Letzte Aktivität» einer Person) ohne die per «Verlauf löschen» gelöschten Einträge.
 * Die Zeile «hat den Verlauf … gelöscht» selbst bleibt stehen.
 */
function withoutCleared(rows) {
  const pairs = [...new Set(rows.filter((a) => a.event_id && a.person_id).map((a) => `${a.person_id}:${a.event_id}`))];
  if (!pairs.length) return rows;
  const clears = new Map();
  for (const c of db.all(`SELECT id, event_id, person_id, details FROM audit_log WHERE action = ? ORDER BY id`, CLEAR)) {
    clears.set(`${c.person_id}:${c.event_id}`, { id: c.id, keep: parse(c.details).behalten || '' });
  }
  return rows.filter((a) => {
    if (a.action === CLEAR || !['registration', 'inquiry'].includes(a.entity_type)) return true;
    const c = clears.get(`${a.person_id}:${a.event_id}`);
    return !c || a.id > c.id || `a${a.id}` === c.keep;
  });
}

module.exports = { forPair, latestByPair, clear, withoutCleared, entryFromAudit, SELF };
