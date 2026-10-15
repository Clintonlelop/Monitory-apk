import test from 'node:test';
import assert from 'node:assert/strict';
import { generateToken, verifyDeviceToken } from '../src/auth.js';

function responseMock() {
  return {
    statusCode: 200,
    payload: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.payload = body; return this; }
  };
}

test('device token authorizes only its matching device ID', () => {
  const token = generateToken({ deviceId: 'device-a', type: 'device' }, '5m');
  const req = { headers: { authorization: `Bearer ${token}` }, params: { id: 'device-a' } };
  const res = responseMock();
  let nextCalled = false;

  verifyDeviceToken(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.device.deviceId, 'device-a');
  assert.equal(res.statusCode, 200);
});

test('device token cannot authorize a different device ID', () => {
  const token = generateToken({ deviceId: 'device-a', type: 'device' }, '5m');
  const req = { headers: { authorization: `Bearer ${token}` }, params: { id: 'device-b' } };
  const res = responseMock();
  let nextCalled = false;

  verifyDeviceToken(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('dashboard token is not accepted as a device token', () => {
  const token = generateToken({ id: 7, role: 'admin' }, '5m');
  const req = { headers: { authorization: `Bearer ${token}` }, params: { id: 'device-a' } };
  const res = responseMock();
  let nextCalled = false;

  verifyDeviceToken(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('missing device authorization is rejected', () => {
  const req = { headers: {}, params: { id: 'device-a' } };
  const res = responseMock();
  let nextCalled = false;

  verifyDeviceToken(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});
