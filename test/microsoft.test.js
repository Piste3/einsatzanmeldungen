'use strict';
// Microsoft-Anmeldung mit nachgebildetem Microsoft (fetch wird ersetzt)
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { freshDb } = require('./helpers');
const db = require('../src/db');
const config = require('../src/config');

config.authProviders = ['local', 'microsoft'];
Object.assign(config.microsoft, { tenantId: 'common', clientId: 'app-123', clientSecret: 'geheim', allowedTenants: [] });
const users = require('../src/services/users');
const ms = require('../src/auth/providers/microsoft');

const TID = '11111111-2222-3333-4444-555555555555';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
const sign = (claims) => {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
};

let nextClaims;
global.fetch = async (url) => {
  const u = String(url);
  const json = (o) => ({ ok: true, json: async () => o });
  if (u.includes('openid-configuration')) return json({ authorization_endpoint: 'https://login.example/auth', token_endpoint: 'https://login.example/token', jwks_uri: 'https://login.example/keys' });
  if (u.endsWith('/keys')) return json({ keys: [jwk] });
  if (u.endsWith('/token')) return json({ id_token: sign(nextClaims) });
  throw new Error(`unerwartet: ${u}`);
};

// Startet den Ablauf und liefert die Rückkehr von Microsoft mit den gegebenen Angaben
async function loginAs(claims) {
  const res = { cookie(n, v) { this.saved = v; }, redirect(u) { this.url = u; }, clearCookie() {} };
  await ms.start({}, res);
  const { state, nonce } = JSON.parse(res.saved);
  const now = Math.floor(Date.now() / 1000);
  nextClaims = { aud: 'app-123', iss: `https://login.microsoftonline.com/${TID}/v2.0`, tid: TID, oid: 'oid-1', nbf: now, exp: now + 600, nonce, ...claims };
  return ms.callback({ query: { state, code: 'c' }, cookies: { kkb_oidc: res.saved } }, res);
}

test('Microsoft-Login nur mit Freigabe, danach über die feste ID', async () => {
  freshDb();
  const admin = { id: 0, display_name: 'Test' };
  const { id } = await users.create({ username: 'yann', display_name: 'Yann', role: 'admin', email: 'yann@kkb.ch', password: 'Sehr-Sicher-2026' }, null);
  assert.equal(ms.enabled(), true);

  let r = await loginAs({ preferred_username: 'Yann@kkb.ch' });
  assert.equal(r.ok, false, 'ohne Freigabe kein Zugang');

  users.update(id, { display_name: 'Yann', role: 'admin', email: 'yann@kkb.ch', login_fields: '1', ms_login: '1', password_login: '1', active: '1' }, admin);
  // Nur die (fälschbare) E-Mail-Angabe genügt nicht
  r = await loginAs({ preferred_username: 'fremd@boese.example', email: 'yann@kkb.ch', oid: 'oid-x' });
  assert.equal(r.ok, false);

  r = await loginAs({ preferred_username: 'Yann@kkb.ch' });
  assert.equal(r.ok, true);
  assert.equal(r.user.id, id);
  assert.equal(db.one('SELECT external_id, auth_provider FROM users WHERE id = ?', id).external_id, `${TID}:oid-1`);
  assert.equal(users.get(id).auth_provider, 'local', 'Passwort-Login bleibt bestehen');

  // Verknüpft: klappt auch mit geändertem Anmeldenamen, aber nicht mit anderer Objekt-ID
  assert.equal((await loginAs({ preferred_username: 'neu@kkb.ch' })).ok, true);
  assert.equal((await loginAs({ preferred_username: 'yann@kkb.ch', oid: 'oid-2' })).ok, false);

  // Falsche Anwendung oder falsche Signatur
  await assert.rejects(loginAs({ preferred_username: 'yann@kkb.ch', aud: 'andere-app' }));

  // Nur noch Microsoft: Passwort-Login abgelehnt, solange Microsoft eingeschaltet ist
  const local = require('../src/auth/providers/local');
  const form = { display_name: 'Yann', role: 'admin', email: 'yann@kkb.ch', active: '1', login_fields: '1' };
  assert.throws(() => users.update(id, form, admin), /Mindestens eine Anmeldeart/);
  const { id: otherId } = await users.create({ username: 'neu', display_name: 'Neu', role: 'admin', password: 'Sehr-Sicher-2026' }, null);
  assert.throws(() => users.update(otherId, { ...form, email: 'neu@kkb.ch', ms_login: '1' }, users.get(otherId)), /zuerst einmal erfolgreich mit Microsoft/);
  users.update(id, { ...form, ms_login: '1' }, users.get(id));
  assert.equal(users.get(id).password_login, 0);
  const pw = { username: 'yann', password: 'Sehr-Sicher-2026', ip: '1.2.3.4' };
  assert.match((await local.authenticate(pw)).error, /nur die Anmeldung mit Microsoft/);
  assert.equal((await loginAs({ preferred_username: 'yann@kkb.ch' })).ok, true);
  // Ohne Feld im Formular bleibt die Einstellung erhalten
  users.update(id, { display_name: 'Yann', role: 'admin', email: 'yann@kkb.ch', active: '1' }, admin);
  assert.equal(users.get(id).password_login, 0);
  // Notausgang: Microsoft auf dem Server aus -> Passwort gilt wieder
  config.authProviders = ['local'];
  assert.equal((await local.authenticate(pw)).ok, true);
  config.authProviders = ['local', 'microsoft'];

  // Freigabe entziehen löst die Verknüpfung
  users.update(id, { ...form, password_login: '1' }, admin);
  assert.equal(users.get(id).external_id, null);
  assert.equal((await loginAs({ preferred_username: 'yann@kkb.ch' })).ok, false);
});
