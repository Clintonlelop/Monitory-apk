// Phase 1/3 regression tests: WebSocket authentication, message authorization,
// offline command replay, forged status rejection, tenant-scoped events (P0-4).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin, openWs, waitFor, sleep } from './helpers.js';

let server;
let adminA;
let userB;
let deviceA;
let deviceB;
let tokenA;
let tokenB;

before(async () => {
  server = await startServer();
  adminA = await bootstrapAdmin(server.base, 'ws_a');
  const reg = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'ws_b', email: 'ws_b@test.local', password: 'UserBPass123!' }
  });
  userB = reg.data;

  const devA = await api(server.base, 'POST', '/api/devices/register-device', {
    token: adminA.token,
    body: { deviceName: 'WS Device A', deviceId: 'dev_ws_a' }
  });
  deviceA = devA.data.deviceId;
  tokenA = devA.data.token;

  const devB = await api(server.base, 'POST', '/api/devices/register-device', {
    token: userB.token,
    body: { deviceName: 'WS Device B', deviceId: 'dev_ws_b' }
  });
  deviceB = devB.data.deviceId;
  tokenB = devB.data.token;
});
after(async () => { await server.close(); });

test('anonymous WebSocket connections are rejected (P0-4)', async () => {
  await assert.rejects(
    () => openWs(`${server.wsBase}/ws/device?deviceId=${deviceA}`),
    /401|rejected|timeout/i
  );
  await assert.rejects(
    () => openWs(`${server.wsBase}/ws/dashboard`),
    /401|rejected|timeout/i
  );
});

test('garbage tokens are rejected', async () => {
  await assert.rejects(
    () => openWs(`${server.wsBase}/ws/device?deviceId=${deviceA}&token=not-a-jwt`),
    /401|rejected|timeout/i
  );
});

test('device token cannot impersonate another device (P0-4)', async () => {
  // Valid device-A token but claiming deviceId B → handshake rejected
  await assert.rejects(
    () => openWs(`${server.wsBase}/ws/device?deviceId=${deviceB}&token=${tokenA}`),
    /403|401|rejected|timeout/i
  );
});

test('user token is rejected on the device endpoint and vice versa', async () => {
  await assert.rejects(
    () => openWs(`${server.wsBase}/ws/device?deviceId=${deviceA}&token=${adminA.token}`),
    /403|401|rejected|timeout/i
  );
  await assert.rejects(
    () => openWs(`${server.wsBase}/ws/dashboard?token=${tokenA}`),
    /403|401|rejected|timeout/i
  );
});

test('commands queued while offline are delivered on reconnect (P1-3)', async () => {
  // Device is offline: command must be persisted and honestly reported as queued
  const cmd = await api(server.base, 'POST', `/api/devices/${deviceA}/commands`, {
    token: adminA.token,
    body: { commandType: 'REFRESH_TELEMETRY', parameters: {} }
  });
  assert.equal(cmd.status, 200);
  assert.equal(cmd.data.dispatchedToOnlineDevice, false);
  assert.equal(cmd.data.queued, true);

  // Connect the device with its own token
  const deviceConn = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceA}&token=${tokenA}`);
  // The queued command must arrive
  await waitFor(() => deviceConn.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === cmd.data.commandId));
  const received = deviceConn.messages.find(m => m.type === 'COMMAND' && m.command?.commandId === cmd.data.commandId);
  assert.equal(received.command.commandType, 'REFRESH_TELEMETRY');
  deviceConn.ws.close();
  await sleep(100);
});

test('authenticated device status updates reach only its owner\'s dashboard', async () => {
  const dashA = await openWs(`${server.wsBase}/ws/dashboard?token=${adminA.token}`);
  const dashB = await openWs(`${server.wsBase}/ws/dashboard?token=${userB.token}`);

  const deviceConn = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceA}&token=${tokenA}`);
  deviceConn.ws.send(JSON.stringify({
    type: 'COMMAND_STATUS',
    commandId: 'cmd_nonexistent',
    status: 'COMPLETED',
    result: 'ok'
  }));
  // Also send a valid ACCESSIBILITY_EVENT (device-sourced, must be scoped)
  deviceConn.ws.send(JSON.stringify({
    type: 'ACCESSIBILITY_EVENT',
    packageName: 'com.synthetic.app',
    className: 'MainActivity',
    text: 'synthetic text',
    timestamp: Date.now()
  }));

  await waitFor(() => dashA.messages.some(m => m.type === 'ACCESSIBILITY_EVENT' && m.deviceId === deviceA));
  await sleep(300);

  assert.ok(!dashB.messages.some(m => m.deviceId === deviceA),
    'tenant B\'s dashboard must never receive tenant A\'s device events');

  deviceConn.ws.close();
  dashA.ws.close();
  dashB.ws.close();
  await sleep(100);
});

