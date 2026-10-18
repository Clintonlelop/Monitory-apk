// Phase 1 regression tests: authorization boundaries (P0-3, P0-5, P0-4 partial).
// Two independent synthetic users, one device each.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin } from './helpers.js';

let server;
let adminA;
let userB;
let deviceA; // owned by A
let deviceB; // owned by B
let deviceTokenA;
let deviceTokenB;

before(async () => {
  server = await startServer();
  adminA = await bootstrapAdmin(server.base, 'owner_a');

  // Second user registers normally
  const reg = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'owner_b', email: 'owner_b@test.local', password: 'UserBPass123!' }
  });
  assert.equal(reg.status, 200);
  userB = reg.data;

  const devA = await api(server.base, 'POST', '/api/devices/register-device', {
    token: adminA.token,
    body: { deviceName: 'Synthetic A', manufacturer: 'Test', model: 'A1', deviceId: 'dev_test_a' }
  });
  assert.equal(devA.status, 200);
  deviceA = devA.data.deviceId;
  deviceTokenA = devA.data.token;

  const devB = await api(server.base, 'POST', '/api/devices/register-device', {
    token: userB.token,
    body: { deviceName: 'Synthetic B', manufacturer: 'Test', model: 'B1', deviceId: 'dev_test_b' }
  });
  assert.equal(devB.status, 200);
  deviceB = devB.data.deviceId;
  deviceTokenB = devB.data.token;
});
after(async () => { await server.close(); });

test('user A sees only their own devices (tenant isolation)', async () => {
  const res = await api(server.base, 'GET', '/api/devices', { token: adminA.token });
  assert.equal(res.status, 200);
  const ids = res.data.map(d => d.id);
  assert.ok(ids.includes(deviceA));
  assert.ok(!ids.includes(deviceB), 'must not see another user\'s device');
});

test('user A cannot read user B\'s device detail (404)', async () => {
  const res = await api(server.base, 'GET', `/api/devices/${deviceB}`, { token: adminA.token });
  assert.equal(res.status, 404);
});

test('user A cannot delete user B\'s device', async () => {
  const res = await api(server.base, 'DELETE', `/api/devices/${deviceB}`, { token: adminA.token });
  assert.equal(res.status, 404);
  // Still present for B
  const check = await api(server.base, 'GET', `/api/devices/${deviceB}`, { token: userB.token });
  assert.equal(check.status, 200);
});

test('user A cannot read user B\'s SMS/notifications/locations/commands', async () => {
  for (const route of ['sms', 'notifications', 'locations', 'commands', 'files', 'calls', 'contacts', 'keystrokes', 'recordings', 'service-health', 'usage', 'apps']) {
    const res = await api(server.base, 'GET', `/api/devices/${deviceB}/${route}`, { token: adminA.token });
    assert.equal(res.status, 404, `route ${route} must be tenant-scoped`);
  }
});

test('user A cannot post data into user B\'s device (404)', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceB}/telemetry`, {
    token: adminA.token,
    body: { batteryLevel: 50 }
  });
  assert.equal(res.status, 404);
});

test('device token is NOT accepted as an admin token (P0-3)', async () => {
  const devices = await api(server.base, 'GET', '/api/devices', { token: deviceTokenA });
  assert.equal(devices.status, 403);
  const me = await api(server.base, 'GET', '/api/auth/me', { token: deviceTokenA });
  assert.notEqual(me.status, 200);
  const audit = await api(server.base, 'GET', '/api/audit', { token: deviceTokenA });
  assert.equal(audit.status, 403);
});

test('device token can only ingest data for its own device (P0-3/P0-5)', async () => {
  const own = await api(server.base, 'POST', `/api/devices/${deviceA}/telemetry`, {
    token: deviceTokenA,
    body: { batteryLevel: 42, deviceName: 'Synthetic A' }
  });
  assert.equal(own.status, 200);

  const foreign = await api(server.base, 'POST', `/api/devices/${deviceB}/telemetry`, {
    token: deviceTokenA,
    body: { batteryLevel: 42 }
  });
  assert.equal(foreign.status, 403);
});

test('device responses never contain auth_token (P0-4 leak)', async () => {
  const list = await api(server.base, 'GET', '/api/devices', { token: adminA.token });
  for (const d of list.data) {
    assert.equal(d.auth_token, undefined, 'device list must not include auth_token');
  }
  const detail = await api(server.base, 'GET', `/api/devices/${deviceA}`, { token: adminA.token });
  assert.equal(detail.data.auth_token, undefined, 'device detail must not include auth_token');
  assert.ok(!detail.text.includes(deviceTokenA.slice(20, 40)), 'token material must not appear in payload');
});

test('unauthenticated requests to device data are rejected', async () => {
  for (const [method, route] of [
    ['GET', '/api/devices'],
    ['GET', `/api/devices/${deviceA}`],
    ['GET', `/api/devices/${deviceA}/sms`],
    ['POST', `/api/devices/${deviceA}/telemetry`],
    ['POST', `/api/devices/${deviceA}/commands`],
    ['GET', '/api/audit'],
    ['GET', '/api/alerts']
  ]) {
    const res = await api(server.base, method, route, { body: method === 'POST' ? {} : undefined });
    assert.ok(res.status === 401, `${method} ${route} must require auth (got ${res.status})`);
  }
});

test('register-device refuses to hijack another account\'s device id', async () => {
  const res = await api(server.base, 'POST', '/api/devices/register-device', {
    token: userB.token,
    body: { deviceName: 'Hijack Attempt', deviceId: deviceA }
  });
  assert.equal(res.status, 409);
});

test('alerts and audit are scoped per user', async () => {
  // A creates an alert on their device via device token
  await api(server.base, 'POST', `/api/devices/${deviceA}/alerts`, {
    token: deviceTokenA,
    body: { alertType: 'TEST_ALERT', title: 'A alert', message: 'synthetic' }
  });
  const alertsA = await api(server.base, 'GET', '/api/alerts', { token: adminA.token });
  assert.equal(alertsA.status, 200);
  assert.ok(alertsA.data.some(a => a.device_id === deviceA));
  assert.ok(!alertsA.data.some(a => a.device_id === deviceB), 'must not see other tenants\' alerts');

  const auditA = await api(server.base, 'GET', '/api/audit', { token: adminA.token });
  assert.ok(auditA.data.every(l => String(l.user_id) === String(adminA.user.id)), 'audit must be scoped to the user');
});
