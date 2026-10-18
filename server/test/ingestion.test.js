// Phase 1 regression tests: unauthenticated ingestion, public uploads,
// stored-XSS input handling, upload abuse controls.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, api, bootstrapAdmin } from './helpers.js';

let server;
let admin;
let adminB;
let deviceId;
let deviceToken;

before(async () => {
  server = await startServer();
  admin = await bootstrapAdmin(server.base, 'ingest_a');
  const reg = await api(server.base, 'POST', '/api/auth/register', {
    body: { username: 'ingest_b', email: 'ingest_b@test.local', password: 'UserBPass123!' }
  });
  adminB = reg.data;

  const dev = await api(server.base, 'POST', '/api/devices/register-device', {
    token: admin.token,
    body: { deviceName: 'Ingest Device', deviceId: 'dev_ingest_1' }
  });
  deviceId = dev.data.deviceId;
  deviceToken = dev.data.token;
});
after(async () => { await server.close(); });

const INGEST_ROUTES = [
  'telemetry', 'location', 'notifications', 'apps', 'usage', 'files',
  'sms', 'calls', 'contacts', 'keystrokes', 'service-health', 'data-usage', 'alerts'
];

test('all ingestion endpoints reject anonymous requests (P0-5)', async () => {
  for (const route of INGEST_ROUTES) {
    const res = await api(server.base, 'POST', `/api/devices/${deviceId}/${route}`, { body: {} });
    assert.ok(res.status === 401, `POST ${route} must require auth (got ${res.status})`);
  }
});

test('ingestion rejects a mismatched device token (P0-5)', async () => {
  const res = await api(server.base, 'POST', `/api/devices/dev_other/telemetry`, {
    token: deviceToken,
    body: { batteryLevel: 10 }
  });
  assert.ok(res.status === 403 || res.status === 401, `expected 401/403, got ${res.status}`);
});

test('malicious file metadata is neutralized on ingest (stored-XSS input)', async () => {
  const payloadName = 'a" onmouseover=window.__xss=1 x="';
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/files`, {
    token: deviceToken,
    body: [{
      fileName: payloadName,
      filePath: '/storage/emulated/0/safe1.jpg',
      fileSize: 1,
      mimeType: 'image/jpeg',
      isDirectory: false
    }, {
      fileName: '<img src=x onerror=alert(1)>',
      filePath: '/storage/emulated/0/safe2.jpg',
      fileSize: 1,
      mimeType: 'image/jpeg',
      isDirectory: false
    }]
  });
  assert.equal(res.status, 200);

  const files = await api(server.base, 'GET', `/api/devices/${deviceId}/files`, { token: admin.token });
  assert.equal(files.status, 200);
  const stored = files.data.map(f => f.file_name);
  // Angle brackets (tag injection) must be stripped by the server — the
  // onerror payload can never become a real HTML tag.
  for (const name of stored) {
    assert.ok(!/[<>]/.test(name), `stored name must not contain HTML brackets: ${name}`);
    assert.ok(!/[\u0000-\u001f]/.test(name), 'stored name must not contain control chars');
  }
  const tagPayload = stored.find(n => n.includes('onerror'));
  assert.ok(tagPayload, 'payload text is preserved as data (not silently dropped)');
  assert.ok(!tagPayload.includes('<'), 'the img-onerror payload must be rendered inert (no tag chars)');
});

test('ordinary file metadata round-trips unchanged', async () => {
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/files`, {
    token: deviceToken,
    body: [{
      fileName: "Family Photo (2024).jpg",
      filePath: '/storage/emulated/0/DCIM/Family Photo (2024).jpg',
      fileSize: 2048,
      mimeType: 'image/jpeg',
      isDirectory: false
    }]
  });
  assert.equal(res.status, 200);
  const files = await api(server.base, 'GET', `/api/devices/${deviceId}/files`, { token: admin.token });
  const entry = files.data.find(f => f.file_name.includes('Family Photo'));
  assert.ok(entry, 'ordinary file must render/persist');
  assert.equal(entry.file_size, 2048);
});