test('forged COMMAND_STATUS for another device\'s command is rejected (P0-4)', async () => {
  // Create a command for device A while... use admin to create one
  const cmd = await api(server.base, 'POST', `/api/devices/${deviceA}/commands`, {
    token: adminA.token,
    body: { commandType: 'SYNC_FILES', parameters: {} }
  });

  // Device B (authenticated as itself) tries to complete device A's command
  const deviceConnB = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceB}&token=${tokenB}`);
  deviceConnB.ws.send(JSON.stringify({
    type: 'COMMAND_STATUS',
    commandId: cmd.data.commandId,
    status: 'COMPLETED',
    result: 'forged'
  }));
  await sleep(300);

  const cmds = await api(server.base, 'GET', `/api/devices/${deviceA}/commands`, { token: adminA.token });
  const target = cmds.data.find(c => (c.commandId || c.id) === cmd.data.commandId);
  assert.ok(target);
  assert.notEqual(target.status, 'COMPLETED', 'forged completion must not be accepted');
  assert.notEqual(target.result, 'forged');
  deviceConnB.ws.close();
  await sleep(100);
});

test('valid COMMAND_STATUS from the owning device is accepted and broadcast', async () => {
  const cmd = await api(server.base, 'POST', `/api/devices/${deviceA}/commands`, {
    token: adminA.token,
    body: { commandType: 'SYNC_FILES', parameters: {} }
  });

  const dashA = await openWs(`${server.wsBase}/ws/dashboard?token=${adminA.token}`);
  const deviceConn = await openWs(`${server.wsBase}/ws/device?deviceId=${deviceA}&token=${tokenA}`);
  await waitFor(() => deviceConn.messages.some(m => m.type === 'COMMAND' && m.command?.commandId === cmd.data.commandId));

  deviceConn.ws.send(JSON.stringify({
    type: 'COMMAND_STATUS',
    commandId: cmd.data.commandId,
    status: 'COMPLETED',
    result: 'synthetic-ok'
  }));

  await waitFor(() => dashA.messages.some(m => m.type === 'COMMAND_STATUS_UPDATED' && m.commandId === cmd.data.commandId && m.status === 'COMPLETED'));

  const cmds = await api(server.base, 'GET', `/api/devices/${deviceA}/commands`, { token: adminA.token });
  const target = cmds.data.find(c => (c.commandId || c.id) === cmd.data.commandId);
  assert.equal(target.status, 'COMPLETED');

  deviceConn.ws.close();
  dashA.ws.close();
  await sleep(100);
});

test('dashboard sockets only answer PING and ignore injected commands', async () => {
  const dashA = await openWs(`${server.wsBase}/ws/dashboard?token=${adminA.token}`);
  dashA.ws.send(JSON.stringify({ type: 'PING' }));
  await waitFor(() => dashA.messages.some(m => m.type === 'PONG'));
  // Attempted command injection over dashboard WS must do nothing
  dashA.ws.send(JSON.stringify({ type: 'COMMAND', command: { commandId: 'x', deviceId: deviceA, commandType: 'EVIL' } }));
  await sleep(200);
  const cmds = await api(server.base, 'GET', `/api/devices/${deviceA}/commands`, { token: adminA.token });
  assert.ok(!cmds.data.some(c => (c.commandId || c.id) === 'x'));
  dashA.ws.close();
  await sleep(100);
});
