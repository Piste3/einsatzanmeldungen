'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers');
const db = require('../src/db');
const users = require('../src/services/users');
const totp = require('../src/auth/totp');
const twofa = require('../src/auth/twofa');
const { createApp } = require('../src/app');

test('TOTP entspricht RFC 6238', () => {
  const secret = totp.base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(totp.codeAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totp.codeAt(secret, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totp.codeAt(secret, Math.floor(2000000000 / 30)), '279037');
  // Wiederverwendung desselben Zeitfensters wird abgelehnt
  const now = 1111111109000;
  const step = totp.verify(secret, '081804', { now });
  assert.ok(step);
  assert.equal(totp.verify(secret, '081804', { now, lastStep: step }), null);
});

let server; let base;
const enc = (o) => new URLSearchParams(o);
async function post(path, body, cookie = '') {
  return fetch(`${base}${path}`, { method: 'POST', redirect: 'manual', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: enc(body) });
}
const cookiesOf = (res) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).filter((c) => !c.endsWith('='));
const join = (...lists) => lists.flat().join('; ');
const currentCode = (id) => totp.codeAt(db.one('SELECT totp_secret FROM users WHERE id = ?', id).totp_secret, totp.currentStep());

test.before(async () => {
  freshDb();
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function enable(id) {
  const u = users.get(id);
  twofa.beginSetup(u);
  const codes = twofa.confirmSetup(u, currentCode(id));
  db.run('UPDATE users SET totp_last_step = NULL WHERE id = ?', id); // Testcode gleich nochmals verwendbar machen
  return codes;
}

test('Login mit 2FA: Code nötig, falscher Code abgelehnt, «Gerät merken» wirkt', async () => {
  const { id } = await users.create({ username: 'anna', display_name: 'Anna', role: 'aufgebotsstelle', password: 'Geheim-Passwort-1', must_change_password: false, twofa_remember_days: 7 }, null);
  await enable(id);
  const r1 = await post('/login', { username: 'anna', password: 'Geheim-Passwort-1', next: '/' });
  assert.equal(r1.headers.get('location'), '/login/2fa');
  const challenge = cookiesOf(r1);
  assert.ok(!challenge.some((c) => c.startsWith('kkb_session')), 'noch keine Sitzung vor dem Code');

  const bad = await post('/login/2fa', { code: '000000' }, join(challenge));
  assert.equal(bad.status, 401);

  const ok = await post('/login/2fa', { code: currentCode(id), remember: '1' }, join(challenge));
  assert.equal(ok.status, 302);
  const after = cookiesOf(ok);
  assert.ok(after.some((c) => c.startsWith('kkb_session')));
  const device = after.filter((c) => c.startsWith('kkb_device'));
  assert.equal(device.length, 1);

  // Mit gemerktem Gerät kein Code mehr
  const r2 = await post('/login', { username: 'anna', password: 'Geheim-Passwort-1', next: '/' }, join(device));
  assert.equal(r2.headers.get('location'), '/');
  // Ohne das Gerät wieder Code
  const r3 = await post('/login', { username: 'anna', password: 'Geheim-Passwort-1', next: '/' });
  assert.equal(r3.headers.get('location'), '/login/2fa');
});

test('Wiederherstellungscode funktioniert genau einmal', async () => {
  const { id } = await users.create({ username: 'ben', display_name: 'Ben', role: 'aufgebotsstelle', password: 'Geheim-Passwort-2', must_change_password: false }, null);
  const codes = await enable(id);
  assert.equal(codes.length, 10);
  const login = async () => cookiesOf(await post('/login', { username: 'ben', password: 'Geheim-Passwort-2', next: '/' }));
  const ok = await post('/login/2fa', { code: codes[0].toUpperCase() }, join(await login()));
  assert.equal(ok.status, 302);
  const again = await post('/login/2fa', { code: codes[0] }, join(await login()));
  assert.equal(again.status, 401);
});

test('Fehlversuche mit Codes sperren das Konto, auch über neue Logins hinweg', async () => {
  const { id } = await users.create({ username: 'carla', display_name: 'Carla', role: 'aufgebotsstelle', password: 'Geheim-Passwort-3', must_change_password: false }, null);
  await enable(id);
  for (let i = 0; i < 5; i++) {
    const c = cookiesOf(await post('/login', { username: 'carla', password: 'Geheim-Passwort-3', next: '/' }));
    await post('/login/2fa', { code: '111111' }, join(c));
  }
  const locked = await post('/login', { username: 'carla', password: 'Geheim-Passwort-3', next: '/' });
  assert.equal(locked.status, 401);
});

test('Pflicht-2FA: ohne Einrichtung nur die Einrichtungsseite', async () => {
  await users.create({ username: 'dora', display_name: 'Dora', role: 'aufgebotsstelle', password: 'Geheim-Passwort-4', must_change_password: false, twofa_required: '1' }, null);
  const r = await post('/login', { username: 'dora', password: 'Geheim-Passwort-4', next: '/' });
  const cookie = join(cookiesOf(r));
  const home = await fetch(`${base}/`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(home.headers.get('location'), '/konto/2fa');
  const page = await fetch(`${base}/konto/2fa`, { headers: { cookie }, redirect: 'manual' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<svg/);
});
