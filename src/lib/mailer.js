'use strict';
// E-Mail-Versand. Jede Nachricht wird zuerst im Postausgang gespeichert;
// ohne SMTP-Konfiguration bleibt sie dort mit Status «nicht konfiguriert» sichtbar.
const db = require('../db');
const config = require('../config');
const { nowIso } = require('./dates');

let transport = null;
function getTransport() {
  if (!config.smtp.host) return null;
  if (!transport) {
    const nodemailer = require('nodemailer');
    transport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transport;
}

async function send({ to, subject, body, registrationId = null, attachments = [] }) {
  const info = db.run(
    'INSERT INTO mail_outbox (to_address, subject, body, status, registration_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    to, subject, body, 'offen', registrationId, nowIso(),
  );
  const id = Number(info.lastInsertRowid);
  const t = getTransport();
  if (!t) {
    db.run("UPDATE mail_outbox SET status = 'nicht_konfiguriert' WHERE id = ?", id);
    return { id, sent: false };
  }
  try {
    await t.sendMail({ from: config.smtp.from || config.smtp.user, to, subject, text: body, attachments });
    db.run("UPDATE mail_outbox SET status = 'gesendet', sent_at = ? WHERE id = ?", nowIso(), id);
    return { id, sent: true };
  } catch (err) {
    db.run("UPDATE mail_outbox SET status = 'fehler', error = ? WHERE id = ?", String(err.message).slice(0, 500), id);
    return { id, sent: false, error: err.message };
  }
}

module.exports = { send, isConfigured: () => Boolean(config.smtp.host) };
