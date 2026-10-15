import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import { initDb, db } from './db.js';
import { setupWebSocket } from './ws.js';
import { normalizeCommandStatus, canAdvanceCommandStatus, isTerminalCommandStatus } from './sync-utils.js';
import { generateToken, verifyToken, optionalAuth, hashPassword, comparePassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error('[Server Error] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server Error] Unhandled rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || process.env.DEFAULT_APP_PORT || process.env.APP_PORT || 3000;

// Setup Uploads directory
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const upload = multer({ storage });

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static dashboard files
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use('/uploads', express.static(uploadsDir));

// Initialize Database & WebSockets
await initDb();
const wsManager = setupWebSocket(server);

// ==========================================
// AUDIT LOG HELPER
// ==========================================
async function logAudit(userId, deviceId, action, details, ip) {
  try {
    if (db.isPostgres()) {
      await db.query(
        'INSERT INTO audit_logs (user_id, device_id, action, details, ip_address) VALUES ($1, $2, $3, $4, $5)',
        [userId || null, deviceId || null, action, JSON.stringify(details || {}), ip || '127.0.0.1']
      );
    } else {
      db.getMemoryStore().audit_logs.unshift({
        id: Date.now(),
        user_id: userId,
        device_id: deviceId,
        action,
        details,
        ip_address: ip || '127.0.0.1',
        created_at: new Date()
      });
    }
  } catch (e) {
    console.error('Audit log error:', e);
  }
}

// ==========================================
// HEALTH & METRICS
// ==========================================
app.get(['/health', '/api/health'], (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    postgres: db.isPostgres(),
    activeDevices: wsManager.deviceSockets.size,
    activeDashboards: wsManager.dashboardSockets.size
  });
});

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
app.post('/api/auth/register', async (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = req.body.password;
  if (!email || typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'Email and a password of at least 12 characters are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'A valid email address is required' });
  }
  const name = username || email.split('@')[0];
  try {
    let user;
    if (db.isPostgres()) {
      const count = await db.query('SELECT COUNT(*)::int AS count FROM users');
      if (count.rows[0].count !== 0) {
        return res.status(403).json({ error: 'Registration is closed. Ask the existing administrator to create an account.' });
      }
      const hashed = await hashPassword(password);
      const result = await db.query(
        'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
        [name, email, hashed, 'admin']
      );
      user = result.rows[0];
    } else {
      const store = db.getMemoryStore();
      if (store.users.length !== 0) {
        return res.status(403).json({ error: 'Registration is closed. Ask the existing administrator to create an account.' });
      }
      const hashed = await hashPassword(password);
      user = { id: 1, username: name, email, password_hash: hashed, role: 'admin', created_at: new Date() };
      store.users.push(user);
    }
    const token = generateToken({ id: user.id, username: user.username, email: user.email, role: user.role });
    await logAudit(user.id, null, 'REGISTER', { email, username: name }, req.ip);
    return res.status(201).json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'That username or email is already registered' });
    console.error('[Auth] Registration failed:', err);
    return res.status(500).json({ error: 'Unable to register right now' });
  }
});
app.post('/api/auth/login', async (req, res) => {
  const identifier = String(req.body.email || req.body.identifier || req.body.username || '').trim();
  const password = req.body.password;
  if (!identifier || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email/username and password required' });
  }

  try {
    let user;
    if (db.isPostgres()) {
      const result = await db.query(
        'SELECT * FROM users WHERE email = $1 OR username = $1 LIMIT 1',
        [identifier]
      );
      user = result.rows[0];
    } else {
      user = db.getMemoryStore().users.find(u => u.email === identifier || u.username === identifier);
    }

    // Never create accounts or replace passwords during login.
    if (!user || !user.password_hash || !(await comparePassword(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email/username or password' });
    }

    const token = generateToken({ id: user.id, username: user.username, email: user.email, role: user.role });
    await logAudit(user.id, null, 'LOGIN', { email: user.email }, req.ip);

    return res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('[Auth] Login failed:', err);
    return res.status(500).json({ error: 'Unable to sign in right now' });
  }
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// PAIRING SYSTEM
// ==========================================
// Admin generates a 6-digit code for device pairing
app.post('/api/devices/pair-code', verifyToken, async (req, res) => {
  const code = randomInt(100000, 1000000).toString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  if (db.isPostgres()) {
    await db.query(
      'INSERT INTO pairing_codes (code, user_id, expires_at) VALUES ($1, $2, $3)',
      [code, req.user.id, expiresAt]
    );
  } else {
    db.getMemoryStore().pairing_codes.set(code, {
      code,
      user_id: req.user.id,
      expires_at: expiresAt,
      used: false
    });
  }

  logAudit(req.user.id, null, 'GENERATE_PAIRING_CODE', { expiresAt: expiresAt.toISOString() }, req.ip);
  res.json({ code, expiresAt });
});

// Android device submits pairing code
app.post('/api/devices/pair', async (req, res) => {
  const { pairingCode, deviceName, manufacturer, model, osVersion } = req.body;
  if (!pairingCode) {
    return res.status(400).json({ success: false, message: 'Pairing code is required' });
  }

  let validPairing = null;
  if (db.isPostgres()) {
    const result = await db.query(
      `UPDATE pairing_codes
       SET used = TRUE
       WHERE id = (
         SELECT id FROM pairing_codes
         WHERE code = $1 AND used = FALSE AND expires_at > CURRENT_TIMESTAMP
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [String(pairingCode).trim()]
    );
    if (result.rows.length > 0) validPairing = result.rows[0];
  } else {
    const entry = db.getMemoryStore().pairing_codes.get(String(pairingCode).trim());
    if (entry && !entry.used && new Date() < entry.expires_at) {
      entry.used = true;
      validPairing = entry;
    }
  }

  if (!validPairing) {
    return res.status(400).json({ success: false, message: 'Invalid or expired pairing code' });
  }

  const deviceId = 'dev_' + Math.random().toString(36).substring(2, 10);
  const deviceToken = generateToken({ deviceId, type: 'device' }, '365d');

  const now = new Date();
  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO devices (id, user_id, device_name, manufacturer, model, os_version, auth_token, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE SET device_name = $3, auth_token = $7, status = $8, last_seen = $9`,
      [deviceId, validPairing.user_id, deviceName || 'Android Device', manufacturer, model, osVersion, deviceToken, 'ONLINE', now]
    );
    await db.query(
      `INSERT INTO device_permissions (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
      [deviceId]
    );
  } else {
    const store = db.getMemoryStore();
    store.devices.set(deviceId, {
      id: deviceId,
      user_id: validPairing.user_id,
      device_name: deviceName || 'Android Device',
      manufacturer,
      model,
      os_version: osVersion,
      auth_token: deviceToken,
      status: 'ONLINE',
      battery_level: 100,
      is_charging: false,
      storage_available: 0,
      storage_total: 0,
      ram_available: 0,
      ram_total: 0,
      network_type: 'Wi-Fi',
      wifi_ssid: null,
      uptime_millis: 0,
      last_seen: now,
      created_at: now
    });
    store.device_permissions.set(deviceId, {
      location: false,
      notification_access: false,
      files_access: false,
      camera: false,
      microphone: false,
      usage_access: false,
      screen_sharing: false
    });
  }

  logAudit(validPairing.user_id, deviceId, 'DEVICE_PAIRED', { deviceName, model }, req.ip);

  wsManager.broadcastToDashboards({
    type: 'DEVICE_PAIRED',
    deviceId,
    deviceName,
    timestamp: Date.now()
  });

  res.json({
    success: true,
    deviceId,
    token: deviceToken,
    message: 'Device paired successfully'
  });
});

// Direct account-based device registration from Android app
app.post('/api/devices/register-device', verifyToken, async (req, res) => {
  const { deviceName, manufacturer, model, osVersion, sdkVersion, appVersion, deviceId: clientDeviceId } = req.body;
  const userId = req.user.id;

  const deviceId = clientDeviceId || ('dev_' + Math.random().toString(36).substring(2, 10));
  const deviceToken = generateToken({ deviceId, type: 'device' }, '365d');
  const now = new Date();

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO devices (id, user_id, device_name, manufacturer, model, os_version, sdk_version, app_version, auth_token, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET device_name = $3, auth_token = $9, status = $10, last_seen = $11`,
      [deviceId, userId, deviceName || 'Android Device', manufacturer, model, osVersion, sdkVersion || 34, appVersion || '1.0', deviceToken, 'ONLINE', now]
    );
    await db.query(
      `INSERT INTO device_permissions (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
      [deviceId]
    );
  } else {
    const store = db.getMemoryStore();
    store.devices.set(deviceId, {
      id: deviceId,
      user_id: userId,
      device_name: deviceName || 'Android Device',
      manufacturer,
      model,
      os_version: osVersion,
      sdk_version: sdkVersion || 34,
      app_version: appVersion || '1.0',
      auth_token: deviceToken,
      status: 'ONLINE',
      battery_level: 100,
      is_charging: false,
      storage_available: 0,
      storage_total: 0,
      ram_available: 0,
      ram_total: 0,
      network_type: 'Wi-Fi',
      wifi_ssid: null,
      uptime_millis: 0,
      last_seen: now,
      created_at: now
    });
    store.device_permissions.set(deviceId, {
      location: false,
      notification_access: false,
      files_access: false,
      camera: false,
      microphone: false,
      usage_access: false,
      screen_sharing: false
    });
  }

  logAudit(userId, deviceId, 'DEVICE_REGISTERED_TO_ACCOUNT', { deviceName, model }, req.ip);

  wsManager.broadcastToDashboards({
    type: 'DEVICE_PAIRED',
    deviceId,
    deviceName,
    timestamp: Date.now()
  });

  res.json({
    success: true,
    deviceId,
    token: deviceToken,
    message: 'Device connected to your account successfully'
  });
});

// ==========================================
// DEVICE MANAGEMENT ROUTES
// ==========================================
app.get('/api/devices', verifyToken, async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT id, device_name, manufacturer, model, os_version, app_version, status, battery_level, is_charging, network_type, last_seen, created_at FROM devices ORDER BY last_seen DESC'
    );
    res.json(result.rows);
  } else {
    const devices = Array.from(db.getMemoryStore().devices.values());
    res.json(devices);
  }
});

app.get('/api/devices/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  let device, permissions;

  if (db.isPostgres()) {
    const devRes = await db.query('SELECT * FROM devices WHERE id = $1', [id]);
    device = devRes.rows[0];
    const permRes = await db.query('SELECT * FROM device_permissions WHERE device_id = $1', [id]);
    permissions = permRes.rows[0];
  } else {
    device = db.getMemoryStore().devices.get(id);
    permissions = db.getMemoryStore().device_permissions.get(id);
  }

  if (!device) {
    return res.status(404).json({ error: 'Device not found' });
  }

  res.json({
    ...device,
    permissions: permissions || {}
  });
});

app.delete('/api/devices/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    await db.query('DELETE FROM devices WHERE id = $1', [id]);
  } else {
    db.getMemoryStore().devices.delete(id);
  }
  logAudit(req.user.id, id, 'DEVICE_DELETED', {}, req.ip);
  wsManager.broadcastToDashboards({ type: 'DEVICE_DELETED', deviceId: id });
  res.json({ success: true });
});

app.delete('/api/devices/:id/disconnect', optionalAuth, async (req, res) => {
  const { id } = req.params;
  const now = new Date();
  if (db.isPostgres()) {
    await db.query('UPDATE devices SET status = $1, last_seen = $2 WHERE id = $3', ['OFFLINE', now, id]);
  } else {
    const dev = db.getMemoryStore().devices.get(id);
    if (dev) {
      dev.status = 'OFFLINE';
      dev.last_seen = now;
    }
  }

  logAudit(req.user?.id, id, 'DEVICE_DISCONNECTED', {}, req.ip);
  wsManager.broadcastToDashboards({ type: 'DEVICE_STATUS_CHANGED', deviceId: id, status: 'OFFLINE' });
  res.json({ success: true });
});

// ==========================================
// TELEMETRY SYNC
// ==========================================
app.post('/api/devices/:id/telemetry', async (req, res) => {
  const { id } = req.params;
  const telemetry = req.body;
  const now = new Date();

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO devices (id, device_name, manufacturer, model, os_version, sdk_version, app_version, battery_level, is_charging, storage_available, storage_total, ram_available, ram_total, network_type, wifi_ssid, uptime_millis, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'ONLINE', $17)
       ON CONFLICT (id) DO UPDATE SET 
        device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
        manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
        model = COALESCE(EXCLUDED.model, devices.model),
        os_version = COALESCE(EXCLUDED.os_version, devices.os_version),
        sdk_version = COALESCE(EXCLUDED.sdk_version, devices.sdk_version),
        app_version = COALESCE(EXCLUDED.app_version, devices.app_version),
        battery_level = EXCLUDED.battery_level,
        is_charging = EXCLUDED.is_charging,
        storage_available = EXCLUDED.storage_available,
        storage_total = EXCLUDED.storage_total,
        ram_available = EXCLUDED.ram_available,
        ram_total = EXCLUDED.ram_total,
        network_type = EXCLUDED.network_type,
        wifi_ssid = EXCLUDED.wifi_ssid,
        uptime_millis = EXCLUDED.uptime_millis,
        status = 'ONLINE',
        last_seen = EXCLUDED.last_seen`,
      [
        id,
        telemetry.deviceName || 'Android Device',
        telemetry.manufacturer || 'Android',
        telemetry.model || 'Device',
        telemetry.osVersion || 'Android',
        telemetry.sdkVersion || 34,
        telemetry.appVersion || '1.0',
        telemetry.batteryLevel || 100,
        telemetry.isCharging || false,
        telemetry.storageAvailableBytes || 0,
        telemetry.storageTotalBytes || 0,
        telemetry.ramAvailableBytes || 0,
        telemetry.ramTotalBytes || 0,
        telemetry.networkType || 'WIFI',
        telemetry.wifiSsid || '',
        telemetry.uptimeMillis || 0,
        now
      ]
    );
  } else {
    const dev = db.getMemoryStore().devices.get(id) || { id };
    Object.assign(dev, {
      deviceName: telemetry.deviceName || dev.deviceName,
      manufacturer: telemetry.manufacturer || dev.manufacturer,
      model: telemetry.model || dev.model,
      os_version: telemetry.osVersion || dev.os_version,
      battery_level: telemetry.batteryLevel,
      is_charging: telemetry.isCharging,
      storage_available: telemetry.storageAvailableBytes,
      storage_total: telemetry.storageTotalBytes,
      ram_available: telemetry.ramAvailableBytes,
      ram_total: telemetry.ramTotalBytes,
      network_type: telemetry.networkType,
      wifi_ssid: telemetry.wifiSsid,
      uptime_millis: telemetry.uptimeMillis,
      status: 'ONLINE',
      last_seen: now
    });
    db.getMemoryStore().devices.set(id, dev);
  }

  // Broadcast to all active admin dashboards in real time!
  wsManager.broadcastToDashboards({
    type: 'DEVICE_TELEMETRY_UPDATED',
    deviceId: id,
    telemetry
  });

  res.json({ success: true });
});

// ==========================================
// LOCATION TRACKING
// ==========================================
app.post('/api/devices/:id/location', async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude, accuracy, altitude, speed, provider, timestamp } = req.body;

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO locations (device_id, latitude, longitude, accuracy, altitude, speed, provider, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, latitude, longitude, accuracy, altitude || null, speed || null, provider || null, timestamp || Date.now()]
    );
  } else {
    db.getMemoryStore().locations.push({
      id: Date.now(),
      device_id: id,
      latitude,
      longitude,
      accuracy,
      altitude,
      speed,
      provider,
      timestamp: timestamp || Date.now(),
      created_at: new Date()
    });
  }

  // Geofence evaluation
  try {
    let fences = [];
    if (db.isPostgres()) {
      const gRes = await db.query('SELECT * FROM geofences WHERE (device_id = $1 OR device_id IS NULL) AND is_active = TRUE', [id]);
      fences = gRes.rows;
    } else {
      fences = (db.getMemoryStore().geofences || []).filter(g => (!g.device_id || g.device_id === id) && g.is_active !== false);
    }

    for (const fence of fences) {
      const R = 6371e3;
      const phi1 = Number(latitude) * Math.PI / 180;
      const phi2 = Number(fence.latitude) * Math.PI / 180;
      const deltaPhi = (Number(fence.latitude) - Number(latitude)) * Math.PI / 180;
      const deltaLambda = (Number(fence.longitude) - Number(longitude)) * Math.PI / 180;
      const a = Math.sin(deltaPhi/2) * Math.sin(deltaPhi/2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda/2) * Math.sin(deltaLambda/2);
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      const isInside = dist <= (Number(fence.radius_meters) || 500);

      const prevStatus = fence.last_status || 'UNKNOWN';
      const newStatus = isInside ? 'INSIDE' : 'OUTSIDE';

      if (prevStatus !== newStatus && prevStatus !== 'UNKNOWN') {
        const eventType = isInside ? 'GEOFENCE_ENTERED' : 'GEOFENCE_EXITED';
        const alertMsg = `Device ${eventType === 'GEOFENCE_ENTERED' ? 'entered' : 'exited'} geofence "${fence.name}" (Distance: ${Math.round(dist)}m)`;

        if (db.isPostgres()) {
          await db.query('UPDATE geofences SET last_status = $1 WHERE id = $2', [newStatus, fence.id]);
          await db.query(
            `INSERT INTO alerts (device_id, alert_type, severity, title, message)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, eventType, isInside ? 'INFO' : 'WARNING', `Geofence Alert: ${fence.name}`, alertMsg]
          );
        } else {
          fence.last_status = newStatus;
          db.getMemoryStore().alerts.unshift({
            id: Date.now(),
            device_id: id,
            alert_type: eventType,
            severity: isInside ? 'INFO' : 'WARNING',
            title: `Geofence Alert: ${fence.name}`,
            message: alertMsg,
            created_at: new Date()
          });
        }

        wsManager.broadcastToDashboards({
          type: 'GEOFENCE_ALERT',
          deviceId: id,
          geofenceName: fence.name,
          eventType,
          distance: Math.round(dist),
          message: alertMsg,
          timestamp: Date.now()
        });
      } else {
        if (db.isPostgres()) {
          await db.query('UPDATE geofences SET last_status = $1 WHERE id = $2', [newStatus, fence.id]);
        } else {
          fence.last_status = newStatus;
        }
      }
    }
  } catch (geoErr) {
    console.warn('Geofence check error:', geoErr.message);
  }

  wsManager.broadcastToDashboards({
    type: 'DEVICE_LOCATION_UPDATED',
    deviceId: id,
    location: { latitude, longitude, accuracy, altitude, speed, timestamp: timestamp || Date.now() }
  });

  res.json({ success: true });
});

app.get('/api/devices/:id/locations', verifyToken, async (req, res) => {
  const { id } = req.params;
  const limit = parseInt(req.query.limit) || 100;

  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT * FROM locations WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [id, limit]
    );
    res.json(result.rows);
  } else {
    const locs = db.getMemoryStore().locations
      .filter(l => l.device_id === id)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
    res.json(locs);
  }
});

// ==========================================
// NOTIFICATIONS CAPTURE
// ==========================================
app.post('/api/devices/:id/notifications', async (req, res) => {
  const { id } = req.params;
  const notif = req.body;

  const pkg = notif.packageName || 'unknown';
  const title = notif.title || '';
  const text = notif.text || '';
  const postTime = notif.postTime || Date.now();
  const notifId = notif.id || `${id}_${pkg}_${title.slice(0, 30)}_${postTime}`;

  let isNew = false;

  if (db.isPostgres()) {
    const existing = await db.query('SELECT id FROM notifications WHERE id = $1', [notifId]);
    if (existing.rows.length === 0) {
      isNew = true;
      await db.query(
        `INSERT INTO notifications (id, device_id, package_name, app_name, title, text, category, post_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, post_time = EXCLUDED.post_time`,
        [notifId, id, pkg, notif.appName || pkg, title, text, notif.category || null, postTime]
      );
    } else {
      await db.query(
        `UPDATE notifications SET text = $1, post_time = $2 WHERE id = $3`,
        [text, postTime, notifId]
      );
    }
  } else {
    const list = db.getMemoryStore().notifications;
    const existingIdx = list.findIndex(n =>
      n.id === notifId ||
      (n.device_id === id && n.package_name === pkg && n.title === title && Math.abs(Number(n.post_time) - Number(postTime)) < 2000)
    );

    if (existingIdx !== -1) {
      list[existingIdx].text = text;
      list[existingIdx].post_time = postTime;
    } else {
      isNew = true;
      list.unshift({
        id: notifId,
        device_id: id,
        package_name: pkg,
        app_name: notif.appName || pkg,
        title,
        text,
        category: notif.category || null,
        post_time: postTime,
        created_at: new Date()
      });
    }
  }

  const broadcastPayload = { ...notif, id: notifId };
  wsManager.broadcastToDashboards({
    type: 'DEVICE_NOTIFICATION_RECEIVED',
    deviceId: id,
    notification: broadcastPayload,
    isNew
  });

  res.json({ success: true, isNew, id: notifId });
});

app.get('/api/devices/:id/notifications', verifyToken, async (req, res) => {
  const { id } = req.params;
  const search = req.query.search;
  const limit = parseInt(req.query.limit) || 50;

  if (db.isPostgres()) {
    let query = 'SELECT * FROM notifications WHERE device_id = $1';
    const params = [id];
    if (search) {
      query += ' AND (title ILIKE $2 OR text ILIKE $2 OR app_name ILIKE $2)';
      params.push(`%${search}%`);
    }
    query += ` ORDER BY post_time DESC LIMIT ${limit}`;
    const result = await db.query(query, params);
    res.json(result.rows);
  } else {
    let list = db.getMemoryStore().notifications.filter(n => n.device_id === id);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(n => (n.title && n.title.toLowerCase().includes(s)) || (n.text && n.text.toLowerCase().includes(s)) || (n.app_name && n.app_name.toLowerCase().includes(s)));
    }
    res.json(list.slice(0, limit));
  }
});

app.delete('/api/devices/:id/notifications/:notifId', verifyToken, async (req, res) => {
  const { id, notifId } = req.params;
  if (db.isPostgres()) {
    await db.query('DELETE FROM notifications WHERE id = $1 AND device_id = $2', [notifId, id]);
  } else {
    const list = db.getMemoryStore().notifications;
    const idx = list.findIndex(n => n.id === notifId && n.device_id === id);
    if (idx !== -1) list.splice(idx, 1);
  }
  res.json({ success: true });
});

// ==========================================
// APPLICATION INVENTORY
// ==========================================
app.post('/api/devices/:id/apps', async (req, res) => {
  const { id } = req.params;
  const apps = req.body; // Array of AppInfoData

  if (Array.isArray(apps)) {
    if (db.isPostgres()) {
      for (const app of apps) {
        await db.query(
          `INSERT INTO applications (device_id, package_name, app_name, version_name, version_code, is_system_app, first_install_time, last_update_time, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
           ON CONFLICT (device_id, package_name) DO UPDATE SET
            app_name = $3, version_name = $4, version_code = $5, is_system_app = $6, last_update_time = $8, updated_at = CURRENT_TIMESTAMP`,
          [id, app.packageName, app.appName, app.versionName, app.versionCode, app.isSystemApp, app.firstInstallTime, app.lastUpdateTime]
        );
      }
    } else {
      db.getMemoryStore().applications.set(id, apps);
    }
  }

  res.json({ success: true, count: apps.length });
});

app.get('/api/devices/:id/apps', verifyToken, async (req, res) => {
  const { id } = req.params;
  const search = req.query.search;

  if (db.isPostgres()) {
    let query = 'SELECT * FROM applications WHERE device_id = $1';
    const params = [id];
    if (search) {
      query += ' AND (app_name ILIKE $2 OR package_name ILIKE $2)';
      params.push(`%${search}%`);
    }
    query += ' ORDER BY is_system_app ASC, app_name ASC';
    const result = await db.query(query, params);
    res.json(result.rows);
  } else {
    let list = db.getMemoryStore().applications.get(id) || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(a => a.appName.toLowerCase().includes(s) || a.packageName.toLowerCase().includes(s));
    }
    res.json(list);
  }
});

// ==========================================
// USAGE STATISTICS
// ==========================================
app.post('/api/devices/:id/usage', async (req, res) => {
  const { id } = req.params;
  const usageList = req.body;

  if (Array.isArray(usageList)) {
    if (db.isPostgres()) {
      for (const u of usageList) {
        await db.query(
          `INSERT INTO usage_statistics (device_id, package_name, app_name, total_time_ms, last_time_used)
           VALUES ($1, $2, $3, $4, $5)`,
          [id, u.packageName, u.appName, u.totalTimeInForegroundMs, u.lastTimeUsed]
        );
      }
    } else {
      db.getMemoryStore().usage_statistics = usageList.map(u => ({
        device_id: id,
        package_name: u.packageName,
        app_name: u.appName,
        total_time_ms: u.totalTimeInForegroundMs,
        last_time_used: u.lastTimeUsed,
        recorded_at: new Date()
      }));
    }
  }

  res.json({ success: true });
});

app.get('/api/devices/:id/usage', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT DISTINCT ON (package_name) * FROM usage_statistics WHERE device_id = $1 ORDER BY package_name, recorded_at DESC',
      [id]
    );
    res.json(result.rows.sort((a, b) => Number(b.total_time_ms) - Number(a.total_time_ms)));
  } else {
    res.json(db.getMemoryStore().usage_statistics.filter(u => u.device_id === id));
  }
});

// ==========================================
// FILE EXPLORER SERVICES
// ==========================================
app.post('/api/devices/:id/files', async (req, res) => {
  const { id } = req.params;
  const list = req.body; // Array of file metadata
  if (Array.isArray(list)) {
    try {
      if (db.isPostgres()) {
        await db.query('DELETE FROM files WHERE device_id = $1', [id]);
        for (const f of list) {
          await db.query(
            `INSERT INTO files (device_id, file_name, file_path, file_size, mime_type, is_directory)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, f.fileName, f.filePath, f.fileSize || 0, f.mimeType, f.isDirectory || false]
          );
        }
      } else {
        const store = db.getMemoryStore();
        store.files = store.files.filter(f => f.device_id !== id);
        list.forEach(f => {
          store.files.push({
            id: Date.now() + Math.random(),
            device_id: id,
            file_name: f.fileName,
            file_path: f.filePath,
            file_size: f.fileSize || 0,
            mime_type: f.mimeType,
            is_directory: f.isDirectory || false,
            created_at: new Date()
          });
        });
      }
      wsManager.broadcastToDashboards({ type: 'DEVICE_FILES_RECEIVED', deviceId: id });
    } catch (e) {
      console.error('Error saving files list:', e);
    }
  }
  res.json({ success: true });
});

app.get('/api/devices/:id/files', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM files WHERE device_id = $1 ORDER BY is_directory DESC, file_name ASC', [id]);
      res.json(result.rows);
    } else {
      res.json(db.getMemoryStore().files.filter(f => f.device_id === id));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SMS LOGGING SERVICES
// ==========================================
app.post('/api/devices/:id/sms', async (req, res) => {
  const { id } = req.params;
  const list = req.body; // Array of SMS records
  if (Array.isArray(list)) {
    try {
      if (db.isPostgres()) {
        for (const s of list) {
          await db.query(
            `INSERT INTO sms (device_id, address, body, type, timestamp)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, s.address, s.body, s.type || 'INBOX', s.timestamp]
          );
        }
      } else {
        const store = db.getMemoryStore().sms;
        list.forEach(s => {
          store.unshift({
            id: Date.now() + Math.random(),
            device_id: id,
            address: s.address,
            body: s.body,
            type: s.type || 'INBOX',
            timestamp: s.timestamp,
            created_at: new Date()
          });
        });
      }
      wsManager.broadcastToDashboards({ type: 'DEVICE_SMS_RECEIVED', deviceId: id });
    } catch (e) {
      console.error('Error saving SMS:', e);
    }
  }
  res.json({ success: true });
});

app.get('/api/devices/:id/sms', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM sms WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200', [id]);
      res.json(result.rows);
    } else {
      res.json(db.getMemoryStore().sms.filter(s => s.device_id === id));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CALL LOGGING SERVICES
// ==========================================
app.post('/api/devices/:id/calls', async (req, res) => {
  const { id } = req.params;
  const list = req.body;
  if (Array.isArray(list)) {
    try {
      if (db.isPostgres()) {
        for (const c of list) {
          await db.query(
            `INSERT INTO calls (device_id, number, name, type, duration, timestamp)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [id, c.number, c.name, c.type || 'INCOMING', c.duration || 0, c.timestamp]
          );
        }
      } else {
        const store = db.getMemoryStore().calls;
        list.forEach(c => {
          store.unshift({
            id: Date.now() + Math.random(),
            device_id: id,
            number: c.number,
            name: c.name,
            type: c.type || 'INCOMING',
            duration: c.duration || 0,
            timestamp: c.timestamp,
            created_at: new Date()
          });
        });
      }
      wsManager.broadcastToDashboards({ type: 'DEVICE_CALLS_RECEIVED', deviceId: id });
    } catch (e) {
      console.error('Error saving Call Logs:', e);
    }
  }
  res.json({ success: true });
});

app.get('/api/devices/:id/calls', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM calls WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200', [id]);
      res.json(result.rows);
    } else {
      res.json(db.getMemoryStore().calls.filter(c => c.device_id === id));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// CONTACT LIST MANAGEMENT
// ==========================================
app.post('/api/devices/:id/contacts', async (req, res) => {
  const { id } = req.params;
  const list = req.body;
  if (Array.isArray(list)) {
    try {
      if (db.isPostgres()) {
        await db.query('DELETE FROM contacts WHERE device_id = $1', [id]);
        for (const c of list) {
          await db.query(
            `INSERT INTO contacts (device_id, name, phone, email)
             VALUES ($1, $2, $3, $4)`,
            [id, c.name, c.phone, c.email]
          );
        }
      } else {
        const store = db.getMemoryStore();
        store.contacts = store.contacts.filter(c => c.device_id !== id);
        list.forEach(c => {
          store.contacts.push({
            id: Date.now() + Math.random(),
            device_id: id,
            name: c.name,
            phone: c.phone,
            email: c.email
          });
        });
      }
      wsManager.broadcastToDashboards({ type: 'DEVICE_CONTACTS_RECEIVED', deviceId: id });
    } catch (e) {
      console.error('Error saving Contacts:', e);
    }
  }
  res.json({ success: true });
});

app.get('/api/devices/:id/contacts', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM contacts WHERE device_id = $1 ORDER BY name ASC', [id]);
      res.json(result.rows);
    } else {
      res.json(db.getMemoryStore().contacts.filter(c => c.device_id === id));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// KEYSTROKE CAPTURE LOGS
// ==========================================
app.post('/api/devices/:id/keystrokes', async (req, res) => {
  const { id } = req.params;
  const list = req.body;
  if (Array.isArray(list)) {
    try {
      if (db.isPostgres()) {
        for (const k of list) {
          await db.query(
            `INSERT INTO keystrokes (device_id, app_package, app_name, text, timestamp)
             VALUES ($1, $2, $3, $4, $5)`,
            [id, k.appPackage, k.appName, k.text, k.timestamp]
          );
        }
      } else {
        const store = db.getMemoryStore().keystrokes;
        list.forEach(k => {
          store.unshift({
            id: Date.now() + Math.random(),
            device_id: id,
            app_package: k.appPackage,
            app_name: k.appName,
            text: k.text,
            timestamp: k.timestamp,
            created_at: new Date()
          });
        });
      }
      wsManager.broadcastToDashboards({ type: 'DEVICE_KEYSTROKES_RECEIVED', deviceId: id });
    } catch (e) {
      console.error('Error saving Keystrokes:', e);
    }
  }
  res.json({ success: true });
});

app.get('/api/devices/:id/keystrokes', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM keystrokes WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200', [id]);
      res.json(result.rows);
    } else {
      res.json(db.getMemoryStore().keystrokes.filter(k => k.device_id === id));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// PERMISSIONS
// ==========================================
app.get('/api/devices/:id/permissions', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM device_permissions WHERE device_id = $1', [id]);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        res.json({
          location: row.location,
          notificationAccess: row.notification_access,
          filesAccess: row.files_access,
          camera: row.camera,
          microphone: row.microphone,
          usageAccess: row.usage_access,
          screenSharing: row.screen_sharing,
          contacts: row.contacts || false,
          calls: row.calls || false,
          sms: row.sms || false
        });
      } else {
        res.json({
          location: false,
          notificationAccess: false,
          filesAccess: false,
          camera: false,
          microphone: false,
          usageAccess: false,
          screenSharing: false,
          contacts: false,
          calls: false,
          sms: false
        });
      }
    } else {
      const perms = db.getMemoryStore().device_permissions.get(id) || {
        location: false,
        notificationAccess: false,
        filesAccess: false,
        camera: false,
        microphone: false,
        usageAccess: false,
        screenSharing: false,
        contacts: false,
        calls: false,
        sms: false
      };
      res.json(perms);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/devices/:id/permissions', async (req, res) => {
  const { id } = req.params;
  const perms = req.body;

  try {
    if (db.isPostgres()) {
      await db.query(
        `INSERT INTO device_permissions (device_id, location, notification_access, files_access, camera, microphone, usage_access, screen_sharing, contacts, calls, sms, accessibility, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
         ON CONFLICT (device_id) DO UPDATE SET
          location = $2, notification_access = $3, files_access = $4, camera = $5, microphone = $6, usage_access = $7, screen_sharing = $8,
          contacts = $9, calls = $10, sms = $11, accessibility = $12, updated_at = CURRENT_TIMESTAMP`,
        [
          id, 
          perms.location, 
          perms.notificationAccess || false, 
          perms.filesAccess || false, 
          perms.camera || false, 
          perms.microphone || false, 
          perms.usageAccess || false, 
          perms.screenSharing || false, 
          perms.contacts || false, 
          perms.calls || false, 
          perms.sms || false,
          perms.accessibility || false
        ]
      );
    } else {
      db.getMemoryStore().device_permissions.set(id, perms);
    }

    wsManager.broadcastToDashboards({
      type: 'DEVICE_PERMISSIONS_UPDATED',
      deviceId: id,
      permissions: perms
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// COMMAND DISPATCH SYSTEM
// ==========================================
app.post('/api/devices/:id/commands', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { commandType, parameters } = req.body;

  if (!commandType) {
    return res.status(400).json({ error: 'commandType required' });
  }

  const commandId = 'cmd_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);
  const now = Date.now();

  const command = {
    commandId,
    deviceId: id,
    commandType,
    parameters: parameters || {},
    status: 'PENDING',
    timestamp: now
  };

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO commands (id, device_id, user_id, command_type, parameters, status, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [commandId, id, req.user.id, commandType, JSON.stringify(parameters || {}), 'PENDING', now]
    );
  } else {
    db.getMemoryStore().commands.set(commandId, {
      ...command,
      user_id: req.user.id
    });
  }

  logAudit(req.user.id, id, 'DISPATCH_COMMAND', { commandType, commandId }, req.ip);

  // Send directly via WebSocket to device
  const dispatched = wsManager.sendCommandToDevice(id, command);

  res.json({
    commandId,
    status: 'PENDING',
    dispatchedToOnlineDevice: dispatched
  });
});

app.get('/api/devices/:id/commands', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT * FROM commands WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 50',
      [id]
    );
    res.json(result.rows);
  } else {
    const list = Array.from(db.getMemoryStore().commands.values())
      .filter(c => c.deviceId === id || c.device_id === id)
      .sort((a, b) => b.timestamp - a.timestamp);
    res.json(list);
  }
});

app.post('/api/devices/:id/commands/:commandId/status', async (req, res) => {
  const { id, commandId } = req.params;
  const { status: rawStatus, result, errorMessage } = req.body;
  const status = normalizeCommandStatus(rawStatus);
  if (!status) return res.status(400).json({ success: false, error: 'Unsupported command status' });
  const now = Date.now();
  let command = null;

  if (db.isPostgres()) {
    const found = await db.query('SELECT id, device_id, status FROM commands WHERE id = $1 AND device_id = $2 LIMIT 1', [commandId, id]);
    command = found.rows[0];
    if (!command) return res.status(404).json({ success: false, error: 'Command not found for this device' });
    if (!canAdvanceCommandStatus(command.status, status)) {
      return res.status(409).json({ success: false, error: 'Invalid command status transition', currentStatus: normalizeCommandStatus(command.status), requestedStatus: status });
    }
    const completedAt = isTerminalCommandStatus(status) ? now : null;
    await db.query(
      'UPDATE commands SET status = $1, result = $2, error_message = $3, completion_timestamp = $4 WHERE id = $5 AND device_id = $6',
      [status, result ?? null, errorMessage ?? null, completedAt, commandId, id]
    );
  } else {
    const store = db.getMemoryStore();
    command = store.commands.get(commandId);
    if (!command || (command.deviceId !== id && command.device_id !== id)) {
      return res.status(404).json({ success: false, error: 'Command not found for this device' });
    }
    if (!canAdvanceCommandStatus(command.status, status)) {
      return res.status(409).json({ success: false, error: 'Invalid command status transition', currentStatus: normalizeCommandStatus(command.status), requestedStatus: status });
    }
    command.status = status;
    if (result !== undefined) command.result = result;
    if (errorMessage !== undefined) command.error_message = errorMessage;
    command.completion_timestamp = isTerminalCommandStatus(status) ? now : null;
  }

  wsManager.broadcastToDashboards({
    type: 'COMMAND_STATUS_UPDATED', deviceId: id, commandId, status,
    result: result ?? null, errorMessage: errorMessage ?? null, timestamp: now
  });
  return res.json({ success: true, commandId, status });
});

// ==========================================
// AUDIO & FILE UPLOADS
// ==========================================
app.post('/api/devices/:id/recordings', upload.single('file'), async (req, res) => {
  const { id } = req.params;
  const durationMs = parseInt(req.body.durationMs) || 0;
  if (!req.file) {
    return res.status(400).json({ error: 'File required' });
  }

  const recording = {
    id: Date.now(),
    device_id: id,
    file_name: req.file.filename,
    file_path: `/uploads/${req.file.filename}`,
    duration_ms: durationMs,
    created_at: new Date()
  };

  if (db.isPostgres()) {
    await db.query(
      'INSERT INTO recordings (device_id, file_name, file_path, duration_ms) VALUES ($1, $2, $3, $4)',
      [id, recording.file_name, recording.file_path, durationMs]
    );
  } else {
    db.getMemoryStore().recordings.unshift(recording);
  }

  wsManager.broadcastToDashboards({
    type: 'DEVICE_RECORDING_UPLOADED',
    deviceId: id,
    recording
  });

  res.json({ success: true, recording });
});

app.get('/api/devices/:id/recordings', verifyToken, async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM recordings WHERE device_id = $1 ORDER BY created_at DESC', [id]);
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().recordings.filter(r => r.device_id === id));
  }
});

