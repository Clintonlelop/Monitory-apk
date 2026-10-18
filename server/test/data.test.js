// Phase 2/3 regression tests: data integrity, pairing lifecycle, honest
// device state, protocol-correct URL generation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin, sleep } from './helpers.js';

let server;
let admin;
let deviceId;

before(async () => {
  // 2-second pairing TTL so expiry can be tested quickly.
  server = await startServer({ PAIRING_TTL_SECONDS: '2' });
  admin = await bootstrapAdmin(server.base, 'data_a');
  const dev = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Data Device', deviceId: 'dev_data_1' }
  });
  deviceId = dev.data.deviceId;
});
after(async () => { await server.close(); });

test('battery level 0 is stored as 0, not 100 (P2-5)', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/telemetry`, {
    token: admin.token,
    body: { batteryLevel: 0, isCharging: false, deviceName: 'Data Device', networkType: 'WIFI' }
  });
  assert.equal(res.status, 200);
  const detail = await api(server.base, 'GET', `/api/devices/${deviceId}`, { token: admin.token });
  assert.equal(detail.data.battery_level, 0);
});

test('telemetry uses consistent device_name naming (F-25)', async () => {
  await api(server.base, 'POST', `/api/devices/${deviceId}/telemetry`, {
    token: admin.token,
    body: { batteryLevel: 55, deviceName: 'Renamed Device' }
  });
  const list = await api(server.base, 'GET', '/api/devices', { token: admin.token });
  const dev = list.data.find(d => d.id === deviceId);
  assert.equal(dev.device_name, 'Renamed Device');
  assert.equal(dev.deviceName, undefined);
});

test('usage statistics do not clobber other devices (P2-7)', async () => {
  const dev2 = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Data Device 2', deviceId: 'dev_data_2' }
  });
  await api(server.base, 'POST', `/api/devices/${deviceId}/usage`, {
    token: admin.token,
    body: [{ packageName: 'com.a', appName: 'App A', totalTimeInForegroundMs: 1000, lastTimeUsed: 1 }]
  });
  await api(server.base, 'POST', `/api/devices/${dev2.data.deviceId}/usage`, {
    token: admin.token,
    body: [{ packageName: 'com.b', appName: 'App B', totalTimeInForegroundMs: 2000, lastTimeUsed: 2 }]
  });
  const usage1 = await api(server.base, 'GET', `/api/devices/${deviceId}/usage`, { token: admin.token });
  assert.ok(usage1.data.some(u => u.package_name === 'com.a'), 'device 1 usage must survive device 2 update');
  assert.ok(!usage1.data.some(u => u.package_name === 'com.b'));
});

test('alerts can be created and persist in the store (P1-4)', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/alerts`, {
    token: admin.token,
    body: { alertType: 'LOW_BATTERY', severity: 'WARNING', title: 'Battery low', message: 'Synthetic alert' }
  });
  assert.equal(res.status, 200);
  const alerts = await api(server.base, 'GET', '/api/alerts', { token: admin.token });
  assert.ok(alerts.data.some(a => a.title === 'Battery low' && a.alert_type === 'LOW_BATTERY'));
});

test('service health is persisted and reports truthful connection state (P2-4/F-15)', async () => {
  const post = await api(server.base, 'POST', `/api/devices/${deviceId}/service-health`, {
    token: admin.token,
    body: { notificationMonitor: 'RUNNING', locationService: 'STOPPED', telemetryCollector: 'RUNNING' }
  });
  assert.equal(post.status, 200);

  const get = await api(server.base, 'GET', `/api/devices/${deviceId}/service-health`, { token: admin.token });
  assert.equal(get.data.notificationMonitor, 'RUNNING');
  assert.equal(get.data.locationService, 'STOPPED');
  assert.equal(get.data.deviceConnected, false, 'device is offline — must not claim connected');

  // Legacy dashboard path also works now (F-15)
  const alias = await api(server.base, 'GET', `/api/devices/${deviceId}/health`, { token: admin.token });
  assert.equal(alias.status, 200);
  assert.equal(alias.data.notificationMonitor, 'RUNNING');
});

test('register-device creates an ENROLLED device with empty telemetry (F-19)', async () => {
  const res = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Fresh Enroll', deviceId: 'dev_data_fresh' }
  });
  assert.equal(res.status, 200);
  const detail = await api(server.base, 'GET', `/api/devices/${res.data.deviceId}`, { token: admin.token });
  assert.equal(detail.data.status, 'ENROLLED');
  assert.equal(detail.data.battery_level, null);
  assert.equal(detail.data.wifi_ssid, null);
  for (const v of Object.values(detail.data.permissions || {})) {
    assert.equal(v, false, 'permissions must not be fabricated as granted');
  }
});

