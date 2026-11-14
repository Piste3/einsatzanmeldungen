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
const { client } = require('./client');
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
// Anmelden mit Passwort; bei 2FA bleibt der Browser auf «/login/2fa» stehen
async function start(username, password, device) {
  const c = client(base);
  if (device) c.jar.set(...device);
  c.res = await c.login(username, password);
  return c;
}
const code = (c, body) => c.post('/login/2fa', body);

test('Login mit 2FA: Code nötig, falscher Code abgelehnt, «Gerät merken» wirkt', async () => {
  const { id } = await users.create({ username: 'anna', display_name: 'Anna', role: 'aufgebotsstelle', password: 'Geheim-Passwort-1', must_change_password: false, twofa_remember_days: 7 }, null);
  await enable(id);
  const c = await start('anna', 'Geheim-Passwort-1');
  assert.equal(c.res.redirect, '/login/2fa');
  assert.ok(![...c.jar.keys()].some((k) => k.startsWith('kkb_session')), 'noch keine Sitzung vor dem Code');
  assert.equal((await c.get('/')).status, 401);

  assert.equal((await code(c, { code: '000000' })).status, 401);

  const ok = await code(c, { code: currentCode(id), remember: '1' });
  assert.equal(ok.redirect, '/');
  assert.ok([...c.jar.keys()].some((k) => k.startsWith('kkb_session')));
  const device = [...c.jar].find(([k]) => k.startsWith('kkb_device'));
  assert.ok(device);
  assert.equal((await c.get('/')).status, 200);

  // Mit gemerktem Gerät kein Code mehr
  assert.equal((await start('anna', 'Geheim-Passwort-1', device)).res.redirect, '/');
  // Ohne das Gerät wieder Code
  assert.equal((await start('anna', 'Geheim-Passwort-1')).res.redirect, '/login/2fa');
});

test('Wiederherstellungscode funktioniert genau einmal', async () => {
  const { id } = await users.create({ username: 'ben', display_name: 'Ben', role: 'aufgebotsstelle', password: 'Geheim-Passwort-2', must_change_password: false }, null);
  const codes = await enable(id);
  assert.equal(codes.length, 10);
  const ok = await code(await start('ben', 'Geheim-Passwort-2'), { code: codes[0].toUpperCase() });
  assert.equal(ok.redirect, '/');
  const again = await code(await start('ben', 'Geheim-Passwort-2'), { code: codes[0] });
  assert.equal(again.status, 401);
});

test('Fehlversuche mit Codes sperren das Konto, auch über neue Logins hinweg', async () => {
  const { id } = await users.create({ username: 'carla', display_name: 'Carla', role: 'aufgebotsstelle', password: 'Geheim-Passwort-3', must_change_password: false }, null);
  await enable(id);
  for (let i = 0; i < 5; i++) await code(await start('carla', 'Geheim-Passwort-3'), { code: '111111' });
  assert.equal((await start('carla', 'Geheim-Passwort-3')).res.status, 401);
});

test('Pflicht-2FA: ohne Einrichtung nur die Einrichtungsseite', async () => {
  await users.create({ username: 'dora', display_name: 'Dora', role: 'aufgebotsstelle', password: 'Geheim-Passwort-4', must_change_password: false, twofa_required: '1' }, null);
  const c = await start('dora', 'Geheim-Passwort-4');
  assert.equal((await c.get('/')).redirect, '/konto/2fa');
  const page = await c.get('/konto/2fa');
  assert.equal(page.status, 200);
  assert.match(JSON.stringify(page.data), /<svg/, 'QR-Code zum Einrichten');
  assert.ok(!('totp_secret' in page.data.u), 'Geheimnis des Kontos bleibt im Server');
});

test('Benutzer löschen: nicht sich selbst, nicht den letzten Admin, Daten bleiben', async () => {
  const admin = await users.create({ username: 'chef', display_name: 'Chef', role: 'admin', password: 'Geheim-Passwort-9', must_change_password: false }, null);
  const other = await users.create({ username: 'ella', display_name: 'Ella', role: 'aufgebotsstelle', password: 'Geheim-Passwort-8', must_change_password: false }, null);
  const actor = users.get(admin.id);
  assert.throws(() => users.remove(admin.id, actor), /eigene/);
  for (const u of db.all("SELECT id FROM users WHERE role = 'admin' AND id <> ?", admin.id)) db.run('UPDATE users SET active = 0 WHERE id = ?', u.id);
  const second = await users.create({ username: 'zweit', display_name: 'Zweit', role: 'admin', password: 'Geheim-Passwort-7', must_change_password: false }, null);
  db.run('UPDATE users SET active = 0 WHERE id = ?', second.id);
  assert.throws(() => users.remove(admin.id, users.get(second.id)), /letzte/);
  users.remove(other.id, actor);
  assert.equal(users.get(other.id), undefined);
});
