// Phase 1 regression tests: authentication bypass, registration takeover,
// account bootstrap. All accounts are synthetic.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin } from './helpers.js';

let server;
let admin;

before(async () => {
  server = await startServer();
  admin = await bootstrapAdmin(server.base, 'auth');
});
after(async () => { await server.close(); });

test('bootstrap creates the first admin and returns a working token', async () => {
  const me = await api(server.base, 'GET', '/api/auth/me', { token: admin.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.email, 'admin_auth@test.local');
});

test('bootstrap is permanently disabled once a user exists', async () => {
  const res = await api(server.base, 'POST', '/api/auth/bootstrap', {
    body: { username: 'attacker', email: 'attacker@test.local', password: 'AttackerPass123!' }
  });
  assert.equal(res.status, 403);
});

test('valid login succeeds', async () => {
  const res = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'AdminPass123!' }
  });
  assert.equal(res.status, 200);
  assert.ok(res.data.token);
  assert.equal(res.data.user.email, 'admin_auth@test.local');
});

test('invalid login returns 401 and does NOT issue a token (P0-1)', async () => {
  const res = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'wrong-password-here' }
  });
  assert.equal(res.status, 401);
  assert.equal(res.data.token, undefined);
});

test('failed login does not change the stored password (P0-1)', async () => {
  // Attempt with wrong password
  await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'attacker-guess' }
  });
  // Original password must still work
  const ok = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'AdminPass123!' }
  });
  assert.equal(ok.status, 200);
  // And the attacker's password must NOT work
  const bad = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'attacker-guess' }
  });
  assert.equal(bad.status, 401);
});

test('login does not auto-create unknown accounts', async () => {
  const res = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'never-registered@test.local', password: 'WhateverPass123!' }
  });
  assert.equal(res.status, 401);
});

test('login error does not reveal whether the account exists', async () => {
  const unknown = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'ghost@test.local', password: 'WhateverPass123!' }
  });
  const wrongPw = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'WhateverPass123!' }
  });
  assert.equal(unknown.status, 401);
  assert.equal(wrongPw.status, 401);
  assert.deepEqual(unknown.data, wrongPw.data);
});

test('register rejects an existing username with 409 (P0-2)', async () => {
  const res = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'admin_auth', email: 'different@test.local', password: 'AttackerPass123!' }
  });
  assert.equal(res.status, 409);
});

test('register rejects an existing email with 409 (P0-2)', async () => {
  const res = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'someone_else', email: 'admin_auth@test.local', password: 'AttackerPass123!' }
  });
  assert.equal(res.status, 409);
});

test('register with an existing username cannot reset that account password (P0-2)', async () => {
  await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'admin_auth', email: 'attacker2@test.local', password: 'AttackerPass123!' }
  });
  // The seeded/existing admin must keep working with its own password
  const ok = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'AdminPass123!' }
  });
  assert.equal(ok.status, 200);
  // The takeover password must not work for the admin account
  const takeover = await api(server.base, 'POST', '/api/auth/login', {
    body: { email: 'admin_auth@test.local', password: 'AttackerPass123!' }
  });
  assert.equal(takeover.status, 401);
});

test('registration enforces password policy and input validation', async () => {
  const short = await api(server.base, 'POST', '/api/auth/register', {
    body: { email: 'short@test.local', password: 'x' }
  });
  assert.equal(short.status, 400);
  const badEmail = await api(server.base, 'POST', '/api/auth/register', {
    body: { email: 'not-an-email', password: 'ValidPass123!' }
  });
  assert.equal(badEmail.status, 400);
  const good = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'valid_user-1', email: 'valid@test.local', password: 'ValidPass123!' }
  });
  assert.equal(good.status, 200);
});

test('registration response never contains password hashes', async () => {
  const res = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'nohash_user', email: 'nohash@test.local', password: 'ValidPass123!' }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.user.password_hash, undefined);
  assert.ok(!res.text.includes('$2a$'), 'response must not leak bcrypt hashes');
});
