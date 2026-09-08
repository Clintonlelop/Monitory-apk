/**
 * api.js — All REST API calls (fetch wrappers)
 * Android MDM Dashboard
 * Base URL: same origin. All requests include Authorization: Bearer <jwt>
 */
const API = (function () {
  'use strict';

  const DEBUG = false;
  const BASE = '/api';

  function log(...args) {
    if (DEBUG) console.log('[API]', ...args);
  }

  /**
   * Internal fetch wrapper with auth header and error handling
   */
  async function request(path, options = {}) {
    const url = path.startsWith('http') ? path : BASE + path;
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const token = Auth.getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    log(options.method || 'GET', url);
    const res = await fetch(url, { ...options, headers });

    // 401 → redirect to login
    if (res.status === 401) {
      Auth.logout();
      throw new Error('Session expired. Please log in again.');
    }

    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => null);
    }

    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
      if (typeof UI !== 'undefined' && UI.showToast) {
        UI.showToast(msg, 'error');
      }
      throw new Error(msg);
    }
    return data;
  }

  function get(path, params) {
    let url = path;
    if (params) {
      const qs = new URLSearchParams();
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') qs.append(k, v);
      });
      const str = qs.toString();
      if (str) url += (url.includes('?') ? '&' : '?') + str;
    }
    return request(url, { method: 'GET' });
  }

  function post(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  function put(path, body) {
    return request(path, { method: 'PUT', body: JSON.stringify(body || {}) });
  }

  function del(path) {
    return request(path, { method: 'DELETE' });
  }

  // ============================================================
  // Auth
  // ============================================================
  const auth = {
    register: (username, password) => post('/auth/register', { username, password }),
    login: (username, password) => post('/auth/login', { username, password })
  };

  // ============================================================
  // Devices
  // ============================================================
  const devices = {
    list: () => get('/devices'),
    get: (id) => get('/devices/' + encodeURIComponent(id)),
    register: (data) => post('/devices', data),
    getPermissions: (id) => get('/devices/' + encodeURIComponent(id) + '/permissions'),
    updatePermissions: (id, permissions) =>
      put('/devices/' + encodeURIComponent(id) + '/permissions', { permissions })
  };

  // ============================================================
  // Commands
  // ============================================================
  const commands = {
    create: (deviceId, type, payload) =>
      post('/commands', { device_id: deviceId, type, payload: payload || {} }),
    list: (deviceId, params) =>
      get('/commands', { device_id: deviceId, ...(params || {}) }),
    updateStatus: (id, data) => put('/commands/' + encodeURIComponent(id) + '/status', data)
  };

  // ============================================================
  // Telemetry
  // ============================================================
  const telemetry = {
    send: (data) => post('/telemetry', data),
    list: (deviceId, params) =>
      get('/telemetry', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // Locations
  // ============================================================
  const locations = {
    send: (data) => post('/locations', data),
    list: (deviceId, params) =>
      get('/locations', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // Geofences
  // ============================================================
  const geofences = {
    list: (params) => get('/geofences', params || {}),
    create: (data) => post('/geofences', data),
    update: (id, data) => put('/geofences/' + encodeURIComponent(id), data),
    delete: (id) => del('/geofences/' + encodeURIComponent(id)),
    events: (params) => get('/geofences/events', params || {})
  };

  // ============================================================
  // Notifications
  // ============================================================
  const notifications = {
    send: (data) => post('/notifications', data),
    list: (deviceId, params) =>
      get('/notifications', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // Usage (App usage stats)
  // ============================================================
  const usage = {
    send: (data) => post('/usage', data),
    list: (deviceId, params) =>
      get('/usage', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // Contacts
  // ============================================================
  const contacts = {
    sync: (data) => post('/contacts/sync', data),
    list: (deviceId) => get('/contacts', { device_id: deviceId })
  };

  // ============================================================
  // Calls
  // ============================================================
  const calls = {
    sync: (data) => post('/calls/sync', data),
    list: (deviceId, params) =>
      get('/calls', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // SMS
  // ============================================================
  const sms = {
    sync: (data) => post('/sms/sync', data),
    list: (deviceId, params) =>
      get('/sms', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // Files
  // ============================================================
  const files = {
    sync: (data) => post('/files/sync', data),
    list: (deviceId, params) =>
      get('/files', { device_id: deviceId, ...(params || {}) })
  };

  // ============================================================
  // Upload / Media
  // ============================================================
  async function upload(file, deviceId, fileType) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('device_id', deviceId);
    if (fileType) formData.append('file_type', fileType);

    const token = Auth.getToken();
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;

    log('Upload', file.name, 'to', BASE + '/upload');
    const res = await fetch(BASE + '/upload', {
      method: 'POST',
      headers,
      body: formData
    });
    if (res.status === 401) {
      Auth.logout();
      throw new Error('Session expired.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error || data.message || `Upload failed (${res.status})`;
      if (typeof UI !== 'undefined') UI.showToast(msg, 'error');
      throw new Error(msg);
    }
    return data;
  }

  const media = {
    list: (params) => get('/media', params || {}),
    download: (id) => BASE + '/media/' + encodeURIComponent(id) + '/download'
  };

  // ============================================================
  // Recordings
  // ============================================================
  const recordings = {
    list: (params) => get('/recordings', params || {}),
    download: (id) => BASE + '/recordings/' + encodeURIComponent(id) + '/download'
  };

  // ============================================================
  // Activity
  // ============================================================
  const activity = {
    list: (params) => get('/activity', params || {})
  };

  // ============================================================
  // Remote Control
  // ============================================================
  const remote = {
    start: (deviceId, data) => post('/remote/' + encodeURIComponent(deviceId) + '/start', data || {}),
    stop: (deviceId) => post('/remote/' + encodeURIComponent(deviceId) + '/stop', {}),
    status: (deviceId) => get('/remote/' + encodeURIComponent(deviceId) + '/status'),
    metrics: (deviceId, params) => get('/remote/' + encodeURIComponent(deviceId) + '/metrics', params || {}),
    sessions: (deviceId, params) => get('/remote/' + encodeURIComponent(deviceId) + '/sessions', params || {})
  };

  // ============================================================
  // Transfers (chunked file transfers)
  // ============================================================
  const transfers = {
    init: (data) => post('/transfers/init', data),
    chunk: (transferId, data) => post('/transfers/' + encodeURIComponent(transferId) + '/chunk', data),
    complete: (transferId) => post('/transfers/' + encodeURIComponent(transferId) + '/complete', {}),
    status: (transferId) => get('/transfers/' + encodeURIComponent(transferId) + '/status'),
    list: (params) => get('/transfers', params || {})
  };

  // ============================================================
  // Snapshots
  // ============================================================
  const snapshots = {
    create: (data) => post('/snapshots', data),
    list: (deviceId, params) => get('/snapshots/devices/' + encodeURIComponent(deviceId) + '/snapshots', params || {}),
    get: (id) => get('/snapshots/' + encodeURIComponent(id)),
    compare: (fromId, toId) => get('/snapshots/compare', { from_id: fromId, to_id: toId })
  };

  // ============================================================
  // Diagnostics
  // ============================================================
  const diagnostics = {
    run: (data) => post('/diagnostics/run', data || {}),
    history: (params) => get('/diagnostics/history', params || {})
  };

  // ============================================================
  // Performance
  // ============================================================
  const performance = {
    get: (deviceId) => get('/devices/' + encodeURIComponent(deviceId) + '/performance', { hours: 24 }),
    history: (deviceId, params) => get('/devices/' + encodeURIComponent(deviceId) + '/performance', params || {})
  };

  return {
    auth,
    devices,
    commands,
    telemetry,
    locations,
    geofences,
    notifications,
    usage,
    contacts,
    calls,
    sms,
    files,
    upload,
    media,
    recordings,
    activity,
    remote,
    transfers,
    snapshots,
    diagnostics,
    performance
  };
})();
