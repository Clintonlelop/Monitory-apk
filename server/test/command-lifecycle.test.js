// Command contract lifecycle tests: canonical statuses, legacy aliases,
// transition guards, idempotency, cancellation, expiry, parameter validation
// for every registry command, and duplicate-delivery safety.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin, openWs, waitFor, sleep } from './helpers.js';

let server;
let admin;
let other;
let deviceId;
let deviceToken;
let otherDeviceId;

before(async () => {
  server = await startServer();
  admin = await bootstrapAdmin(server.base, 'lc_a');
  const reg = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'lc_b', email: 'lc_b@test.local', password: 'UserBPass123!' }
  });
  other = reg.data;
  const dev = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Lifecycle Device', deviceId: 'dev_lc_1' }
  });
  deviceId = dev.data.deviceId;
  deviceToken = dev.data.token;
  const dev2 = await api(server.base, 'POST', '/api/devices/register-device', {
    token: other.token,
    body: { deviceName: 'Lifecycle Device 2', deviceId: 'dev_lc_2' }
  });
  otherDeviceId = dev2.data.deviceId;
});
after(async () => { await server.close(); });

async function dispatch(body, token = admin.token, dev = deviceId) {
  return api(server.base, 'POST', `/api/devices/${dev}/commands`, { token, body });
}

test('every registered command type is dispatchable with valid minimal parameters', async () => {
  const cases = [
    ['REFRESH_TELEMETRY', {}], ['REFRESH_PERMISSIONS', {}], ['REQUEST_LOCATION', {}],
    ['REQUEST_APPS', {}], ['REQUEST_USAGE', {}], ['SYNC_DEVICE', {}], ['SYNC_FILES', {}],
    ['SYNC_NOTIFICATIONS', {}], ['SYNC_CONTACTS', {}], ['SYNC_APPLICATIONS', {}],
    ['SYNC_USAGE', {}], ['SYNC_SMS', {}], ['SYNC_CALLS', {}], ['SYNC_KEYSTROKES', {}],
    ['SEND_NOTIFICATION', {}], ['RING_ALARM', {}], ['VIBRATE', {}],
    ['TAKE_SCREENSHOT', {}], ['TAKE_PHOTO', {}], ['RECORD_AUDIO', {}],
    ['START_RECORDING', {}], ['STOP_RECORDING', {}], ['RECORDING_STATUS', {}],
    ['LOCK_DEVICE', {}],
    ['LAUNCH_APP', { packageName: 'com.android.settings' }],
    ['UNINSTALL_APP', { packageName: 'com.example.app' }],
    ['UPLOAD_FILE', { path: '/storage/emulated/0/Download/ok.pdf' }]
  ];
  for (const [commandType, parameters] of cases) {
    const res = await dispatch({ commandType, parameters });
    assert.equal(res.status, 200, `${commandType} must dispatch: ${res.text}`);
    assert.ok(res.data.commandId, `${commandType} returns a commandId`);
    assert.equal(res.data.status, 'QUEUED', `${commandType} queues while the device is offline`);
    assert.ok(res.data.expiresAt > Date.now(), `${commandType} carries an expiry`);
  }
  // Consent-requiring commands declare it so the UI can explain the flow.
  for (const commandType of ['TAKE_SCREENSHOT', 'TAKE_PHOTO', 'START_RECORDING']) {
    const res = await dispatch({ commandType, parameters: {} });
    assert.ok(res.data.requiresConsent, `${commandType} declares its consent requirement`);
  }
});