test('pairing codes expire and cannot be reused (§13 pairing)', async () => {
  const gen = await api(server.base, 'POST', '/api/pairing/generate', {
    token: admin.token,
    body: { environment: 'Test' }
  });
  assert.equal(gen.status, 200);
  const { code, payload } = gen.data;

  // QR payload carries BOTH key styles (Android reads serverUrl/wsUrl)
  assert.equal(payload.serverUrl, payload.server);
  assert.equal(payload.wsUrl, payload.ws);
  assert.ok(payload.code === code);

  // Wait past the 2s TTL
  await sleep(2300);
  const expired = await api(server.base, 'POST', '/api/pairing/redeem', {
    body: { pairingCode: code, deviceName: 'Expired Device' }
  });
  assert.equal(expired.status, 400);
  assert.ok(expired.data.message.toLowerCase().includes('expired') || expired.data.message.toLowerCase().includes('invalid'));
});

test('pairing codes are one-time only', async () => {
  const gen = await api(server.base, 'POST', '/api/pairing/generate', { token: admin.token, body: {} });
  const { code } = gen.data;
  const first = await api(server.base, 'POST', '/api/pairing/redeem', {
    body: { pairingCode: code, deviceName: 'Once Device', model: 'T1' }
  });
  assert.equal(first.status, 200);
  assert.ok(first.data.token, 'redeem returns a device token');
  assert.equal(first.data.deviceId.length > 0, true);

  const second = await api(server.base, 'POST', '/api/pairing/redeem', {
    body: { pairingCode: code, deviceName: 'Twice Device' }
  });
  assert.equal(second.status, 400);
});

test('claim enforces code ownership and creates honest device state (P2-3)', async () => {
  // Code generated by admin
  const gen = await api(server.base, 'POST', '/api/pairing/generate', { token: admin.token, body: {} });
  const { code } = gen.data;

  const claim = await api(server.base, 'POST', '/api/pairing/claim', {
    token: admin.token,
    body: { code, deviceName: 'Claimed Node' }
  });
  assert.equal(claim.status, 200);
  const detail = await api(server.base, 'GET', `/api/devices/${claim.data.deviceId}`, { token: admin.token });
  assert.equal(detail.data.status, 'ENROLLED');
  assert.equal(detail.data.battery_level, null, 'claim must not fabricate battery');
  assert.equal(detail.data.wifi_ssid, null, 'claim must not fabricate SSID');

  // Reuse after claim fails
  const again = await api(server.base, 'POST', '/api/pairing/claim', {
    token: admin.token,
    body: { code, deviceName: 'Claimed Again' }
  });
  assert.equal(again.status, 400);
});

test('config URLs follow the actual request protocol (P2-1)', async () => {
  // Plain-HTTP request must yield http/ws URLs, not forced https/wss
  const res = await api(server.base, 'GET', '/api/server/config');
  assert.ok(res.data.serverUrl.startsWith('http://'), `got ${res.data.serverUrl}`);
  assert.ok(res.data.wsUrl.startsWith('ws://'), `got ${res.data.wsUrl}`);

  // Simulated TLS termination via x-forwarded-proto must yield https/wss
  const proxied = await api(server.base, 'GET', '/api/server/config', {
    headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'fleet.example.com' }
  });
  assert.equal(proxied.data.serverUrl, 'https://fleet.example.com');
  assert.equal(proxied.data.wsUrl, 'wss://fleet.example.com/ws/device');
});

test('server config does not leak secrets', async () => {
  const res = await api(server.base, 'GET', '/api/server/config');
  assert.ok(!res.text.includes('JWT_SECRET'));
  assert.ok(!res.text.includes('unit-test-secret'));
});

test('unknown API routes return JSON 404 and errors are JSON', async () => {
  const res = await api(server.base, 'GET', '/api/not-a-real-route');
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'Not found');
});

test('security headers are present', async () => {
  const res = await api(server.base, 'GET', '/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok(res.headers.get('content-security-policy'));
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('auth endpoints are rate limited', async () => {
  let saw429 = false;
  for (let i = 0; i < 60; i++) {
    const res = await api(server.base, 'POST', '/api/auth/login', {
      body: { email: `ratelimit_${i}@test.local`, password: 'WhateverPass123!' }
    });
    if (res.status === 429) { saw429 = true; break; }
  }
  assert.ok(saw429, 'burst login attempts must eventually be limited');
});
