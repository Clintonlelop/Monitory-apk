// Media pipeline tests: screenshot/screen-recording uploads, authenticated
// retrieval, cross-tenant isolation, content-type and size validation.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin } from './helpers.js';

let server;
let admin;
let other;
let deviceId;
let deviceToken;
let otherDeviceId;
let otherDeviceToken;

before(async () => {
  server = await startServer();
  admin = await bootstrapAdmin(server.base, 'media_a');
  const reg = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'media_b', email: 'media_b@test.local', password: 'UserBPass123!' }
  });
  other = reg.data;
  const dev = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Media Device', deviceId: 'dev_media_1' }
  });
  deviceId = dev.data.deviceId;
  deviceToken = dev.data.token;
  const dev2 = await api(server.base, 'POST', '/api/devices/register-device', {
    token: other.token,
    body: { deviceName: 'Media Device 2', deviceId: 'dev_media_2' }
  });
  otherDeviceId = dev2.data.deviceId;
  otherDeviceToken = dev2.data.token;
});
after(async () => { await server.close(); });

function pngForm(fields = {}) {
  // 1x1 transparent PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'shot.png');
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fd;
}

function videoForm(fields = {}) {
  // Minimal fake mp4-ish bytes (validated by MIME, not parsed by the server).
  const bytes = Buffer.alloc(2048, 1);
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'video/mp4' }), 'clip.mp4');
  for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
  return fd;
}

test('device uploads a screenshot; owner lists and downloads it; strangers cannot', async () => {
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/screenshots`, {
    token: deviceToken,
    formData: pngForm({ kind: 'screenshot', width: 1080, height: 1920 })
  });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.data.success, true);
  assert.equal(up.data.screenshot.kind, 'screenshot');
  assert.ok(up.data.screenshot.file_path.startsWith('/uploads/'));

  const list = await api(server.base, 'GET', `/api/devices/${deviceId}/screenshots`, { token: admin.token });
  assert.equal(list.status, 200);
  assert.ok(list.data.some(s => s.file_path === up.data.screenshot.file_path));

  // Authenticated download works for the owner.
  const dl = await fetch(`${server.base}${up.data.screenshot.file_path}`, {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  assert.equal(dl.status, 200);

  // Anonymous download is refused (no public screenshot URLs).
  const anon = await fetch(`${server.base}${up.data.screenshot.file_path}`);
  assert.equal(anon.status, 401);

  // A different user cannot read another tenant's media.
  const stranger = await fetch(`${server.base}${up.data.screenshot.file_path}`, {
    headers: { Authorization: `Bearer ${other.token}` }
  });
  assert.equal(stranger.status, 403);

  const strangerList = await api(server.base, 'GET', `/api/devices/${deviceId}/screenshots`, { token: other.token });
  assert.ok(strangerList.status === 403 || strangerList.status === 404);
});

test('camera photos are recorded with kind=camera', async () => {
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/screenshots`, {
    token: deviceToken,
    formData: pngForm({ kind: 'camera' })
  });
  assert.equal(up.status, 200);
  assert.equal(up.data.screenshot.kind, 'camera');
});

test('screenshot uploads reject non-image content', async () => {
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('<html>hi</html>')], { type: 'text/html' }), 'evil.html');
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/screenshots`, {
    token: deviceToken,
    formData: fd
  });
  assert.equal(up.status, 400);
  assert.ok(up.data.error);
});

test('screenshot uploads enforce a size limit', async () => {
  const big = Buffer.alloc(13 * 1024 * 1024, 7);
  const fd = new FormData();
  fd.append('file', new Blob([big], { type: 'image/png' }), 'big.png');
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/screenshots`, {
    token: deviceToken,
    formData: fd
  });
  assert.equal(up.status, 413);
});

test('unauthenticated and wrong-device uploads are rejected', async () => {
  const anon = await api(server.base, 'POST', `/api/devices/${deviceId}/screenshots`, {
    formData: pngForm()
  });
  assert.ok(anon.status === 401 || anon.status === 403);

  // A device token may only upload for its own device id.
  const wrongDevice = await api(server.base, 'POST', `/api/devices/${deviceId}/screenshots`, {
    token: otherDeviceToken,
    formData: pngForm()
  });
  assert.ok(wrongDevice.status === 403 || wrongDevice.status === 404);
});

test('screen recordings upload as video kind and appear in /videos + /recordings', async () => {
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/videos`, {
    token: deviceToken,
    formData: videoForm({ durationMs: 4200 })
  });
  assert.equal(up.status, 200, up.text);
  assert.equal(up.data.recording.media_kind, 'video');

  const videos = await api(server.base, 'GET', `/api/devices/${deviceId}/videos`, { token: admin.token });
  assert.equal(videos.status, 200);
  assert.ok(videos.data.some(v => v.file_path === up.data.recording.file_path));

  const recordings = await api(server.base, 'GET', `/api/devices/${deviceId}/recordings`, { token: admin.token });
  assert.ok(recordings.data.some(r => r.file_path === up.data.recording.file_path && (r.media_kind || 'video') === 'video'));

  // Owner can stream the video; a stranger cannot.
  const dl = await fetch(`${server.base}${up.data.recording.file_path}`, {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  assert.equal(dl.status, 200);
  const stranger = await fetch(`${server.base}${up.data.recording.file_path}`, {
    headers: { Authorization: `Bearer ${other.token}` }
  });
  assert.equal(stranger.status, 403);
});

test('video uploads reject non-video content and enforce the size limit', async () => {
  const badFd = new FormData();
  badFd.append('file', new Blob([Buffer.from('not a video')], { type: 'application/octet-stream' }), 'x.mp4');
  const bad = await api(server.base, 'POST', `/api/devices/${deviceId}/videos`, {
    token: deviceToken,
    formData: badFd
  });
  assert.equal(bad.status, 400);

  const big = Buffer.alloc(51 * 1024 * 1024, 3);
  const bigFd = new FormData();
  bigFd.append('file', new Blob([big], { type: 'video/mp4' }), 'big.mp4');
  const tooBig = await api(server.base, 'POST', `/api/devices/${deviceId}/videos`, {
    token: deviceToken,
    formData: bigFd
  });
  assert.equal(tooBig.status, 413);
});

test('cross-device isolation: uploads and lists never leak across tenants', async () => {
  const up = await api(server.base, 'POST', `/api/devices/${otherDeviceId}/screenshots`, {
    token: otherDeviceToken,
    formData: pngForm()
  });
  assert.equal(up.status, 200);

  const mine = await api(server.base, 'GET', `/api/devices/${deviceId}/screenshots`, { token: admin.token });
  assert.ok(!mine.data.some(s => s.file_path === up.data.screenshot.file_path),
    "other tenant's screenshot must not appear in my device list");
});
