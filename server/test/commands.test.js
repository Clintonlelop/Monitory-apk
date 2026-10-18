// Phase 2/3 regression tests: command allowlist, authorization, status flow.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin } from './helpers.js';

let server;
let admin;
let other;
let deviceId;
let otherDeviceId;

before(async () => {
  server = await startServer();
  admin = await bootstrapAdmin(server.base, 'cmd_a');
  const reg = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'cmd_b', email: 'cmd_b@test.local', password: 'UserBPass123!' }
  });
  other = reg.data;
  const dev = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Cmd Device', deviceId: 'dev_cmd_1' }
  });
  deviceId = dev.data.deviceId;
  const dev2 = await api(server.base, 'POST', '/api/devices/register-device', {
    token: other.token,
    body: { deviceName: 'Cmd Device 2', deviceId: 'dev_cmd_2' }
  });
  otherDeviceId = dev2.data.deviceId;
});
after(async () => { await server.close(); });

test('unknown command types are rejected (P2-8 allowlist)', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/commands`, {
    token: admin.token,
    body: { commandType: 'UNRECOGNIZED_AUDIT_COMMAND', parameters: {} }
  });
  assert.equal(res.status, 400);
  assert.ok(res.data.error.includes('Unknown commandType'));
});

test('command dispatch requires ownership', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${otherDeviceId}/commands`, {
    token: admin.token,
    body: { commandType: 'SYNC_FILES', parameters: {} }
  });
  assert.equal(res.status, 404);
});

test('UPLOAD_FILE rejects arbitrary paths (P1-8)', async () => {
  for (const p of ['/data/data/com.bank/shared_prefs/secrets.xml', '../../etc/passwd', '/storage/emulated/0/../../data/x']) {
    const res = await api(server.base, 'POST', `/api/devices/${deviceId}/commands`, {
      token: admin.token,
      body: { commandType: 'UPLOAD_FILE', parameters: { path: p } }
    });
    assert.equal(res.status, 400, `path must be rejected: ${p}`);
  }
  const ok = await api(server.base, 'POST', `/api/devices/${deviceId}/commands`, {
    token: admin.token,
    body: { commandType: 'UPLOAD_FILE', parameters: { path: '/storage/emulated/0/Download/report.pdf' } }
  });
  assert.equal(ok.status, 200);
});

test('offline dispatch is honestly reported as queued, not executed', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/commands`, {
    token: admin.token,
    body: { commandType: 'REQUEST_LOCATION', parameters: {} }
  });
  assert.equal(res.status, 200);
  assert.equal(res.data.dispatchedToOnlineDevice, false);
  // Canonical lifecycle: offline commands are QUEUED (legacy name: PENDING).
  assert.equal(res.data.status, 'QUEUED');
  assert.equal(res.data.queued, true);
  assert.ok(res.data.expiresAt > Date.now(), 'queued commands carry a delivery deadline');
});

test('command status transitions accept known states and reject junk', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/commands`, {
    token: admin.token,
    body: { commandType: 'SYNC_CONTACTS', parameters: {} }
  });
  const commandId = res.data.commandId;

  const junk = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: admin.token,
    body: { status: 'WEIRD_STATE' }
  });
  assert.equal(junk.status, 400);

  const ok = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: admin.token,
    body: { status: 'COMPLETED', result: 'done' }
  });
  assert.equal(ok.status, 200);

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.equal(target.status, 'COMPLETED');
});

test('foreign users cannot update command status (forgery prevention)', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/commands`, {
    token: admin.token,
    body: { commandType: 'REFRESH_PERMISSIONS', parameters: {} }
  });
  const commandId = res.data.commandId;
  const foreign = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: other.token,
    body: { status: 'FAILED', errorMessage: 'takeover' }
  });
  assert.ok(foreign.status === 403 || foreign.status === 404, `got ${foreign.status}`);

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.notEqual(target.status, 'FAILED');
});
