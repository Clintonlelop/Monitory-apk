import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import { initDb, db } from './db.js';
import { setupWebSocket } from './ws.js';
import { generateToken, verifyToken, verifyJwt, hashPassword, comparePassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const PORT = process.env.APP_PORT || process.env.PORT || process.env.DEFAULT_APP_PORT || 3000;
const MAX_UPLOAD_SIZE_MB = Number(process.env.MAX_UPLOAD_SIZE_MB || 20);

// Setup Uploads directory
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE_MB * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    if (!file.mimetype) return cb(new Error('Invalid file type'));
    cb(null, true);
  }
});

const requestBuckets = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const bucket = requestBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    bucket.count += 1;
    requestBuckets.set(key, bucket);
    if (bucket.count > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please retry shortly.' });
    }
    next();
  };
}

const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:8080')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);

// Middlewares
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS policy'));
  }
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/api', rateLimit(300, 60 * 1000));
const protectedRouteLimit = rateLimit(120, 60 * 1000);

// Serve static dashboard files
app.use(express.static(path.join(__dirname, '..', 'public')));
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

function verifyDeviceToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Device authorization required' });
  }
  try {
    const decoded = verifyJwt(authHeader.split(' ')[1]);
    if (decoded.type !== 'device') {
      return res.status(403).json({ error: 'Device token required' });
    }
    if (req.params.id && decoded.deviceId !== req.params.id) {
      return res.status(403).json({ error: 'Token is not valid for this device' });
    }
    req.device = decoded;
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function hasUserDeviceAccess(userId, deviceId) {
  if (db.isPostgres()) {
    const result = await db.query('SELECT user_id FROM devices WHERE id = $1', [deviceId]);
    const row = result.rows[0];
    if (!row) return { exists: false, allowed: false };
    return { exists: true, allowed: Number(row.user_id) === Number(userId) };
  }

  const device = db.getMemoryStore().devices.get(deviceId);
  if (!device) return { exists: false, allowed: false };
  return { exists: true, allowed: Number(device.user_id) === Number(userId) };
}

async function ensureUserOwnsDevice(req, res, next) {
  const { id } = req.params;
  try {
    const access = await hasUserDeviceAccess(req.user.id, id);
    if (!access.exists) return res.status(404).json({ error: 'Device not found' });
    if (!access.allowed) {
      return res.status(403).json({ error: 'Not authorized for this device' });
    }
    next();
  } catch (err) {
    next(err);
  }
}

// ==========================================
// HEALTH & METRICS
// ==========================================
app.get('/health', (req, res) => {
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
app.post('/api/auth/register', rateLimit(20, 5 * 60 * 1000), async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email and password required' });
  }

  try {
    const hashed = await hashPassword(password);
    let userId;

    if (db.isPostgres()) {
      const result = await db.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, role',
        [username, email, hashed]
      );
      userId = result.rows[0].id;
    } else {
      const store = db.getMemoryStore();
      const existing = store.users.find(u => u.email === email || u.username === username);
      if (existing) {
        return res.status(400).json({ error: 'User already exists' });
      }
      userId = store.users.length + 1;
      store.users.push({
        id: userId,
        username,
        email,
        password_hash: hashed,
        role: 'admin',
        created_at: new Date()
      });
    }

    const token = generateToken({ id: userId, username, email, role: 'admin' });
    res.json({ token, user: { id: userId, username, email, role: 'admin' } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'User already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', rateLimit(30, 5 * 60 * 1000), async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    let user;
    if (db.isPostgres()) {
      const result = await db.query('SELECT * FROM users WHERE email = $1 OR username = $1', [email]);
      user = result.rows[0];
    } else {
      user = db.getMemoryStore().users.find(u => u.email === email || u.username === email);
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = generateToken({ id: user.id, username: user.username, email: user.email, role: user.role });
    logAudit(user.id, null, 'LOGIN', { email }, req.ip);

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json({ user: req.user });
});

// ==========================================
// PAIRING SYSTEM
// ==========================================
// Admin generates a 6-digit code for device pairing
app.post('/api/devices/pair-code', verifyToken, rateLimit(30, 5 * 60 * 1000), async (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
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

  logAudit(req.user.id, null, 'GENERATE_PAIRING_CODE', { code }, req.ip);
  res.json({ code, expiresAt });
});

// Android device submits pairing code
app.post('/api/devices/pair', rateLimit(30, 5 * 60 * 1000), async (req, res) => {
  const { pairingCode, deviceName, manufacturer, model, osVersion } = req.body;
  if (!pairingCode) {
    return res.status(400).json({ success: false, message: 'Pairing code is required' });
  }

  let validPairing = null;
  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT * FROM pairing_codes WHERE code = $1 AND used = FALSE AND expires_at > CURRENT_TIMESTAMP',
      [pairingCode]
    );
    if (result.rows.length > 0) {
      validPairing = result.rows[0];
      await db.query('UPDATE pairing_codes SET used = TRUE WHERE id = $1', [validPairing.id]);
    }
  } else {
    const entry = db.getMemoryStore().pairing_codes.get(pairingCode);
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
app.post('/api/devices/register-device', verifyToken, protectedRouteLimit, async (req, res) => {
  const { deviceName, manufacturer, model, osVersion, sdkVersion, appVersion } = req.body;
  const userId = req.user.id;

  const deviceId = 'dev_' + Math.random().toString(36).substring(2, 10);
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
app.get('/api/devices', verifyToken, protectedRouteLimit, async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT id, device_name, manufacturer, model, os_version, app_version, status, battery_level, is_charging, network_type, last_seen, created_at FROM devices WHERE user_id = $1 ORDER BY last_seen DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } else {
    const devices = Array.from(db.getMemoryStore().devices.values())
      .filter(device => Number(device.user_id) === Number(req.user.id));
    res.json(devices);
  }
});

app.get('/api/devices/:id', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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

app.delete('/api/devices/:id', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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

app.delete('/api/devices/:id/disconnect', verifyToken, protectedRouteLimit, async (req, res) => {
  const { id } = req.params;
  const isDeviceCaller = req.user?.type === 'device';
  if (isDeviceCaller && req.user.deviceId !== id) {
    return res.status(403).json({ error: 'Token is not valid for this device' });
  }
  if (!isDeviceCaller) {
    const access = await hasUserDeviceAccess(req.user.id, id);
    if (!access.exists) return res.status(404).json({ error: 'Device not found' });
    if (!access.allowed) return res.status(403).json({ error: 'Not authorized for this device' });
  }
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
app.post('/api/devices/:id/telemetry', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
  const { id } = req.params;
  const telemetry = req.body;
  const now = new Date();

  if (db.isPostgres()) {
    await db.query(
      `UPDATE devices SET 
        device_name = COALESCE($1, device_name),
        manufacturer = COALESCE($2, manufacturer),
        model = COALESCE($3, model),
        os_version = COALESCE($4, os_version),
        sdk_version = COALESCE($5, sdk_version),
        app_version = COALESCE($6, app_version),
        battery_level = $7,
        is_charging = $8,
        storage_available = $9,
        storage_total = $10,
        ram_available = $11,
        ram_total = $12,
        network_type = $13,
        wifi_ssid = $14,
        uptime_millis = $15,
        status = 'ONLINE',
        last_seen = $16
      WHERE id = $17`,
      [
        telemetry.deviceName,
        telemetry.manufacturer,
        telemetry.model,
        telemetry.osVersion,
        telemetry.sdkVersion,
        telemetry.appVersion,
        telemetry.batteryLevel,
        telemetry.isCharging,
        telemetry.storageAvailableBytes,
        telemetry.storageTotalBytes,
        telemetry.ramAvailableBytes,
        telemetry.ramTotalBytes,
        telemetry.networkType,
        telemetry.wifiSsid,
        telemetry.uptimeMillis,
        now,
        id
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
app.post('/api/devices/:id/location', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
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

  wsManager.broadcastToDashboards({
    type: 'DEVICE_LOCATION_UPDATED',
    deviceId: id,
    location: { latitude, longitude, accuracy, altitude, speed, timestamp: timestamp || Date.now() }
  });

  res.json({ success: true });
});

app.get('/api/devices/:id/locations', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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
app.post('/api/devices/:id/notifications', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
  const { id } = req.params;
  const notif = req.body;

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO notifications (id, device_id, package_name, app_name, title, text, category, post_time)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [notif.id || Date.now().toString(), id, notif.packageName, notif.appName, notif.title, notif.text, notif.category, notif.postTime || Date.now()]
    );
  } else {
    db.getMemoryStore().notifications.unshift({
      id: notif.id || Date.now().toString(),
      device_id: id,
      package_name: notif.packageName,
      app_name: notif.appName,
      title: notif.title,
      text: notif.text,
      category: notif.category,
      post_time: notif.postTime || Date.now(),
      created_at: new Date()
    });
  }

  wsManager.broadcastToDashboards({
    type: 'DEVICE_NOTIFICATION_RECEIVED',
    deviceId: id,
    notification: notif
  });

  res.json({ success: true });
});

app.get('/api/devices/:id/notifications', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
  const { id } = req.params;
  const search = (req.query.search || '').trim();
  const appPackage = (req.query.appPackage || '').trim();
  const startTime = Number(req.query.startTime || 0);
  const endTime = Number(req.query.endTime || 0);
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  if (db.isPostgres()) {
    let query = 'SELECT * FROM notifications WHERE device_id = $1';
    const params = [id];
    let nextParam = 2;
    if (search) {
      query += ` AND (title ILIKE $${nextParam} OR text ILIKE $${nextParam} OR app_name ILIKE $${nextParam})`;
      params.push(`%${search}%`);
      nextParam += 1;
    }
    if (appPackage) {
      query += ` AND package_name = $${nextParam}`;
      params.push(appPackage);
      nextParam += 1;
    }
    if (startTime > 0) {
      query += ` AND post_time >= $${nextParam}`;
      params.push(startTime);
      nextParam += 1;
    }
    if (endTime > 0) {
      query += ` AND post_time <= $${nextParam}`;
      params.push(endTime);
      nextParam += 1;
    }
    query += ` ORDER BY post_time DESC LIMIT $${nextParam} OFFSET $${nextParam + 1}`;
    params.push(limit, offset);
    const result = await db.query(query, params);
    res.json(result.rows);
  } else {
    let list = db.getMemoryStore().notifications.filter(n => n.device_id === id);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(n => (n.title && n.title.toLowerCase().includes(s)) || (n.text && n.text.toLowerCase().includes(s)) || (n.app_name && n.app_name.toLowerCase().includes(s)));
    }
    if (appPackage) {
      list = list.filter(n => n.package_name === appPackage);
    }
    if (startTime > 0) {
      list = list.filter(n => Number(n.post_time) >= startTime);
    }
    if (endTime > 0) {
      list = list.filter(n => Number(n.post_time) <= endTime);
    }
    list = list.sort((a, b) => Number(b.post_time) - Number(a.post_time));
    res.json(list.slice(offset, offset + limit));
  }
});

app.delete('/api/devices/:id/notifications/:notifId', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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
app.post('/api/devices/:id/apps', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
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

app.get('/api/devices/:id/apps', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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
app.post('/api/devices/:id/usage', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
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

app.get('/api/devices/:id/usage', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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
// FILES & MEDIA CATALOG
// ==========================================
app.post('/api/devices/:id/files/sync', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
  const { id } = req.params;
  const files = req.body;
  if (!Array.isArray(files)) {
    return res.status(400).json({ error: 'Expected an array of files' });
  }

  if (db.isPostgres()) {
    await db.query('DELETE FROM files WHERE device_id = $1', [id]);
    for (const file of files.slice(0, 500)) {
      await db.query(
        `INSERT INTO files (device_id, file_name, file_path, file_size, mime_type, is_directory, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, TO_TIMESTAMP($7 / 1000.0))`,
        [
          id,
          file.name || 'Unknown',
          file.path || file.name || 'Unknown',
          Number(file.size || 0),
          file.mimeType || null,
          Boolean(file.isDirectory),
          Number(file.modifiedAt || Date.now())
        ]
      );
    }
  } else {
    const store = db.getMemoryStore();
    store.files = store.files.filter(entry => entry.device_id !== id);
    for (const file of files.slice(0, 500)) {
      store.files.push({
        id: Date.now() + Math.floor(Math.random() * 100000),
        device_id: id,
        file_name: file.name || 'Unknown',
        file_path: file.path || file.name || 'Unknown',
        file_size: Number(file.size || 0),
        mime_type: file.mimeType || null,
        is_directory: Boolean(file.isDirectory),
        created_at: new Date(Number(file.modifiedAt || Date.now()))
      });
    }
  }

  wsManager.broadcastToDashboards({
    type: 'DEVICE_FILES_SYNCED',
    deviceId: id,
    count: Math.min(files.length, 500),
    timestamp: Date.now()
  });
  res.json({ success: true, count: Math.min(files.length, 500) });
});

app.get('/api/devices/:id/files', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
  const { id } = req.params;
  const search = (req.query.search || '').trim();
  const type = (req.query.type || 'all').trim().toLowerCase();
  const sortBy = (req.query.sortBy || 'modified').trim().toLowerCase();
  const sortOrder = (req.query.sortOrder || 'desc').trim().toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  if (db.isPostgres()) {
    let query = 'SELECT * FROM files WHERE device_id = $1';
    const params = [id];
    let nextParam = 2;

    if (search) {
      query += ` AND (file_name ILIKE $${nextParam} OR file_path ILIKE $${nextParam})`;
      params.push(`%${search}%`);
      nextParam += 1;
    }
    if (type === 'images') {
      query += " AND mime_type ILIKE 'image/%'";
    } else if (type === 'videos') {
      query += " AND mime_type ILIKE 'video/%'";
    } else if (type === 'downloads') {
      query += " AND file_path ILIKE '%Download%'";
    }

    const sortColumn = sortBy === 'size' ? 'file_size' : 'created_at';
    query += ` ORDER BY ${sortColumn} ${sortOrder} LIMIT $${nextParam} OFFSET $${nextParam + 1}`;
    params.push(limit, offset);
    const result = await db.query(query, params);
    return res.json(result.rows);
  }

  let list = db.getMemoryStore().files.filter(file => file.device_id === id);
  if (search) {
    const normalized = search.toLowerCase();
    list = list.filter(
      file =>
        String(file.file_name || '').toLowerCase().includes(normalized) ||
        String(file.file_path || '').toLowerCase().includes(normalized)
    );
  }
  if (type === 'images') list = list.filter(file => String(file.mime_type || '').startsWith('image/'));
  if (type === 'videos') list = list.filter(file => String(file.mime_type || '').startsWith('video/'));
  if (type === 'downloads') list = list.filter(file => String(file.file_path || '').toLowerCase().includes('download'));

  list = list.sort((a, b) => {
    const left = sortBy === 'size' ? Number(a.file_size || 0) : new Date(a.created_at).getTime();
    const right = sortBy === 'size' ? Number(b.file_size || 0) : new Date(b.created_at).getTime();
    return sortOrder === 'ASC' ? left - right : right - left;
  });
  return res.json(list.slice(offset, offset + limit));
});

// ==========================================
// PERMISSIONS
// ==========================================
app.put('/api/devices/:id/permissions', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
  const { id } = req.params;
  const perms = req.body;

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO device_permissions (device_id, location, notification_access, files_access, camera, microphone, usage_access, screen_sharing, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
       ON CONFLICT (device_id) DO UPDATE SET
        location = $2, notification_access = $3, files_access = $4, camera = $5, microphone = $6, usage_access = $7, screen_sharing = $8, updated_at = CURRENT_TIMESTAMP`,
      [id, perms.location, perms.notificationAccess, perms.filesAccess, perms.camera, perms.microphone, perms.usageAccess, perms.screenSharing]
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
});

// ==========================================
// COMMAND DISPATCH SYSTEM
// ==========================================
app.post('/api/devices/:id/commands', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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

app.get('/api/devices/:id/commands', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
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

app.get('/api/devices/:id/commands/pending', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query(
      `SELECT id AS "commandId", device_id AS "deviceId", command_type AS "commandType", parameters, status, timestamp
       FROM commands
       WHERE device_id = $1 AND status = 'PENDING'
       ORDER BY timestamp ASC
       LIMIT 50`,
      [id]
    );
    return res.json(result.rows.map(row => ({
      ...row,
      parameters: row.parameters || {}
    })));
  }

  const list = Array.from(db.getMemoryStore().commands.values())
    .filter(command => (command.deviceId === id || command.device_id === id) && command.status === 'PENDING')
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(0, 50);
  res.json(list);
});

app.post('/api/devices/:id/commands/:commandId/status', verifyDeviceToken, protectedRouteLimit, async (req, res) => {
  const { id, commandId } = req.params;
  const { status, result, errorMessage } = req.body;
  const now = Date.now();

  if (db.isPostgres()) {
    await db.query(
      'UPDATE commands SET status = $1, result = $2, error_message = $3, completion_timestamp = $4 WHERE id = $5 AND device_id = $6',
      [status, result || null, errorMessage || null, now, commandId, id]
    );
  } else {
    const cmd = db.getMemoryStore().commands.get(commandId);
    if (cmd) {
      cmd.status = status;
      cmd.result = result;
      cmd.errorMessage = errorMessage;
      cmd.completion_timestamp = now;
    }
  }

  wsManager.broadcastToDashboards({
    type: 'COMMAND_STATUS_UPDATED',
    deviceId: id,
    commandId,
    status,
    result,
    errorMessage,
    timestamp: now
  });

  res.json({ success: true });
});

// ==========================================
// AUDIO & FILE UPLOADS
// ==========================================
app.post('/api/devices/:id/recordings', verifyDeviceToken, protectedRouteLimit, upload.single('file'), async (req, res) => {
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

app.get('/api/devices/:id/recordings', verifyToken, protectedRouteLimit, ensureUserOwnsDevice, async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM recordings WHERE device_id = $1 ORDER BY created_at DESC', [id]);
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().recordings.filter(r => r.device_id === id));
  }
});

// ==========================================
// AUDIT & ALERTS
// ==========================================
app.get('/api/audit', verifyToken, protectedRouteLimit, async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query(
      `SELECT a.*
       FROM audit_logs a
       LEFT JOIN devices d ON d.id = a.device_id
       WHERE a.user_id = $1 OR d.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 100`,
      [req.user.id]
    );
    res.json(result.rows);
  } else {
    const store = db.getMemoryStore();
    const logs = store.audit_logs.filter(log => {
      if (Number(log.user_id) === Number(req.user.id)) return true;
      if (!log.device_id) return false;
      const device = store.devices.get(log.device_id);
      return Number(device?.user_id) === Number(req.user.id);
    });
    res.json(logs.slice(0, 100));
  }
});

app.get('/api/alerts', verifyToken, protectedRouteLimit, async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query(
      `SELECT a.*
       FROM alerts a
       JOIN devices d ON d.id = a.device_id
       WHERE d.user_id = $1
       ORDER BY a.created_at DESC
       LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } else {
    const store = db.getMemoryStore();
    const alerts = store.alerts.filter(alert => {
      const device = store.devices.get(alert.device_id);
      return Number(device?.user_id) === Number(req.user.id);
    });
    res.json(alerts.slice(0, 50));
  }
});

// Catch-all for single-page application routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  next();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Upload too large. Max size is ${MAX_UPLOAD_SIZE_MB}MB.` });
  }
  if (err?.message?.includes('CORS')) {
    return res.status(403).json({ error: err.message });
  }
  const status = err.statusCode || 500;
  const message = status >= 500 ? 'Server temporarily unavailable' : (err.message || 'Request failed');
  if (status >= 500) {
    console.error('Unhandled server error:', err);
  }
  return res.status(status).json({ error: message });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Device Management Backend running on http://0.0.0.0:${PORT}`);
  console.log(`WebSocket endpoints: ws://0.0.0.0:${PORT}/ws/device & ws://0.0.0.0:${PORT}/ws/dashboard`);
});