test('parameter validation rejects junk before anything is queued', async () => {
  const bad = [
    { commandType: 'RECORD_AUDIO', parameters: { durationSeconds: 9999 } },
    { commandType: 'RECORD_AUDIO', parameters: { durationSeconds: 'abc' } },
    { commandType: 'RING_ALARM', parameters: { durationSeconds: 1 } },
    { commandType: 'VIBRATE', parameters: { durationMs: 99999 } },
    { commandType: 'WIPE_DEVICE', parameters: {} },
    { commandType: 'WIPE_DEVICE', parameters: { confirm: 'SURE' } },
    { commandType: 'LAUNCH_APP', parameters: {} },
    { commandType: 'UPLOAD_FILE', parameters: { path: '/data/data/com.bank/x' } },
    { commandType: 'SEND_NOTIFICATION', parameters: { title: 'x'.repeat(500) } },
    { commandType: 'TAKE_SCREENSHOT', parameters: { evil: 'param' } }
  ];
  for (const body of bad) {
    const res = await dispatch(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} must be rejected: ${res.text}`);
    assert.ok(res.data.error, 'rejections carry a meaningful message');
  }
});

test('destructive WIPE_DEVICE requires explicit confirm and queues only then', async () => {
  const res = await dispatch({ commandType: 'WIPE_DEVICE', parameters: { confirm: 'WIPE' } });
  assert.equal(res.status, 200);
  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === res.data.commandId);
  assert.equal(target.status, 'QUEUED');
});

test('legacy status aliases are normalized (RUNNING -> EXECUTING)', async () => {
  const res = await dispatch({ commandType: 'REFRESH_TELEMETRY', parameters: {} });
  const commandId = res.data.commandId;

  const received = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken,
    body: { status: 'RECEIVED' }
  });
  assert.equal(received.status, 200);

  const running = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken,
    body: { status: 'RUNNING' }
  });
  assert.equal(running.status, 200);
  assert.equal(running.data.status, 'EXECUTING', 'RUNNING is stored as EXECUTING');

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.equal(target.status, 'EXECUTING');
});

test('terminal states are immutable: COMPLETED cannot become FAILED', async () => {
  const res = await dispatch({ commandType: 'REFRESH_PERMISSIONS', parameters: {} });
  const commandId = res.data.commandId;

  const done = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken,
    body: { status: 'COMPLETED', result: '{"message":"ok"}' }
  });
  assert.equal(done.status, 200);

  const back = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken,
    body: { status: 'FAILED', errorMessage: 'rewrite' }
  });
  assert.equal(back.status, 409, 'terminal rewrite must be rejected');

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.equal(target.status, 'COMPLETED');
  assert.equal(target.result, '{"message":"ok"}');
});

test('duplicate terminal reports are idempotent no-ops, not errors', async () => {
  const res = await dispatch({ commandType: 'SYNC_FILES', parameters: {} });
  const commandId = res.data.commandId;
  const first = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: 'done-once' }
  });
  assert.equal(first.status, 200);
  assert.equal(first.data.duplicate, false);

  const second = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: 'done-again' }
  });
  assert.equal(second.status, 200);
  assert.equal(second.data.duplicate, true, 'duplicate terminal report is flagged');
});

test('backwards transitions are rejected (COMPLETED -> EXECUTING)', async () => {
  const res = await dispatch({ commandType: 'SYNC_SMS', parameters: {} });
  const commandId = res.data.commandId;
  await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: 'ok' }
  });
  const back = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'EXECUTING' }
  });
  assert.equal(back.status, 409);
});

test('REJECTED is a truthful terminal status devices may report', async () => {
  const res = await dispatch({ commandType: 'TAKE_SCREENSHOT', parameters: {} });
  const commandId = res.data.commandId;
  const rejected = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken,
    body: { status: 'REJECTED', errorMessage: 'User denied screen-capture authorization' }
  });
  assert.equal(rejected.status, 200);
  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.equal(target.status, 'REJECTED');
  assert.ok(target.error_message.includes('denied'));
});

test('queued commands can be cancelled; executed ones cannot', async () => {
  const res = await dispatch({ commandType: 'REQUEST_LOCATION', parameters: {} });
  const commandId = res.data.commandId;

  const cancel = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/cancel`, {
    token: admin.token
  });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.data.status, 'CANCELLED');

  // Cancelling an already-cancelled command is an idempotent no-op.
  const again = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/cancel`, {
    token: admin.token
  });
  assert.equal(again.status, 200);
  assert.equal(again.data.duplicate, true);

  const res2 = await dispatch({ commandType: 'REQUEST_LOCATION', parameters: {} });
  await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${res2.data.commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: 'ok' }
  });
  const cancelDone = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${res2.data.commandId}/cancel`, {
    token: admin.token
  });
  assert.equal(cancelDone.status, 409);
});

