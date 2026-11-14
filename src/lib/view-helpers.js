'use strict';
// Hilfsfunktionen für die Vorlagen (EJS) und gemeinsame Middleware
const dates = require('./dates');
const labels = require('./labels');

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function badge(text, tone = 'gray', extra = '') {
  return `<span class="badge badge-${tone}${extra ? ` ${extra}` : ''}">${escapeHtml(text)}</span>`;
}

function regBadge(status) {
  const s = labels.REG_STATUS[status] || { label: status, tone: 'gray' };
  return badge(s.label, s.tone);
}

function eventBadge(status) {
  const s = labels.EVENT_STATUS[status] || { label: status, tone: 'gray' };
  return badge(s.label, s.tone);
}

// Status für Listen und Kopfzeile: Ein veröffentlichter Einsatz zeigt, ob er im Formular steht.
// So gibt es nur eine Anzeige statt «Veröffentlicht» und dazu ein eigenes Abzeichen «im Formular».
function eventState(e) {
  if (e.status !== 'veroeffentlicht') return eventBadge(e.status);
  const inForm = typeof e.inForm === 'boolean' ? e.inForm : require('../services/events').isInForm(e);
  const [text, tone, title] = inForm
    ? ['Im Formular', 'green', 'Veröffentlicht und im Anmeldeformular']
    : ['Nicht im Formular', 'gray', e.show_in_form ? 'Veröffentlicht, letzte Schicht ist vorbei' : 'Veröffentlicht, von Hand aus dem Formular genommen'];
  return `<span class="badge badge-${tone}" title="${escapeHtml(title)}">${escapeHtml(text)}</span>`;
}

// Link für WhatsApp (wa.me) aus einer Schweizer Mobilnummer, z. B. 079 123 45 67 -> 41791234567
function waLink(mobile) {
  let d = String(mobile || '').replace(/[^\d+]/g, '');
  if (!d) return null;
  if (d.startsWith('+')) d = d.slice(1);
  else if (d.startsWith('00')) d = d.slice(2);
  else if (d.startsWith('0')) d = `41${d.slice(1)}`;
  return /^\d{8,15}$/.test(d) ? `https://wa.me/${d}` : null;
}

function inquiryBadge(status) {
  const s = labels.INQUIRY_ROW[status] || labels.INQUIRY_STATUS[status] || { label: status, tone: 'gray' };
  return badge(s.label, s.tone);
}

function feedbackBadge(state) {
  const s = labels.FEEDBACK[state];
  return badge(s.label, s.tone, 'badge-cell');
}

function rank(short) {
  return short ? `<span class="rank">${escapeHtml(short)}</span>` : '';
}

function initials(name) {
  return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

function personName(p) {
  return p ? `${p.first_name} ${p.last_name}` : '';
}

// URL mit geänderten Query-Parametern (Filter in der Adresse)
function withQuery(base, query, changes = {}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...query, ...changes })) {
    if (v !== undefined && v !== null && v !== '') params.set(k, v);
  }
  const s = params.toString();
  return s ? `${base}?${s}` : base;
}

function pct(ist, soll) {
  if (!soll) return ist ? 100 : 0;
  return Math.min(100, Math.round((ist / soll) * 100));
}

function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, '<br>');
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// Kurzlebige Meldungen nach einer Aktion («Gespeichert»)
function flash(res, type, message) {
  const list = res.locals._flashOut || [];
  list.push({ type, message });
  res.locals._flashOut = list;
  // Über die JSON-Schnittstelle kommen die Meldungen in der Antwort, nicht im Cookie
  if (res.locals._api) return;
  res.cookie('kkb_flash', Buffer.from(JSON.stringify(list)).toString('base64url'), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60000 });
}

function flashMiddleware(req, res, next) {
  res.locals.flashes = [];
  const raw = req.cookies?.kkb_flash;
  if (raw) {
    try { res.locals.flashes = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')); } catch { /* ignorieren */ }
    res.clearCookie('kkb_flash', { path: '/' });
  }
  next();
}

function localsMiddleware(req, res, next) {
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.isAdmin = req.user?.role === 'admin';
  res.locals.isLeader = req.user?.role === 'einsatzleiter';
  res.locals.liveTopics = [];
  res.locals.title = '';
  next();
}

function navMiddleware(req, res, next) {
  res.locals.nav = req.user?.role === 'einsatzleiter' ? {} : require('../services/cockpit').navCounts();
  next();
}

module.exports = {
  ...dates, labels, escapeHtml, badge, regBadge, eventBadge, eventState, inquiryBadge, waLink, feedbackBadge, rank, initials, personName, withQuery, pct, nl2br,
  plural, flash, flashMiddleware, localsMiddleware, navMiddleware, icon: require('./icons').icon,
  // Vorlage für den Text-Editor: alte Klartext-Vorlagen in HTML umwandeln
  editorHtml: (template, format) => (format === 'html' ? String(template || '') : require('./html').textToHtml(template)),
  sanitizeHtml: (html) => require('./html').sanitize(html),
};
