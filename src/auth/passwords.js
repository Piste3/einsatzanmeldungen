'use strict';
// Passwort-Hashing mit scrypt (Node-Bordmittel, keine native Zusatzbibliothek).
// Format: scrypt$N$r$p$salt(base64)$hash(base64)
const crypto = require('node:crypto');

const PARAMS = { N: 2 ** 15, r: 8, p: 1, keylen: 64 };
const MIN_LENGTH = 10;

function scrypt(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: 128 * N * r * 2 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize('NFKC'), salt, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), {
    N: Number(N), r: Number(r), p: Number(p), keylen: expected.length,
  });
  return crypto.timingSafeEqual(key, expected);
}

// Ein Hash, gegen den bei unbekanntem Benutzernamen geprüft wird (gleiche Antwortzeit)
let dummyHash = null;
async function verifyDummy(password) {
  if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
  await verifyPassword(password, dummyHash);
  return false;
}

function needsRehash(stored) {
  const parts = String(stored || '').split('$');
  return parts[0] !== 'scrypt' || Number(parts[1]) < PARAMS.N;
}

function checkPolicy(password, { username } = {}) {
  const errors = [];
  const pw = String(password || '');
  if (pw.length < MIN_LENGTH) errors.push(`Das Passwort muss mindestens ${MIN_LENGTH} Zeichen lang sein.`);
  if (username && pw.toLowerCase().includes(String(username).toLowerCase())) errors.push('Das Passwort darf den Benutzernamen nicht enthalten.');
  if (/^(.)\1+$/.test(pw)) errors.push('Das Passwort ist zu einfach.');
  return errors;
}

function randomPassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(length);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

module.exports = { hashPassword, verifyPassword, verifyDummy, needsRehash, checkPolicy, randomPassword, MIN_LENGTH };