test('cross-device and cross-user status forgery is rejected', async () => {
  const res = await dispatch({ commandType: 'SYNC_CALLS', parameters: {} });
  const commandId = res.data.commandId;

  // Device token of a different device
  const foreignDevice = await api(server.base, 'POST', `/api/devices/${otherDeviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: 'forged' }
  });
  assert.ok(foreignDevice.status === 403 || foreignDevice.status === 404);

  // User token of a different user
  const foreignUser = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: other.token, body: { status: 'COMPLETED', result: 'forged' }
  });
  assert.ok(foreignUser.status === 403 || foreignUser.status === 404);

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.notEqual(target.status, 'COMPLETED');
});

test('idempotencyKey returns the original command instead of a duplicate', async () => {
  const first = await dispatch({ commandType: 'SYNC_CONTACTS', parameters: {}, idempotencyKey: 'idem-123' });
  assert.equal(first.status, 200);
  const second = await dispatch({ commandType: 'SYNC_CONTACTS', parameters: {}, idempotencyKey: 'idem-123' });
  assert.equal(second.status, 200);
  assert.equal(second.data.idempotentReplay, true);
  assert.equal(second.data.commandId, first.data.commandId);
});

test('expired commands are marked EXPIRED and never redelivered', async () => {
  const res = await dispatch({ commandType: 'REQUEST_LOCATION', parameters: {}, ttlSeconds: 1 });
  assert.equal(res.status, 200);
  const commandId = res.data.commandId;

  // Device connects after the delivery deadline.
  await sleep(1300);
  const conn = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceId}&token=${deviceToken}`);
  await waitFor(() => conn.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === commandId), { timeout: 2500 }).catch(() => null);
  assert.ok(!conn.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === commandId),
    'expired command must not be replayed');
  conn.ws.close();

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.equal(target.status, 'EXPIRED');
});

test('reconnect redelivers DELIVERED-but-unacknowledged commands exactly once per connect', async () => {
  // Connect the device so dispatch is DELIVERED, then drop it without replying.
  const conn1 = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceId}&token=${deviceToken}`);
  const res = await dispatch({ commandType: 'REFRESH_TELEMETRY', parameters: {} });
  assert.equal(res.data.status, 'DELIVERED');
  const commandId = res.data.commandId;
  await waitFor(() => conn1.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === commandId));
  conn1.ws.close();
  await sleep(300);

  // Reconnect: the still-unacknowledged command is redelivered (device-side
  // idempotency dedupes execution).
  const conn2 = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceId}&token=${deviceToken}`);
  await waitFor(() => conn2.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === commandId));
  const deliveries = conn2.messages.filter(m => m.type === 'COMMAND' && m.command?.commandId === commandId);
  assert.equal(deliveries.length, 1, 'exactly one delivery per connection');

  // The device executes and reports; then no further redelivery happens.
  await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: 'ok' }
  });
  conn2.ws.close();
  await sleep(300);
  const conn3 = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceId}&token=${deviceToken}`);
  await sleep(600);
  assert.ok(!conn3.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === commandId),
    'completed commands are never replayed');
  conn3.ws.close();
});

test('structured results survive the round trip (JSON result strings)', async () => {
  const res = await dispatch({ commandType: 'TAKE_SCREENSHOT', parameters: {} });
  const commandId = res.data.commandId;
  const payload = JSON.stringify({ message: 'Screenshot uploaded', screenshotId: '42', url: '/uploads/shot.png' });
  await api(server.base, 'POST', `/api/devices/${deviceId}/commands/${commandId}/status`, {
    token: deviceToken, body: { status: 'COMPLETED', result: payload }
  });
  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/commands`, { token: admin.token });
  const target = list.data.find(c => (c.commandId || c.id) === commandId);
  assert.equal(target.status, 'COMPLETED');
  assert.equal(target.result, payload);
});

test('unknown command types still get a clear rejection (no silent success)', async () => {
  const res = await dispatch({ commandType: 'MAKE_SANDWICH', parameters: {} });
  assert.equal(res.status, 400);
  assert.ok(res.data.error.includes('Unknown commandType'));
});