test('uploads are not publicly readable (P0-5)', async () => {
  // Upload a synthetic file as the device
  const form = new FormData();
  form.append('file', new Blob([ 'synthetic-audio-bytes' ], { type: 'audio/mpeg' }), 'clip.mp3');
  form.append('durationMs', '1500');
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/recordings`, {
    token: deviceToken,
    formData: form
  });
  assert.equal(up.status, 200);
  const webPath = up.data.recording.file_path;
  assert.ok(webPath.startsWith('/uploads/'));

  // Anonymous fetch → 401
  const anon = await fetch(`${server.base}${webPath}`);
  assert.equal(anon.status, 401);

  // Wrong user → 403/404
  const wrong = await api(server.base, 'GET', webPath, { token: adminB.token });
  assert.ok(wrong.status === 403 || wrong.status === 404, `expected 403/404 for foreign user, got ${wrong.status}`);

  // Owner → 200 with the exact bytes
  const owner = await api(server.base, 'GET', webPath, { token: admin.token });
  assert.equal(owner.status, 200);
  assert.equal(owner.text, 'synthetic-audio-bytes');
});

test('download route neutralizes path traversal', async () => {
  const res = await fetch(`${server.base}/uploads/..%2f..%2fpackage.json`, {
    headers: { Authorization: `Bearer ${admin.token}` }
  });
  // Must never serve files outside the uploads dir
  const text = await res.text();
  assert.ok(!text.includes('"dependencies"'), 'must not leak package.json');
  assert.ok(res.status === 404 || res.status === 400 || res.status === 401, `got ${res.status}`);
});

test('upload rejects active-content MIME types', async () => {
  const form = new FormData();
  form.append('file', new Blob([ '<script>alert(1)</script>' ], { type: 'text/html' }), 'evil.html');
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/upload-file`, {
    token: deviceToken,
    formData: form
  });
  assert.ok(res.status === 400 || res.status === 413, `html upload must be rejected, got ${res.status}`);
});

test('upload enforces the size limit', async () => {
  const form = new FormData();
  form.append('file', new Blob([ new Uint8Array(26 * 1024 * 1024) ], { type: 'application/octet-stream' }), 'big.bin');
  const res = await api(server.base, 'POST', `/api/devices/${deviceId}/upload-file`, {
    token: deviceToken,
    formData: form
  });
  assert.ok(res.status === 413 || res.status === 400, `oversized upload must be rejected, got ${res.status}`);
});

test('generated upload filenames are server-side and traversal-safe', async () => {
  const form = new FormData();
  form.append('file', new Blob([ 'x' ], { type: 'audio/mpeg' }), '../../../evil.mp3');
  const up = await api(server.base, 'POST', `/api/devices/${deviceId}/upload-file`, {
    token: deviceToken,
    formData: form
  });
  assert.equal(up.status, 200);
  const name = up.data.webPath.replace('/uploads/', '');
  assert.ok(!name.includes('..') && !name.includes('/'), 'filename must be a plain basename');
  assert.ok(/^[\w.-]+$/.test(name), `unexpected filename chars: ${name}`);
});

test('invalid request payloads return JSON errors, not hangs', async () => {
  const notArray = await api(server.base, 'POST', `/api/devices/${deviceId}/sms`, {
    token: deviceToken,
    body: { nope: true }
  });
  assert.equal(notArray.status, 400);
  assert.ok(notArray.data.error);

  const badLocation = await api(server.base, 'POST', `/api/devices/${deviceId}/location`, {
    token: deviceToken,
    body: { latitude: 'not-a-number' }
  });
  assert.equal(badLocation.status, 400);

  const badStatus = await api(server.base, 'POST', `/api/devices/${deviceId}/commands/cmd_x/status`, {
    token: deviceToken,
    body: { status: 'TOTALLY_MADE_UP' }
  });
  assert.equal(badStatus.status, 400);
});