// Generic file upload endpoint
app.post('/api/devices/:id/upload-file', upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const webPath = `/uploads/${req.file.filename}`;
    const targetPath = req.body.targetPath;

    if (targetPath) {
      const filesStore = db.getMemoryStore().files;
      const fileEntry = filesStore.find(f => f.device_id === id && f.file_path === targetPath);
      if (fileEntry) {
        fileEntry.web_path = webPath;
      }
    }
    res.json({ success: true, webPath });
  } catch (e) {
    console.error('Error in upload-file:', e);
    res.status(500).json({ error: e.message });
  }
});

// ==========================================
// GEOFENCING API
// ==========================================
app.get('/api/devices/:id/geofences', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM geofences WHERE device_id = $1 OR device_id IS NULL ORDER BY created_at DESC', [id]);
      res.json(result.rows);
    } else {
      const list = (db.getMemoryStore().geofences || []).filter(g => !g.device_id || g.device_id === id);
      res.json(list);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/devices/:id/geofences', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude, radiusMeters, isActive } = req.body;
  const rad = Number(radiusMeters) || 500;
  const active = isActive !== false;

  try {
    if (db.isPostgres()) {
      const result = await db.query(
        `INSERT INTO geofences (device_id, name, latitude, longitude, radius_meters, is_active, last_status)
         VALUES ($1, $2, $3, $4, $5, $6, 'UNKNOWN') RETURNING *`,
        [id, name || 'Designated Zone', Number(latitude), Number(longitude), rad, active]
      );
      wsManager.broadcastToDashboards({
        type: 'GEOFENCES_UPDATED',
        deviceId: id
      });
      res.json({ success: true, geofence: result.rows[0] });
    } else {
      const item = {
        id: Date.now(),
        device_id: id,
        name: name || 'Designated Zone',
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius_meters: rad,
        is_active: active,
        last_status: 'UNKNOWN',
        created_at: new Date()
      };
      db.getMemoryStore().geofences.push(item);
      wsManager.broadcastToDashboards({
        type: 'GEOFENCES_UPDATED',
        deviceId: id
      });
      res.json({ success: true, geofence: item });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/devices/:id/geofences/:geofenceId', verifyToken, async (req, res) => {
  const { id, geofenceId } = req.params;
  try {
    if (db.isPostgres()) {
      await db.query('DELETE FROM geofences WHERE id = $1 AND (device_id = $2 OR device_id IS NULL)', [geofenceId, id]);
    } else {
      const list = db.getMemoryStore().geofences;
      const idx = list.findIndex(g => String(g.id) === String(geofenceId));
      if (idx !== -1) list.splice(idx, 1);
    }
    wsManager.broadcastToDashboards({
      type: 'GEOFENCES_UPDATED',
      deviceId: id
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// DATA USAGE API
// ==========================================
app.post('/api/devices/:id/data-usage', async (req, res) => {
  const { id } = req.params;
  const { wifiRx, wifiTx, mobileRx, mobileTx } = req.body;
  try {
    if (db.isPostgres()) {
      await db.query(
        `INSERT INTO data_usage (device_id, wifi_bytes_rx, wifi_bytes_tx, mobile_bytes_rx, mobile_bytes_tx)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, wifiRx || 0, wifiTx || 0, mobileRx || 0, mobileTx || 0]
      );
    } else {
      db.getMemoryStore().data_usage.unshift({
        device_id: id,
        wifi_bytes_rx: wifiRx || 0,
        wifi_bytes_tx: wifiTx || 0,
        mobile_bytes_rx: mobileRx || 0,
        mobile_bytes_tx: mobileTx || 0,
        recorded_at: new Date()
      });
    }
    wsManager.broadcastToDashboards({
      type: 'DATA_USAGE_UPDATED',
      deviceId: id,
      dataUsage: { wifiRx, wifiTx, mobileRx, mobileTx }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/devices/:id/data-usage', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM data_usage WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 30', [id]);
      res.json(result.rows);
    } else {
      const list = (db.getMemoryStore().data_usage || []).filter(d => d.device_id === id).slice(0, 30);
      res.json(list);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// SERVICE HEALTH API
// ==========================================
app.post('/api/devices/:id/service-health', async (req, res) => {
  const { id } = req.params;
  const health = req.body; // { notificationMonitor, locationService, telemetryCollector, usageTracker, webSocket, foregroundService, lastSync }
  
  db.getMemoryStore().service_health.set(id, {
    ...health,
    updatedAt: new Date()
  });

  wsManager.broadcastToDashboards({
    type: 'SERVICE_HEALTH_UPDATED',
    deviceId: id,
    serviceHealth: health
  });

  res.json({ success: true });
});

app.get('/api/devices/:id/service-health', verifyToken, async (req, res) => {
  const { id } = req.params;
  const health = db.getMemoryStore().service_health.get(id) || {
    notificationMonitor: 'RUNNING',
    locationService: 'RUNNING',
    telemetryCollector: 'RUNNING',
    usageTracker: 'RUNNING',
    webSocket: 'RUNNING',
    foregroundService: 'RUNNING',
    updatedAt: new Date()
  };
  res.json(health);
});

// ==========================================
// AUDIT & ALERTS
// ==========================================
app.get('/api/audit', verifyToken, async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100');
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().audit_logs.slice(0, 100));
  }
});

app.post('/api/devices/:id/alerts', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { alertType, severity, title, message } = req.body;
  
  const alertItem = {
    id: Date.now(),
    device_id: id,
    alert_type: alertType || 'SECURITY_ALERT',
    severity: severity || 'WARNING',
    title: title || 'System Alert',
    message: message || 'Alert triggered',
    created_at: new Date()
  };

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO alerts (device_id, alert_type, severity, title, message)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, alertItem.alert_type, alertItem.severity, alertItem.title, alertItem.message]
    );
  } else {
    db.getMemoryStore().alerts.unshift(alertItem);
  }

  wsManager.broadcastToDashboards({
    type: 'NEW_ALERT',
    deviceId: id,
    alert: alertItem
  });

  res.json({ success: true, alert: alertItem });
});

app.get('/api/alerts', verifyToken, async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM alerts ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().alerts.slice(0, 50));
  }
});

// Catch-all for single-page application routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
    return res.status(404).json({ error: 'Not found' });
  }
  const primaryIndex = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(primaryIndex)) {
    return res.sendFile(primaryIndex);
  }
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Device Management Backend running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoints: ws://0.0.0.0:${PORT}/ws/device & ws://0.0.0.0:${PORT}/ws/dashboard`);
});
