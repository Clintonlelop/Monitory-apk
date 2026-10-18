import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import cors from 'cors';
import multer from 'multer';
import { initDb, db, countUsers, createUser, findUserByIdentifier, userExists } from './db.js';
import { setupWebSocket } from './ws.js';
import {
  requireUser, verifyToken, requireDevice, verifyTokenString,
  generateUserToken, generateDeviceToken,
  hashPassword, comparePassword, comparePasswordDummy
} from './auth.js';
import { createRateLimiter, allowAttempt } from './rate-limit.js';
import {
  STATUS as CMD_STATUS,
  TERMINAL_STATUSES,
  DEVICE_REPORTABLE_STATUSES,
  ALLOWED_COMMAND_TYPES,
  normalizeStatus,
  canTransition,
  validateAndNormalizeParams,
  coerceParamsToStrings,
  ttlMsFor,
  getCommandSpec
} from './commands.js';
import QRCode from 'qrcode';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('uncaughtException', (err) => {
  console.error('[Server Error] Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server Error] Unhandled rejection:', reason);
});

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);
const PORT = process.env.PORT || process.env.DEFAULT_APP_PORT || process.env.APP_PORT || 3000;

// ==========================================
// UPLOADS (private store + authorized downloads)
// ==========================================
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const BLOCKED_MIME = /^(text\/html|image\/svg\+xml|application\/javascript|application\/xhtml|text\/javascript)/i;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Server-side generated names: random, traversal-safe, extension preserved.
    const ext = path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12);
    cb(null, `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 20 },
  fileFilter: (req, file, cb) => {
    if (BLOCKED_MIME.test(file.mimetype || '')) {
      return cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Unsupported file type'));
    }
    cb(null, true);
  }
});

// ==========================================
// MIDDLEWARE
// ==========================================
const corsOrigins = (process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors(corsOrigins.length > 0 ? { origin: corsOrigins } : { origin: false }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Baseline security headers (no external dependency).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " + // 'unsafe-inline' kept for legacy inline handlers (documented residual risk)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; " +
    "font-src 'self' https://fonts.gstatic.com; " +
    "img-src 'self' data: blob: https://*.tile.openstreetmap.org; " +
    "media-src 'self' blob:; " +
    "connect-src 'self' ws: wss:; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  res.removeHeader('X-Powered-By');
  next();
});

// Serve static dashboard files (never /uploads — downloads are authorized below)
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Initialize Database & WebSockets
await initDb();
const wsManager = setupWebSocket(server);

// ==========================================
// RATE LIMITERS
// ==========================================
const authLimiter = createRateLimiter({ name: 'auth', windowMs: 15 * 60 * 1000, max: 50 });
const pairingLimiter = createRateLimiter({ name: 'pairing', windowMs: 10 * 60 * 1000, max: 30 });
const ingestLimiter = createRateLimiter({ name: 'ingest', windowMs: 60 * 1000, max: 240 });

// ==========================================
// HELPERS
// ==========================================

// Wrap async handlers so rejections become JSON 500s instead of hung requests.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((err) => {
  console.error('[Server Error]', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Internal server error' });
});

function sanitizeDevice(device) {
  if (!device) return device;
  const clone = { ...device };
  delete clone.auth_token;
  delete clone.password_hash;
  return clone;
}

function sanitizeUser(user) {
  if (!user) return user;
  return { id: user.id, username: user.username, email: user.email, role: user.role };
}

/** Normalize an arbitrary string for storage as metadata (defense in depth). */
function cleanMeta(value, maxLen = 255) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/[\u0000-\u001f\u007f<>]/g, '').slice(0, maxLen);
}

function asInt(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function findDeviceForUser(deviceId, userId) {
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    const dev = result.rows[0];
    return dev && String(dev.user_id) === String(userId) ? dev : null;
  }
  const dev = db.getMemoryStore().devices.get(deviceId);
  return dev && String(dev.user_id) === String(userId) ? dev : null;
}

/**
 * Authorization for device-scoped data ingestion:
 * - the device itself (device JWT whose deviceId matches :id), or
 * - the user who owns the device.
 */
const deviceDataAuth = ah(async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Format is: Bearer <token>' });
  }
  const decoded = verifyTokenString(authHeader.slice(7));
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const deviceId = req.params.id;
  if (decoded.type === 'device') {
    if (!decoded.deviceId || decoded.deviceId !== deviceId) {
      return res.status(403).json({ error: 'Device token does not match the requested device' });
    }
    req.device = decoded;
    req.deviceId = deviceId;
    return next();
  }
  const dev = await findDeviceForUser(deviceId, decoded.id);
  if (!dev) {
    return res.status(404).json({ error: 'Device not found' });
  }
  req.user = decoded;
  return next();
});

/** Admin read/write access to a device the user owns (device tokens rejected). */
const requireDeviceOwner = ah(async (req, res, next) => {
  const deviceId = req.params.id;
  const dev = await findDeviceForUser(deviceId, req.user.id);
  if (!dev) {
    return res.status(404).json({ error: 'Device not found' });
  }
  req.deviceRecord = dev;
  return next();
});

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
    console.error('Audit log error:', e.message);
  }
}

// ==========================================
// HEALTH & METRICS
// ==========================================
const healthHandler = (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    postgres: db.isPostgres(),
    api: 'ok',
    database: 'ok',
    activeDevices: wsManager.deviceSockets.size,
    activeDashboards: wsManager.dashboardSockets.size
  });
};
app.get(['/health', '/api/health', '/v1/health', '/api/v1/health', '/healthcheck', '/status', '/api'], healthHandler);

// ==========================================
// AUTHENTICATION ROUTES
// ==========================================
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validateRegistration({ username, email, password }, res) {
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password required' });
    return false;
  }
  if (!EMAIL_RE.test(email) || email.length > 255) {
    res.status(400).json({ error: 'A valid email address is required' });
    return false;
  }
  if (username && !USERNAME_RE.test(username)) {
    res.status(400).json({ error: 'Username must be 3-32 characters: letters, numbers, dot, dash, underscore' });
    return false;
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return false;
  }
  return true;
}

// One-time first-administrator bootstrap. Only works while ZERO users exist;
// permanently disabled afterwards. Never recreates default credentials.
app.post('/api/auth/bootstrap', authLimiter, ah(async (req, res) => {
  const existing = await countUsers();
  if (existing > 0) {
    return res.status(403).json({ error: 'Bootstrap is only available on a fresh instance with no users' });
  }
  const { username, email, password } = req.body;
  if (!validateRegistration({ username, email, password }, res)) return;

  const name = username || email.split('@')[0];
  const user = await createUser({ username: name, email, password, role: 'admin' });
  const token = generateUserToken(user);
  logAudit(user.id, null, 'BOOTSTRAP_ADMIN', { email }, req.ip);
  res.json({ token, user: sanitizeUser(user) });
}));

app.post('/api/auth/register', authLimiter, ah(async (req, res) => {
  const { username, email, password } = req.body;
  if (!validateRegistration({ username, email, password }, res)) return;
  const name = username || email.split('@')[0];

  // Reject duplicates — registration must NEVER modify an existing account.
  if (await userExists({ username: name, email })) {
    return res.status(409).json({ error: 'Username or email is already registered' });
  }

  let user;
  try {
    user = await createUser({ username: name, email, password, role: 'admin' });
  } catch (err) {
    // Unique-constraint race: surface a clean 409, never raw driver errors.
    if (String(err.code) === '23505' || /unique|duplicate/i.test(String(err.message))) {
      return res.status(409).json({ error: 'Username or email is already registered' });
    }
    throw err;
  }

  const token = generateUserToken(user);
  logAudit(user.id, null, 'REGISTER', { email, username: name }, req.ip);
  res.json({ token, user: sanitizeUser(user) });
}));

app.post('/api/auth/login', authLimiter, ah(async (req, res) => {
  const identifier = req.body.email || req.body.identifier || req.body.username;
  const password = req.body.password;
  if (!identifier || !password) {
    return res.status(400).json({ error: 'Email/username and password required' });
  }

  const user = await findUserByIdentifier(String(identifier));

  if (!user) {
    // Equalize timing with the invalid-password path; do NOT auto-register.
    await comparePasswordDummy(String(password));
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const valid = await comparePassword(String(password), user.password_hash);
  if (!valid) {
    // An incorrect password must never change the stored password.
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateUserToken(user);
  logAudit(user.id, null, 'LOGIN', { identifier: String(identifier).slice(0, 255) }, req.ip);

  res.json({ token, user: sanitizeUser(user) });
}));

app.get('/api/auth/me', verifyToken, (req, res) => {
  // Device tokens are not user sessions.
  if (req.user && req.user.type === 'device') {
    return res.status(403).json({ error: 'User authentication required' });
  }
  res.json({ user: req.user });
});

// ==========================================
// PAIRING SYSTEM & SERVER CONFIGURATION
// ==========================================

// Dynamic server URLs from the request. The protocol is taken from what the
// client actually used (direct or via x-forwarded-proto); HTTPS/WSS is NOT
// forced on plain-HTTP hosts (that previously broke LAN deployments).
function getHostUrls(req, customUrlOverride = null) {
  const customUrl = customUrlOverride || req?.body?.serverUrl || req?.body?.customServerUrl || req?.query?.customServerUrl || process.env.PUBLIC_SERVER_URL || process.env.SERVER_BASE_URL;

  if (customUrl && typeof customUrl === 'string' && customUrl.trim().length > 0) {
    let formatted = customUrl.trim().replace(/\/$/, '');
    if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
      formatted = 'https://' + formatted;
    }
    const isHttps = formatted.startsWith('https://');
    const hostOnly = formatted.replace(/^https?:\/\//, '');
    const wsProto = isHttps ? 'wss' : 'ws';
    return {
      serverUrl: formatted,
      wsUrl: `${wsProto}://${hostOnly}/ws/device`
    };
  }

  const host = String(req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`).split(',')[0].trim();
  const rawProto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0].trim().toLowerCase();
  const isHttps = rawProto === 'https' || req.secure === true;

  const protocol = isHttps ? 'https' : 'http';
  const wsProtocol = isHttps ? 'wss' : 'ws';

  return {
    serverUrl: `${protocol}://${host}`,
    wsUrl: `${wsProtocol}://${host}/ws/device`
  };
}

app.get(['/api/server/config', '/api/config'], (req, res) => {
  const { serverUrl, wsUrl } = getHostUrls(req);
  res.json({
    status: 'healthy',
    serverUrl,
    wsUrl,
    environment: process.env.NODE_ENV || 'production',
    postgres: db.isPostgres(),
    activeDevices: wsManager.deviceSockets.size,
    activeDashboards: wsManager.dashboardSockets.size
  });
});

// Admin generates a 6-digit code and scannable QR payload for device pairing
// (30-second expiration by default; PAIRING_TTL_SECONDS overrides for testing).
const PAIRING_TTL_SECONDS = Math.max(1, parseInt(process.env.PAIRING_TTL_SECONDS) || 30);
const generatePairingCodeHandler = ah(async (req, res) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_SECONDS * 1000);
  const environment = cleanMeta(req.body.environment || 'Default VPS', 100);
  const { serverUrl, wsUrl } = getHostUrls(req);

  // Payload keys: `serverUrl`/`wsUrl` for the Android parser (QrPairingPayload),
  // `server`/`ws` kept as aliases for backward compatibility.
  const pairingPayload = {
    v: 1,
    code,
    server: serverUrl,
    ws: wsUrl,
    serverUrl,
    wsUrl,
    expiresAt: expiresAt.toISOString(),
    environment
  };

  let qrDataUrl = '';
  try {
    qrDataUrl = await QRCode.toDataURL(JSON.stringify(pairingPayload), {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 280,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
  } catch (err) {
    console.error('[QR Generation Error]', err.message);
  }

  if (db.isPostgres()) {
    await db.query(
      'INSERT INTO pairing_codes (code, user_id, environment, expires_at) VALUES ($1, $2, $3, $4)',
      [code, req.user.id, environment, expiresAt]
    );
  } else {
    db.getMemoryStore().pairing_codes.set(code, {
      code,
      user_id: req.user.id,
      environment,
      expires_at: expiresAt,
      used: false,
      revoked: false,
      attempts: 0,
      created_at: new Date()
    });
  }

  logAudit(req.user.id, null, 'GENERATE_PAIRING_CODE', { code, environment, expiresAt }, req.ip);
  res.json({
    code,
    expiresAt: expiresAt.toISOString(),
    environment,
    serverUrl,
    wsUrl,
    payload: pairingPayload,
    qrDataUrl
  });
});

app.post('/api/devices/pair-code', requireUser, pairingLimiter, generatePairingCodeHandler);
app.post('/api/pairing/generate', requireUser, pairingLimiter, generatePairingCodeHandler);

const listPairingCodesHandler = ah(async (req, res) => {
  const now = new Date();
  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT id, code, environment, expires_at, used, revoked, device_id, created_at FROM pairing_codes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    const codes = result.rows.map(c => {
      let status = 'ACTIVE';
      if (c.revoked) status = 'REVOKED';
      else if (c.used) status = 'REDEEMED';
      else if (new Date(c.expires_at) < now) status = 'EXPIRED';
      return { ...c, status };
    });
    res.json(codes);
  } else {
    const list = Array.from(db.getMemoryStore().pairing_codes.values())
      .filter(c => c.user_id === req.user.id)
      .map(({ attempts, ...c }) => {
        let status = 'ACTIVE';
        if (c.revoked) status = 'REVOKED';
        else if (c.used) status = 'REDEEMED';
        else if (new Date(c.expires_at) < now) status = 'EXPIRED';
        return { ...c, status };
      })
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    res.json(list);
  }
});

app.get('/api/devices/pair-codes', requireUser, listPairingCodesHandler);
app.get('/api/pairing/codes', requireUser, listPairingCodesHandler);

const revokePairingCodeHandler = ah(async (req, res) => {
  const code = req.params.code || req.body.code;
  if (!code) return res.status(400).json({ error: 'Pairing code required' });

  if (db.isPostgres()) {
    await db.query('UPDATE pairing_codes SET revoked = TRUE WHERE code = $1 AND user_id = $2', [code, req.user.id]);
  } else {
    const entry = db.getMemoryStore().pairing_codes.get(code);
    if (entry && entry.user_id === req.user.id) {
      entry.revoked = true;
    }
  }

  logAudit(req.user.id, null, 'REVOKE_PAIRING_CODE', { code }, req.ip);
  res.json({ success: true, message: `Pairing code ${code} revoked` });
});

app.delete('/api/devices/pair-codes/:code', requireUser, revokePairingCodeHandler);
app.delete('/api/pairing/codes/:code', requireUser, revokePairingCodeHandler);
app.post('/api/pairing/revoke', requireUser, revokePairingCodeHandler);

const MAX_PAIRING_ATTEMPTS = 5;

// Android device redeems a pairing code (device enrollment; no admin login on app)
const redeemPairingCodeHandler = ah(async (req, res) => {
  const pairingCode = String(req.body.pairingCode || req.body.code || '').trim();
  const { deviceName, manufacturer, model, osVersion, sdkVersion, appVersion } = req.body;

  if (!pairingCode) {
    return res.status(400).json({ success: false, message: 'Pairing code is required' });
  }

  // Brute-force controls: per-IP limiter + per-code attempt cap.
  if (!allowAttempt(`pair-redeem:${req.ip}`, { max: 15, windowMs: 10 * 60 * 1000 })) {
    return res.status(429).json({ success: false, message: 'Too many pairing attempts. Try again later.' });
  }

  const now = new Date();
  let validPairing = null;

  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT * FROM pairing_codes WHERE code = $1 AND used = FALSE AND (revoked IS FALSE OR revoked IS NULL) AND expires_at > CURRENT_TIMESTAMP',
      [pairingCode]
    );
    if (result.rows.length > 0) {
      validPairing = result.rows[0];
      if ((validPairing.attempts || 0) >= MAX_PAIRING_ATTEMPTS) {
        await db.query('UPDATE pairing_codes SET revoked = TRUE WHERE id = $1', [validPairing.id]);
        return res.status(429).json({ success: false, message: 'Too many attempts for this pairing code. Generate a new code.' });
      }
      await db.query('UPDATE pairing_codes SET attempts = COALESCE(attempts, 0) + 1 WHERE id = $1', [validPairing.id]);
    }
  } else {
    const entry = db.getMemoryStore().pairing_codes.get(pairingCode);
    if (entry && !entry.used && !entry.revoked && new Date() < new Date(entry.expires_at)) {
      entry.attempts = (entry.attempts || 0) + 1;
      if (entry.attempts > MAX_PAIRING_ATTEMPTS) {
        entry.revoked = true;
        return res.status(429).json({ success: false, message: 'Too many attempts for this pairing code. Generate a new code.' });
      }
      validPairing = entry;
    }
  }

  if (!validPairing) {
    return res.status(400).json({
      success: false,
      message: 'Invalid, expired, or revoked pairing code. Please generate a new code in the dashboard.'
    });
  }

  const deviceId = 'dev_' + crypto.randomBytes(8).toString('hex');
  const deviceToken = generateDeviceToken(deviceId);
  const enrolledStatus = 'ENROLLED'; // truthful: waiting for the device to connect

  if (db.isPostgres()) {
    await db.query(
      'UPDATE pairing_codes SET used = TRUE, used_at = CURRENT_TIMESTAMP, device_id = $1 WHERE id = $2',
      [deviceId, validPairing.id]
    );
    await db.query(
      `INSERT INTO devices (id, user_id, device_name, manufacturer, model, os_version, sdk_version, app_version, auth_token, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET device_name = $3, auth_token = $9, status = $10, last_seen = $11`,
      [
        deviceId,
        validPairing.user_id,
        cleanMeta(deviceName || 'Android Device', 150),
        cleanMeta(manufacturer, 100) || 'Android',
        cleanMeta(model, 100) || 'Device',
        cleanMeta(osVersion, 50) || 'Android',
        asInt(sdkVersion, 34),
        cleanMeta(appVersion, 50) || '1.0',
        deviceToken,
        enrolledStatus,
        now
      ]
    );
    await db.query(
      `INSERT INTO device_permissions (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
      [deviceId]
    );
  } else {
    validPairing.used = true;
    validPairing.used_at = now;
    validPairing.device_id = deviceId;

    const store = db.getMemoryStore();
    store.devices.set(deviceId, {
      id: deviceId,
      user_id: validPairing.user_id,
      device_name: cleanMeta(deviceName || 'Android Device', 150),
      manufacturer: cleanMeta(manufacturer, 100) || 'Android',
      model: cleanMeta(model, 100) || 'Device',
      os_version: cleanMeta(osVersion, 50) || 'Android',
      sdk_version: asInt(sdkVersion, 34),
      app_version: cleanMeta(appVersion, 50) || '1.0',
      auth_token: deviceToken,
      status: enrolledStatus,
      // No fabricated telemetry: metrics stay null until the device reports them.
      battery_level: null,
      is_charging: false,
      storage_available: 0,
      storage_total: 0,
      ram_available: 0,
      ram_total: 0,
      network_type: null,
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

  logAudit(validPairing.user_id, deviceId, 'DEVICE_PAIRED', { deviceName: cleanMeta(deviceName, 150), model: cleanMeta(model, 100), code: pairingCode }, req.ip);

  wsManager.broadcastToDashboards({
    type: 'DEVICE_PAIRED',
    deviceId,
    deviceName: deviceName || 'Android Device',
    timestamp: Date.now()
  });

  const { serverUrl, wsUrl } = getHostUrls(req);

  res.json({
    success: true,
    deviceId,
    token: deviceToken,
    serverUrl,
    wsUrl,
    environment: validPairing.environment || 'Default VPS',
    message: 'Device paired successfully. Status is ENROLLED until the device connects.'
  });
});

app.post([
  '/api/devices/pair',
  '/api/devices/pair/',
  '/api/pairing/redeem',
  '/api/pairing/redeem/',
  '/pairing/redeem',
  '/pairing/redeem/',
  '/devices/pair',
  '/devices/pair/',
  '/api/v1/pairing/redeem',
  '/api/v1/devices/pair',
  '/v1/pairing/redeem',
  '/v1/devices/pair'
], pairingLimiter, redeemPairingCodeHandler);

// Admin claims / pairs a device from the web dashboard using a pairing code
app.post(['/api/pairing/claim', '/api/devices/claim'], requireUser, pairingLimiter, ah(async (req, res) => {
  const code = String(req.body.code || req.body.pairingCode || '').trim();
  const deviceName = cleanMeta(req.body.deviceName || 'Android Device', 150);
  const manufacturer = cleanMeta(req.body.manufacturer, 100) || 'Android';
  const model = cleanMeta(req.body.model, 100) || 'Device';

  if (!code) {
    return res.status(400).json({ success: false, message: 'Pairing code is required' });
  }

  const now = new Date();
  let pairingRecord = null;

  if (db.isPostgres()) {
    const result = await db.query(
      'SELECT * FROM pairing_codes WHERE code = $1 AND (revoked IS FALSE OR revoked IS NULL) AND expires_at > CURRENT_TIMESTAMP',
      [code]
    );
    if (result.rows.length > 0) {
      pairingRecord = result.rows[0];
    }
  } else {
    const entry = db.getMemoryStore().pairing_codes.get(code);
    if (entry && !entry.revoked && new Date() < new Date(entry.expires_at)) {
      pairingRecord = entry;
    }
  }

  // The code must belong to the requesting admin (no cross-user claiming).
  if (!pairingRecord || String(pairingRecord.user_id) !== String(req.user.id)) {
    return res.status(400).json({ success: false, message: 'Invalid, expired, or revoked pairing code.' });
  }
  if (pairingRecord.used) {
    return res.status(400).json({ success: false, message: 'This pairing code has already been redeemed.' });
  }

  const deviceId = pairingRecord.device_id || ('dev_' + crypto.randomBytes(8).toString('hex'));
  const deviceToken = generateDeviceToken(deviceId);

  if (db.isPostgres()) {
    await db.query(
      'UPDATE pairing_codes SET used = TRUE, used_at = CURRENT_TIMESTAMP, device_id = $1 WHERE id = $2',
      [deviceId, pairingRecord.id]
    );
    await db.query(
      `INSERT INTO devices (id, user_id, device_name, manufacturer, model, os_version, sdk_version, app_version, auth_token, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET device_name = $3, auth_token = $9, status = $10, last_seen = $11`,
      [deviceId, req.user.id, deviceName, manufacturer, model, null, null, null, deviceToken, 'ENROLLED', now]
    );
    await db.query(
      `INSERT INTO device_permissions (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING`,
      [deviceId]
    );
  } else {
    pairingRecord.used = true;
    pairingRecord.used_at = now;
    pairingRecord.device_id = deviceId;

    const store = db.getMemoryStore();
    store.devices.set(deviceId, {
      id: deviceId,
      user_id: req.user.id,
      device_name: deviceName,
      manufacturer,
      model,
      os_version: null,
      sdk_version: null,
      app_version: null,
      auth_token: deviceToken,
      status: 'ENROLLED',
      // Truthful empty telemetry — the dashboard must not invent device state.
      battery_level: null,
      is_charging: false,
      storage_available: 0,
      storage_total: 0,
      ram_available: 0,
      ram_total: 0,
      network_type: null,
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

  logAudit(req.user.id, deviceId, 'DEVICE_CLAIMED_ON_DASHBOARD', { code, deviceName }, req.ip);

  wsManager.broadcastToDashboards({
    type: 'DEVICE_PAIRED',
    deviceId,
    deviceName,
    timestamp: Date.now()
  });

  const { serverUrl, wsUrl } = getHostUrls(req);

  res.json({
    success: true,
    deviceId,
    token: deviceToken,
    serverUrl,
    wsUrl,
    message: `Device "${deviceName}" enrolled with code ${code}. It will appear online when the device agent connects.`
  });
}));

// Direct account-based device registration from the Android app
app.post('/api/devices/register-device', requireUser, pairingLimiter, ah(async (req, res) => {
  const { deviceName, manufacturer, model, osVersion, sdkVersion, appVersion, deviceId: clientDeviceId } = req.body;
  const userId = req.user.id;

  const deviceId = clientDeviceId ? cleanMeta(clientDeviceId, 64) : ('dev_' + crypto.randomBytes(8).toString('hex'));

  // Never hijack a device that is already registered to another account.
  const existing = await (async () => {
    if (db.isPostgres()) {
      const r = await db.query('SELECT user_id FROM devices WHERE id = $1', [deviceId]);
      return r.rows[0] || null;
    }
    return db.getMemoryStore().devices.get(deviceId) || null;
  })();
  if (existing && String(existing.user_id) !== String(userId)) {
    return res.status(409).json({ success: false, error: 'Device id is already registered to another account' });
  }

  const deviceToken = generateDeviceToken(deviceId);
  const now = new Date();

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO devices (id, user_id, device_name, manufacturer, model, os_version, sdk_version, app_version, auth_token, status, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET device_name = $3, auth_token = $9, status = $10, last_seen = $11`,
      [deviceId, userId, cleanMeta(deviceName || 'Android Device', 150), cleanMeta(manufacturer, 100), cleanMeta(model, 100),
       cleanMeta(osVersion, 50), asInt(sdkVersion, 34), cleanMeta(appVersion, 50), deviceToken, 'ENROLLED', now]
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
      device_name: cleanMeta(deviceName || 'Android Device', 150),
      manufacturer: cleanMeta(manufacturer, 100),
      model: cleanMeta(model, 100),
      os_version: cleanMeta(osVersion, 50),
      sdk_version: asInt(sdkVersion, 34),
      app_version: cleanMeta(appVersion, 50),
      auth_token: deviceToken,
      status: 'ENROLLED',
      battery_level: null,
      is_charging: false,
      storage_available: 0,
      storage_total: 0,
      ram_available: 0,
      ram_total: 0,
      network_type: null,
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
}));

// ==========================================
// DEVICE MANAGEMENT ROUTES (scoped to the requesting user)
// ==========================================
app.get('/api/devices', requireUser, ah(async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query(
      `SELECT id, device_name, manufacturer, model, os_version, app_version, status, battery_level, is_charging,
              network_type, wifi_ssid, storage_available, storage_total, ram_available, ram_total, uptime_millis,
              last_seen, created_at
       FROM devices WHERE user_id = $1 ORDER BY last_seen DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } else {
    const devices = Array.from(db.getMemoryStore().devices.values())
      .filter(d => String(d.user_id) === String(req.user.id))
      .map(sanitizeDevice);
    res.json(devices);
  }
}));

app.get('/api/devices/:id', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  let device, permissions;

  if (db.isPostgres()) {
    device = req.deviceRecord;
    const permRes = await db.query('SELECT * FROM device_permissions WHERE device_id = $1', [id]);
    permissions = permRes.rows[0];
  } else {
    device = req.deviceRecord;
    permissions = db.getMemoryStore().device_permissions.get(id);
  }

  res.json({
    ...sanitizeDevice(device),
    permissions: permissions || {}
  });
}));

app.delete('/api/devices/:id', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    await db.query('DELETE FROM devices WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  } else {
    db.getMemoryStore().devices.delete(id);
    db.getMemoryStore().device_permissions.delete(id);
  }
  logAudit(req.user.id, id, 'DEVICE_DELETED', {}, req.ip);
  wsManager.broadcastToDashboards({ type: 'DEVICE_DELETED', deviceId: id });
  res.json({ success: true });
}));

app.delete('/api/devices/:id/disconnect', requireUser, requireDeviceOwner, ah(async (req, res) => {
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

  logAudit(req.user.id, id, 'DEVICE_DISCONNECTED', {}, req.ip);
  wsManager.broadcastToDashboards({ type: 'DEVICE_STATUS_CHANGED', deviceId: id, status: 'OFFLINE' });
  res.json({ success: true });
}));

// ==========================================
// TELEMETRY SYNC (device-authenticated)
// ==========================================
app.post('/api/devices/:id/telemetry', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const telemetry = req.body || {};
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
        cleanMeta(telemetry.deviceName, 150) || 'Android Device',
        cleanMeta(telemetry.manufacturer, 100) || 'Android',
        cleanMeta(telemetry.model, 100) || 'Device',
        cleanMeta(telemetry.osVersion, 50) || 'Android',
        asInt(telemetry.sdkVersion, 34),
        cleanMeta(telemetry.appVersion, 50) || '1.0',
        // `??` preserves a genuine 0% battery (|| 100 used to turn 0 into 100).
        asInt(telemetry.batteryLevel, 0),
        telemetry.isCharging || false,
        asInt(telemetry.storageAvailableBytes, 0),
        asInt(telemetry.storageTotalBytes, 0),
        asInt(telemetry.ramAvailableBytes, 0),
        asInt(telemetry.ramTotalBytes, 0),
        cleanMeta(telemetry.networkType, 50) || 'WIFI',
        cleanMeta(telemetry.wifiSsid, 100) || '',
        asInt(telemetry.uptimeMillis, 0),
        now
      ]
    );
  } else {
    const dev = db.getMemoryStore().devices.get(id) || { id };
    Object.assign(dev, {
      // Consistent snake_case field naming in the memory store.
      device_name: telemetry.deviceName ? cleanMeta(telemetry.deviceName, 150) : (dev.device_name || 'Android Device'),
      manufacturer: telemetry.manufacturer ? cleanMeta(telemetry.manufacturer, 100) : dev.manufacturer,
      model: telemetry.model ? cleanMeta(telemetry.model, 100) : dev.model,
      os_version: telemetry.osVersion ? cleanMeta(telemetry.osVersion, 50) : dev.os_version,
      battery_level: telemetry.batteryLevel !== undefined && telemetry.batteryLevel !== null
        ? asInt(telemetry.batteryLevel, 0) : (dev.battery_level ?? null),
      is_charging: telemetry.isCharging !== undefined ? !!telemetry.isCharging : dev.is_charging,
      storage_available: asInt(telemetry.storageAvailableBytes, dev.storage_available ?? 0),
      storage_total: asInt(telemetry.storageTotalBytes, dev.storage_total ?? 0),
      ram_available: asInt(telemetry.ramAvailableBytes, dev.ram_available ?? 0),
      ram_total: asInt(telemetry.ramTotalBytes, dev.ram_total ?? 0),
      network_type: telemetry.networkType ? cleanMeta(telemetry.networkType, 50) : dev.network_type,
      wifi_ssid: telemetry.wifiSsid !== undefined ? cleanMeta(telemetry.wifiSsid, 100) : dev.wifi_ssid,
      uptime_millis: asInt(telemetry.uptimeMillis, dev.uptime_millis ?? 0),
      status: 'ONLINE',
      last_seen: now
    });
    db.getMemoryStore().devices.set(id, dev);
  }

  wsManager.broadcastToDashboards({
    type: 'DEVICE_TELEMETRY_UPDATED',
    deviceId: id,
    telemetry
  });

  res.json({ success: true });
}));

// ==========================================
// LOCATION TRACKING (device-authenticated)
// ==========================================
app.post('/api/devices/:id/location', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude, accuracy, altitude, speed, provider, timestamp } = req.body;

  if (latitude === undefined || longitude === undefined || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({ error: 'Valid latitude and longitude required' });
  }

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO locations (device_id, latitude, longitude, accuracy, altitude, speed, provider, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, Number(latitude), Number(longitude), asInt(accuracy, 0), asInt(altitude, null), asInt(speed, null), cleanMeta(provider, 50), asInt(timestamp, Date.now())]
    );
  } else {
    db.getMemoryStore().locations.push({
      id: Date.now(),
      device_id: id,
      latitude: Number(latitude),
      longitude: Number(longitude),
      accuracy: asInt(accuracy, 0),
      altitude: asInt(altitude, null),
      speed: asInt(speed, null),
      provider: cleanMeta(provider, 50),
      timestamp: asInt(timestamp, Date.now()),
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
      const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) + Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
    location: { latitude: Number(latitude), longitude: Number(longitude), accuracy, altitude, speed, timestamp: timestamp || Date.now() }
  });

  res.json({ success: true });
}));

app.get('/api/devices/:id/locations', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);

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
}));

// ==========================================
// NOTIFICATIONS CAPTURE (device-authenticated)
// ==========================================
app.post('/api/devices/:id/notifications', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const notif = req.body || {};

  const pkg = cleanMeta(notif.packageName, 255) || 'unknown';
  const title = cleanMeta(notif.title, 500) || '';
  const text = cleanMeta(notif.text, 4000) || '';
  const postTime = asInt(notif.postTime, Date.now());
  const notifId = cleanMeta(notif.id, 100) || `${id}_${pkg}_${title.slice(0, 30)}_${postTime}`;

  let isNew = false;

  if (db.isPostgres()) {
    const existing = await db.query('SELECT id FROM notifications WHERE id = $1', [notifId]);
    if (existing.rows.length === 0) {
      isNew = true;
      await db.query(
        `INSERT INTO notifications (id, device_id, package_name, app_name, title, text, category, post_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, post_time = EXCLUDED.post_time`,
        [notifId, id, pkg, cleanMeta(notif.appName, 255) || pkg, title, text, cleanMeta(notif.category, 100), postTime]
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
        app_name: cleanMeta(notif.appName, 255) || pkg,
        title,
        text,
        category: cleanMeta(notif.category, 100),
        post_time: postTime,
        created_at: new Date()
      });
    }
  }

  wsManager.broadcastToDashboards({
    type: 'DEVICE_NOTIFICATION_RECEIVED',
    deviceId: id,
    notification: { packageName: pkg, appName: notif.appName || pkg, title, text, postTime, id: notifId },
    isNew
  });

  res.json({ success: true, isNew, id: notifId });
}));

app.get('/api/devices/:id/notifications', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  const search = req.query.search;
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 500);

  if (db.isPostgres()) {
    if (search) {
      const result = await db.query(
        'SELECT * FROM notifications WHERE device_id = $1 AND (title ILIKE $2 OR text ILIKE $2 OR app_name ILIKE $2) ORDER BY post_time DESC LIMIT $3',
        [id, `%${search}%`, limit]
      );
      res.json(result.rows);
    } else {
      const result = await db.query(
        'SELECT * FROM notifications WHERE device_id = $1 ORDER BY post_time DESC LIMIT $2',
        [id, limit]
      );
      res.json(result.rows);
    }
  } else {
    let list = db.getMemoryStore().notifications.filter(n => n.device_id === id);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(n => (n.title && n.title.toLowerCase().includes(s)) || (n.text && n.text.toLowerCase().includes(s)) || (n.app_name && n.app_name.toLowerCase().includes(s)));
    }
    res.json(list.slice(0, limit));
  }
}));

app.delete('/api/devices/:id/notifications/:notifId', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id, notifId } = req.params;
  if (db.isPostgres()) {
    await db.query('DELETE FROM notifications WHERE id = $1 AND device_id = $2', [notifId, id]);
  } else {
    const list = db.getMemoryStore().notifications;
    const idx = list.findIndex(n => n.id === notifId && n.device_id === id);
    if (idx !== -1) list.splice(idx, 1);
  }
  res.json({ success: true });
}));

// ==========================================
// APPLICATION INVENTORY (device-authenticated)
// ==========================================
app.post('/api/devices/:id/apps', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const apps = req.body;

  if (!Array.isArray(apps)) {
    return res.status(400).json({ error: 'Expected an array of applications' });
  }

  if (db.isPostgres()) {
    for (const app of apps.slice(0, 2000)) {
      await db.query(
        `INSERT INTO applications (device_id, package_name, app_name, version_name, version_code, is_system_app, first_install_time, last_update_time, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (device_id, package_name) DO UPDATE SET
          app_name = $3, version_name = $4, version_code = $5, is_system_app = $6, last_update_time = $8, updated_at = CURRENT_TIMESTAMP`,
        [id, cleanMeta(app.packageName, 255), cleanMeta(app.appName, 255), cleanMeta(app.versionName, 100), asInt(app.versionCode, 0), app.isSystemApp || false, asInt(app.firstInstallTime, 0), asInt(app.lastUpdateTime, 0)]
      );
    }
  } else {
    db.getMemoryStore().applications.set(id, apps.slice(0, 2000));
  }

  res.json({ success: true, count: apps.length });
}));

app.get('/api/devices/:id/apps', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  const search = req.query.search;

  if (db.isPostgres()) {
    if (search) {
      const result = await db.query(
        'SELECT * FROM applications WHERE device_id = $1 AND (app_name ILIKE $2 OR package_name ILIKE $2) ORDER BY is_system_app ASC, app_name ASC',
        [id, `%${search}%`]
      );
      res.json(result.rows);
    } else {
      const result = await db.query(
        'SELECT * FROM applications WHERE device_id = $1 ORDER BY is_system_app ASC, app_name ASC',
        [id]
      );
      res.json(result.rows);
    }
  } else {
    let list = db.getMemoryStore().applications.get(id) || [];
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(a => (a.appName || '').toLowerCase().includes(s) || (a.packageName || '').toLowerCase().includes(s));
    }
    res.json(list);
  }
}));

// ==========================================
// USAGE STATISTICS (device-authenticated)
// ==========================================
app.post('/api/devices/:id/usage', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const usageList = req.body;

  if (!Array.isArray(usageList)) {
    return res.status(400).json({ error: 'Expected an array of usage entries' });
  }

  if (db.isPostgres()) {
    for (const u of usageList.slice(0, 2000)) {
      await db.query(
        `INSERT INTO usage_statistics (device_id, package_name, app_name, total_time_ms, last_time_used)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, cleanMeta(u.packageName, 255), cleanMeta(u.appName, 255), asInt(u.totalTimeInForegroundMs, 0), asInt(u.lastTimeUsed, 0)]
      );
    }
  } else {
    // Replace ONLY this device's stats (previously clobbered every device's).
    const store = db.getMemoryStore();
    const fresh = usageList.slice(0, 2000).map(u => ({
      device_id: id,
      package_name: cleanMeta(u.packageName, 255),
      app_name: cleanMeta(u.appName, 255),
      total_time_ms: asInt(u.totalTimeInForegroundMs, 0),
      last_time_used: asInt(u.lastTimeUsed, 0),
      recorded_at: new Date()
    }));
    store.usage_statistics = store.usage_statistics.filter(u => u.device_id !== id).concat(fresh);
  }

  res.json({ success: true });
}));

app.get('/api/devices/:id/usage', requireUser, requireDeviceOwner, ah(async (req, res) => {
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
}));

// ==========================================
// FILE EXPLORER SERVICES (device-authenticated)
// ==========================================
app.post('/api/devices/:id/files', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const list = req.body;
  if (!Array.isArray(list)) {
    return res.status(400).json({ error: 'Expected an array of file metadata' });
  }
  if (db.isPostgres()) {
    await db.query('DELETE FROM files WHERE device_id = $1', [id]);
    for (const f of list.slice(0, 5000)) {
      await db.query(
        `INSERT INTO files (device_id, file_name, file_path, file_size, mime_type, is_directory)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, cleanMeta(f.fileName, 255), cleanMeta(f.filePath, 1024), asInt(f.fileSize, 0), cleanMeta(f.mimeType, 100), f.isDirectory || false]
      );
    }
  } else {
    const store = db.getMemoryStore();
    store.files = store.files.filter(f => f.device_id !== id);
    list.slice(0, 5000).forEach(f => {
      store.files.push({
        id: Date.now() + Math.random(),
        device_id: id,
        file_name: cleanMeta(f.fileName, 255),
        file_path: cleanMeta(f.filePath, 1024),
        file_size: asInt(f.fileSize, 0),
        mime_type: cleanMeta(f.mimeType, 100),
        is_directory: f.isDirectory || false,
        created_at: new Date()
      });
    });
  }
  wsManager.broadcastToDashboards({ type: 'DEVICE_FILES_RECEIVED', deviceId: id });
  res.json({ success: true });
}));

app.get('/api/devices/:id/files', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM files WHERE device_id = $1 ORDER BY is_directory DESC, file_name ASC', [id]);
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().files.filter(f => f.device_id === id));
  }
}));

// ==========================================
// SMS / CALLS / CONTACTS / KEYSTROKES
// ==========================================
function makeIngestListRoute({ path: routePath, table, mapRow, broadcastType, memoryKey }) {
  app.post(routePath, ingestLimiter, deviceDataAuth, ah(async (req, res) => {
    const { id } = req.params;
    const list = req.body;
    if (!Array.isArray(list)) {
      return res.status(400).json({ error: 'Expected an array of records' });
    }
    if (db.isPostgres()) {
      for (const item of list.slice(0, 2000)) {
        await db.query(mapRow.pg, [id, ...mapRow.values(item)]);
      }
    } else {
      const store = db.getMemoryStore();
      if (memoryKey === 'contacts') {
        store.contacts = store.contacts.filter(c => c.device_id !== id);
      }
      list.slice(0, 2000).forEach(item => {
        store[memoryKey].push({ id: Date.now() + Math.random(), device_id: id, ...mapRow.memory(item), created_at: new Date() });
      });
    }
    wsManager.broadcastToDashboards({ type: broadcastType, deviceId: id });
    res.json({ success: true });
  }));
}

makeIngestListRoute({
  path: '/api/devices/:id/sms',
  table: 'sms',
  broadcastType: 'DEVICE_SMS_RECEIVED',
  memoryKey: 'sms',
  mapRow: {
    pg: 'INSERT INTO sms (device_id, address, body, type, timestamp) VALUES ($1, $2, $3, $4, $5)',
    values: (s) => [cleanMeta(s.address, 100), cleanMeta(s.body, 4000), cleanMeta(s.type, 20) || 'INBOX', asInt(s.timestamp, Date.now())],
    memory: (s) => ({ address: cleanMeta(s.address, 100), body: cleanMeta(s.body, 4000), type: cleanMeta(s.type, 20) || 'INBOX', timestamp: asInt(s.timestamp, Date.now()) })
  }
});

makeIngestListRoute({
  path: '/api/devices/:id/calls',
  table: 'calls',
  broadcastType: 'DEVICE_CALLS_RECEIVED',
  memoryKey: 'calls',
  mapRow: {
    pg: 'INSERT INTO calls (device_id, number, name, type, duration, timestamp) VALUES ($1, $2, $3, $4, $5, $6)',
    values: (c) => [cleanMeta(c.number, 100), cleanMeta(c.name, 150), cleanMeta(c.type, 50) || 'INCOMING', asInt(c.duration, 0), asInt(c.timestamp, Date.now())],
    memory: (c) => ({ number: cleanMeta(c.number, 100), name: cleanMeta(c.name, 150), type: cleanMeta(c.type, 50) || 'INCOMING', duration: asInt(c.duration, 0), timestamp: asInt(c.timestamp, Date.now()) })
  }
});

makeIngestListRoute({
  path: '/api/devices/:id/contacts',
  table: 'contacts',
  broadcastType: 'DEVICE_CONTACTS_RECEIVED',
  memoryKey: 'contacts',
  mapRow: {
    pg: 'INSERT INTO contacts (device_id, name, phone, email) VALUES ($1, $2, $3, $4)',
    values: (c) => [cleanMeta(c.name, 150), cleanMeta(c.phone, 100), cleanMeta(c.email, 255)],
    memory: (c) => ({ name: cleanMeta(c.name, 150), phone: cleanMeta(c.phone, 100), email: cleanMeta(c.email, 255) })
  }
});

makeIngestListRoute({
  path: '/api/devices/:id/keystrokes',
  table: 'keystrokes',
  broadcastType: 'DEVICE_KEYSTROKES_RECEIVED',
  memoryKey: 'keystrokes',
  mapRow: {
    pg: 'INSERT INTO keystrokes (device_id, app_package, app_name, text, timestamp) VALUES ($1, $2, $3, $4, $5)',
    values: (k) => [cleanMeta(k.appPackage, 255), cleanMeta(k.appName, 255), cleanMeta(k.text, 4000), asInt(k.timestamp, Date.now())],
    memory: (k) => ({ app_package: cleanMeta(k.appPackage, 255), app_name: cleanMeta(k.appName, 255), text: cleanMeta(k.text, 4000), timestamp: asInt(k.timestamp, Date.now()) })
  }
});

for (const [route, memoryKey, selectSql] of [
  ['/api/devices/:id/sms', 'sms', 'SELECT * FROM sms WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200'],
  ['/api/devices/:id/calls', 'calls', 'SELECT * FROM calls WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200'],
  ['/api/devices/:id/contacts', 'contacts', 'SELECT * FROM contacts WHERE device_id = $1 ORDER BY name ASC'],
  ['/api/devices/:id/keystrokes', 'keystrokes', 'SELECT * FROM keystrokes WHERE device_id = $1 ORDER BY timestamp DESC LIMIT 200']
]) {
  app.get(route, requireUser, requireDeviceOwner, ah(async (req, res) => {
    const { id } = req.params;
    if (db.isPostgres()) {
      const result = await db.query(selectSql, [id]);
      res.json(result.rows);
    } else {
      res.json(db.getMemoryStore()[memoryKey].filter(r => r.device_id === id));
    }
  }));
}

// ==========================================
// PERMISSIONS
// ==========================================
app.get('/api/devices/:id/permissions', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  const defaults = {
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
      res.json(defaults);
    }
  } else {
    const perms = db.getMemoryStore().device_permissions.get(id) || defaults;
    res.json(perms);
  }
}));

// Device agents report their permission state (device token), admins can set it.
app.put('/api/devices/:id/permissions', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const perms = req.body || {};

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO device_permissions (device_id, location, notification_access, files_access, camera, microphone, usage_access, screen_sharing, contacts, calls, sms, accessibility, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
       ON CONFLICT (device_id) DO UPDATE SET
        location = $2, notification_access = $3, files_access = $4, camera = $5, microphone = $6, usage_access = $7, screen_sharing = $8,
        contacts = $9, calls = $10, sms = $11, accessibility = $12, updated_at = CURRENT_TIMESTAMP`,
      [
        id,
        perms.location || false,
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
}));

// ==========================================
// COMMAND DISPATCH SYSTEM
// Contract: server/src/commands.js + docs/COMMAND_CONTRACT.md
// Lifecycle: QUEUED -> DELIVERED -> RECEIVED -> EXECUTING -> COMPLETED
//            (+ FAILED, REJECTED, EXPIRED, CANCELLED). A WebSocket send only
//            marks DELIVERED — completion requires a validated device result.
// ==========================================
import {
  insertCommand, getCommand, findCommandByIdempotencyKey,
  listCommandsForDevice, expireOverdueCommands, updateCommandStatus,
  toWireCommand
} from './command-store.js';

function httpStatusFromUpdate(update) {
  if (update.ok) return null;
  if (update.reason === 'not-found') return 404;
  if (update.reason === 'invalid-status') return 400;
  if (update.reason === 'invalid-transition') return 409;
  return 400;
}

app.post('/api/devices/:id/commands', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  const { commandType, parameters, idempotencyKey, ttlSeconds } = req.body;

  if (!commandType || typeof commandType !== 'string') {
    return res.status(400).json({ error: 'commandType required' });
  }
  const spec = getCommandSpec(commandType);
  if (!spec) {
    return res.status(400).json({ error: `Unknown commandType. Allowed: ${[...ALLOWED_COMMAND_TYPES].join(', ')}` });
  }
  const validated = validateAndNormalizeParams(commandType, parameters);
  if (validated.error) {
    return res.status(400).json({ error: validated.error });
  }

  // Idempotent re-submission: same device + key returns the original command
  // instead of creating a duplicate (protects retries and reconnect storms).
  const idem = typeof idempotencyKey === 'string' && idempotencyKey.length > 0 && idempotencyKey.length <= 128
    ? idempotencyKey : null;
  if (idem) {
    const existing = await findCommandByIdempotencyKey(id, idem);
    if (existing) {
      return res.json({
        commandId: existing.id || existing.commandId,
        status: existing.status,
        dispatchedToOnlineDevice: false,
        queued: !TERMINAL_STATUSES.has(existing.status),
        idempotentReplay: true,
        expiresAt: existing.expires_at ? Number(existing.expires_at) : null,
        command: toWireCommand(existing)
      });
    }
  }

  const commandId = 'cmd_' + Date.now() + '_' + crypto.randomBytes(3).toString('hex');
  const now = Date.now();
  const expiresAt = now + ttlMsFor(commandType, ttlSeconds);

  const command = {
    commandId,
    deviceId: id,
    commandType,
    parameters: validated.params,
    status: CMD_STATUS.QUEUED,
    timestamp: now,
    expiresAt
  };

  // Persist BEFORE attempting delivery so offline devices can be replayed.
  await insertCommand({
    ...command,
    userId: req.user.id,
    idempotencyKey: idem
  });

  logAudit(req.user.id, id, 'DISPATCH_COMMAND', { commandType, commandId }, req.ip);

  // Attempt live delivery; the command stays queued if the device is offline.
  const dispatched = wsManager.sendCommandToDevice(id, command);
  if (dispatched) {
    await updateCommandStatus(commandId, id, CMD_STATUS.DELIVERED);
  }

  const finalStatus = dispatched ? CMD_STATUS.DELIVERED : CMD_STATUS.QUEUED;
  res.json({
    commandId,
    status: finalStatus,
    dispatchedToOnlineDevice: dispatched,
    queued: !dispatched,
    expiresAt,
    requiresConsent: spec.requiresConsent,
    command: { ...command, status: finalStatus }
  });
}));

app.get('/api/devices/:id/commands', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  await expireOverdueCommands(id);
  const rows = await listCommandsForDevice(id, 50);
  res.json(rows);
}));

// Cancel a command that has not started executing on the device yet.
app.post('/api/devices/:id/commands/:commandId/cancel', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id, commandId } = req.params;
  const update = await updateCommandStatus(commandId, id, CMD_STATUS.CANCELLED);
  if (!update.ok) {
    const code = httpStatusFromUpdate(update);
    const message = update.reason === 'invalid-transition'
      ? `Command cannot be cancelled from status ${update.previous}`
      : (update.reason === 'not-found' ? 'Command not found for this device' : 'Invalid request');
    return res.status(code).json({ error: message, previousStatus: update.previous });
  }
  if (!update.duplicate) {
    wsManager.broadcastToDashboards({
      type: 'COMMAND_STATUS_UPDATED',
      deviceId: id,
      commandId,
      status: CMD_STATUS.CANCELLED,
      timestamp: Date.now()
    });
  }
  // Cancelling an already-cancelled command is an idempotent no-op.
  res.json({ success: true, status: CMD_STATUS.CANCELLED, duplicate: Boolean(update.duplicate) });
}));

// Command status updates: authenticated device OR owning user; the command
// must belong to the device in the URL. Statuses are normalized (legacy
// PENDING/SENT/RUNNING accepted) and lifecycle transitions are enforced — a
// terminal command can never be re-written except by an idempotent duplicate
// report of the same terminal status.
app.post('/api/devices/:id/commands/:commandId/status', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id, commandId } = req.params;
  const { status, result, errorMessage } = req.body;

  const normalized = normalizeStatus(status);
  if (!normalized || !DEVICE_REPORTABLE_STATUSES.has(normalized)) {
    return res.status(400).json({ error: 'Invalid command status' });
  }

  // Results are stored as text (a JSON string for structured media results).
  let resultText = null;
  if (result !== undefined && result !== null) {
    resultText = typeof result === 'string' ? result.slice(0, 4000) : JSON.stringify(result).slice(0, 4000);
  }
  const errorText = typeof errorMessage === 'string' ? errorMessage.slice(0, 1000) : null;

  const update = await updateCommandStatus(commandId, id, normalized, {
    result: resultText,
    errorMessage: errorText
  });
  if (!update.ok) {
    const code = httpStatusFromUpdate(update);
    return res.status(code).json({
      error: update.reason === 'not-found' ? 'Command not found for this device' :
        (update.reason === 'invalid-transition'
          ? `Invalid status transition ${update.previous} -> ${update.normalized}`
          : 'Invalid command status')
    });
  }

  wsManager.broadcastToDashboards({
    type: 'COMMAND_STATUS_UPDATED',
    deviceId: id,
    commandId,
    status: update.normalized,
    result: resultText,
    errorMessage: errorText,
    timestamp: Date.now()
  });

  res.json({ success: true, status: update.normalized, applied: update.applied, duplicate: Boolean(update.duplicate) });
}));

// ==========================================
// AUDIO & FILE UPLOADS (device-authenticated, private storage)
// ==========================================
function handleUploadError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File too large (max 25MB)' : `Upload rejected: ${err.message}`;
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: message });
  }
  if (err) return res.status(400).json({ error: 'Upload rejected' });
  next();
}

app.post('/api/devices/:id/recordings', ingestLimiter, deviceDataAuth, upload.single('file'), handleUploadError, ah(async (req, res) => {
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
    media_kind: 'audio',
    size_bytes: req.file.size,
    created_at: new Date()
  };

  if (db.isPostgres()) {
    await db.query(
      'INSERT INTO recordings (device_id, file_name, file_path, duration_ms, media_kind, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, recording.file_name, recording.file_path, durationMs, 'audio', recording.size_bytes]
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
}));

app.get('/api/devices/:id/recordings', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM recordings WHERE device_id = $1 ORDER BY created_at DESC', [id]);
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().recordings.filter(r => r.device_id === id));
  }
}));

// ---- Screenshot & screen-recording media (device uploads, owner-only reads) --
const screenshotUpload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp)$/i.test(file.mimetype || '')) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Screenshots must be JPEG/PNG/WebP images'));
  }
});
const videoUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (req, file, cb) => {
    if (/^video\/(mp4|webm|3gpp|quicktime|x-matroska)$/i.test(file.mimetype || '')) {
      return cb(null, true);
    }
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', 'Screen recordings must be video files'));
  }
});

// Device uploads a screenshot (MediaProjection frame) or camera photo.
app.post('/api/devices/:id/screenshots', ingestLimiter, deviceDataAuth, screenshotUpload.single('file'), handleUploadError, ah(async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const kind = req.body.kind === 'camera' ? 'camera' : 'screenshot';
  const width = parseInt(req.body.width) || 0;
  const height = parseInt(req.body.height) || 0;
  const item = {
    id: Date.now(),
    device_id: id,
    file_name: req.file.filename,
    file_path: `/uploads/${req.file.filename}`,
    kind,
    width,
    height,
    size_bytes: req.file.size,
    created_at: new Date()
  };
  if (db.isPostgres()) {
    const r = await db.query(
      'INSERT INTO screenshots (device_id, file_name, file_path, kind, width, height, size_bytes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [id, item.file_name, item.file_path, kind, width, height, item.size_bytes]
    );
    item.id = r.rows[0].id;
    item.created_at = r.rows[0].created_at;
  } else {
    db.getMemoryStore().screenshots.unshift(item);
  }
  wsManager.broadcastToDashboards({
    type: 'SCREENSHOT_UPLOADED',
    deviceId: id,
    screenshot: item
  });
  res.json({ success: true, screenshot: item });
}));

app.get('/api/devices/:id/screenshots', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const r = await db.query(
      'SELECT * FROM screenshots WHERE device_id = $1 ORDER BY created_at DESC LIMIT 50', [id]
    );
    res.json(r.rows);
  } else {
    res.json(db.getMemoryStore().screenshots.filter(s => s.device_id === id).slice(0, 50));
  }
}));

// Device uploads a finalized screen recording (video).
app.post('/api/devices/:id/videos', ingestLimiter, deviceDataAuth, videoUpload.single('file'), handleUploadError, ah(async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const durationMs = parseInt(req.body.durationMs) || 0;
  const recording = {
    id: Date.now(),
    device_id: id,
    file_name: req.file.filename,
    file_path: `/uploads/${req.file.filename}`,
    duration_ms: durationMs,
    media_kind: 'video',
    size_bytes: req.file.size,
    created_at: new Date()
  };
  if (db.isPostgres()) {
    const r = await db.query(
      'INSERT INTO recordings (device_id, file_name, file_path, duration_ms, media_kind, size_bytes) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, recording.file_name, recording.file_path, durationMs, 'video', recording.size_bytes]
    );
    recording.id = r.rows[0].id;
    recording.created_at = r.rows[0].created_at;
  } else {
    db.getMemoryStore().recordings.unshift(recording);
  }
  wsManager.broadcastToDashboards({
    type: 'DEVICE_RECORDING_UPLOADED',
    deviceId: id,
    recording
  });
  res.json({ success: true, recording });
}));

app.get('/api/devices/:id/videos', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const r = await db.query(
      "SELECT * FROM recordings WHERE device_id = $1 AND media_kind = 'video' ORDER BY created_at DESC LIMIT 50", [id]
    );
    res.json(r.rows);
  } else {
    res.json(db.getMemoryStore().recordings.filter(r => r.device_id === id && r.media_kind === 'video').slice(0, 50));
  }
}));

// Generic file upload (device streams a file from the phone to the dashboard)
app.post('/api/devices/:id/upload-file', ingestLimiter, deviceDataAuth, upload.single('file'), handleUploadError, ah(async (req, res) => {
  const { id } = req.params;
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }
  const webPath = `/uploads/${req.file.filename}`;
  const targetPath = req.body.targetPath ? cleanMeta(req.body.targetPath, 1024) : null;

  if (targetPath && !targetPath.includes('..')) {
    if (db.isPostgres()) {
      await db.query(
        'UPDATE files SET web_path = $1 WHERE device_id = $2 AND file_path = $3',
        [webPath, id, targetPath]
      );
    } else {
      const filesStore = db.getMemoryStore().files;
      const fileEntry = filesStore.find(f => f.device_id === id && f.file_path === targetPath);
      if (fileEntry) {
        fileEntry.web_path = webPath;
      }
    }
  }
  res.json({ success: true, webPath });
}));

// Authorized download route — replaces the previous public express.static.
// Only the owner of the referencing device may fetch an uploaded file.
app.get('/uploads/:filename', requireUser, ah(async (req, res) => {
  const filename = path.basename(req.params.filename); // neutralize traversal
  const webPath = `/uploads/${filename}`;
  const filePath = path.join(uploadsDir, filename);

  if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  let deviceId = null;
  if (db.isPostgres()) {
    const r = await db.query(
      `SELECT device_id FROM files WHERE web_path = $1
       UNION SELECT device_id FROM recordings WHERE file_path = $1
       UNION SELECT device_id FROM screenshots WHERE file_path = $1
       LIMIT 1`,
      [webPath]
    );
    deviceId = r.rows[0]?.device_id || null;
  } else {
    const store = db.getMemoryStore();
    const fileEntry = store.files.find(f => f.web_path === webPath);
    const recEntry = store.recordings.find(r => r.file_path === webPath);
    const shotEntry = store.screenshots.find(s => s.file_path === webPath);
    deviceId = fileEntry?.device_id || recEntry?.device_id || shotEntry?.device_id || null;
  }

  if (!deviceId) {
    return res.status(404).json({ error: 'File not found' });
  }
  const dev = await findDeviceForUser(deviceId, req.user.id);
  if (!dev) {
    return res.status(403).json({ error: 'Not authorized to download this file' });
  }

  res.sendFile(filePath);
}));

// ==========================================
// GEOFENCING API
// ==========================================
app.get('/api/devices/:id/geofences', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM geofences WHERE device_id = $1 OR device_id IS NULL ORDER BY created_at DESC', [id]);
    res.json(result.rows);
  } else {
    const list = (db.getMemoryStore().geofences || []).filter(g => !g.device_id || g.device_id === id);
    res.json(list);
  }
}));

app.post('/api/devices/:id/geofences', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  const { name, latitude, longitude, radiusMeters, isActive } = req.body;
  const rad = Number(radiusMeters) || 500;
  const active = isActive !== false;

  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
    return res.status(400).json({ error: 'Valid latitude and longitude required' });
  }

  const item = {
    device_id: id,
    name: cleanMeta(name, 128) || 'Designated Zone',
    latitude: Number(latitude),
    longitude: Number(longitude),
    radius_meters: rad,
    is_active: active,
    last_status: 'UNKNOWN'
  };

  if (db.isPostgres()) {
    const result = await db.query(
      `INSERT INTO geofences (device_id, name, latitude, longitude, radius_meters, is_active, last_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'UNKNOWN') RETURNING *`,
      [id, item.name, item.latitude, item.longitude, rad, active]
    );
    wsManager.broadcastToDashboards({ type: 'GEOFENCES_UPDATED', deviceId: id });
    res.json({ success: true, geofence: result.rows[0] });
  } else {
    const full = { id: Date.now(), ...item, created_at: new Date() };
    db.getMemoryStore().geofences.push(full);
    wsManager.broadcastToDashboards({ type: 'GEOFENCES_UPDATED', deviceId: id });
    res.json({ success: true, geofence: full });
  }
}));

app.delete('/api/devices/:id/geofences/:geofenceId', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id, geofenceId } = req.params;
  if (db.isPostgres()) {
    await db.query('DELETE FROM geofences WHERE id = $1 AND (device_id = $2 OR device_id IS NULL)', [geofenceId, id]);
  } else {
    const list = db.getMemoryStore().geofences;
    const idx = list.findIndex(g => String(g.id) === String(geofenceId));
    if (idx !== -1) list.splice(idx, 1);
  }
  wsManager.broadcastToDashboards({ type: 'GEOFENCES_UPDATED', deviceId: id });
  res.json({ success: true });
}));

// ==========================================
// DATA USAGE API (device-authenticated)
// ==========================================
app.post('/api/devices/:id/data-usage', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const { wifiRx, wifiTx, mobileRx, mobileTx } = req.body;
  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO data_usage (device_id, wifi_bytes_rx, wifi_bytes_tx, mobile_bytes_rx, mobile_bytes_tx)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, asInt(wifiRx, 0), asInt(wifiTx, 0), asInt(mobileRx, 0), asInt(mobileTx, 0)]
    );
  } else {
    db.getMemoryStore().data_usage.unshift({
      device_id: id,
      wifi_bytes_rx: asInt(wifiRx, 0),
      wifi_bytes_tx: asInt(wifiTx, 0),
      mobile_bytes_rx: asInt(mobileRx, 0),
      mobile_bytes_tx: asInt(mobileTx, 0),
      recorded_at: new Date()
    });
  }
  wsManager.broadcastToDashboards({
    type: 'DATA_USAGE_UPDATED',
    deviceId: id,
    dataUsage: { wifiRx, wifiTx, mobileRx, mobileTx }
  });
  res.json({ success: true });
}));

app.get('/api/devices/:id/data-usage', requireUser, requireDeviceOwner, ah(async (req, res) => {
  const { id } = req.params;
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM data_usage WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 30', [id]);
    res.json(result.rows);
  } else {
    const list = (db.getMemoryStore().data_usage || []).filter(d => d.device_id === id).slice(0, 30);
    res.json(list);
  }
}));

// ==========================================
// SERVICE HEALTH API (device-authenticated; persisted in PG too)
// ==========================================
app.post('/api/devices/:id/service-health', ingestLimiter, deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const health = req.body || {};

  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO service_health (device_id, payload, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
       ON CONFLICT (device_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = CURRENT_TIMESTAMP`,
      [id, JSON.stringify(health)]
    );
  } else {
    db.getMemoryStore().service_health.set(id, {
      ...health,
      updatedAt: new Date()
    });
  }

  wsManager.broadcastToDashboards({
    type: 'SERVICE_HEALTH_UPDATED',
    deviceId: id,
    serviceHealth: health
  });

  res.json({ success: true });
}));

const serviceHealthGet = ah(async (req, res) => {
  const { id } = req.params;
  let health;
  if (db.isPostgres()) {
    const result = await db.query('SELECT payload, updated_at FROM service_health WHERE device_id = $1', [id]);
    health = result.rows[0] ? { ...result.rows[0].payload, updatedAt: result.rows[0].updated_at } : null;
  } else {
    health = db.getMemoryStore().service_health.get(id) || null;
  }

  health = health || {
    notificationMonitor: 'UNKNOWN',
    locationService: 'UNKNOWN',
    telemetryCollector: 'UNKNOWN',
    usageTracker: 'UNKNOWN',
    webSocket: 'UNKNOWN',
    foregroundService: 'UNKNOWN',
    updatedAt: null
  };

  // Distinct, truthful connection facts for the dashboard.
  res.json({
    ...health,
    deviceConnected: wsManager.deviceSockets.has(id),
    deviceStatus: req.deviceRecord?.status || 'UNKNOWN',
    lastSeen: req.deviceRecord?.last_seen || null
  });
});

app.get('/api/devices/:id/service-health', requireUser, requireDeviceOwner, serviceHealthGet);
// Alias for the endpoint the dashboard historically called (F-15).
app.get('/api/devices/:id/health', requireUser, requireDeviceOwner, serviceHealthGet);

// ==========================================
// AUDIT & ALERTS (scoped to the requesting user)
// ==========================================
app.get('/api/audit', requireUser, ah(async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query('SELECT * FROM audit_logs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
    res.json(result.rows);
  } else {
    res.json(db.getMemoryStore().audit_logs.filter(l => String(l.user_id) === String(req.user.id)).slice(0, 100));
  }
}));

app.post('/api/devices/:id/alerts', deviceDataAuth, ah(async (req, res) => {
  const { id } = req.params;
  const { alertType, severity, title, message } = req.body || {};

  const alertItem = {
    id: Date.now(),
    device_id: id,
    alert_type: cleanMeta(alertType, 100) || 'SECURITY_ALERT',
    severity: cleanMeta(severity, 20) || 'WARNING',
    title: cleanMeta(title, 255) || 'System Alert',
    message: cleanMeta(message, 1000) || 'Alert triggered',
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
}));

app.get('/api/alerts', requireUser, ah(async (req, res) => {
  if (db.isPostgres()) {
    const result = await db.query(
      `SELECT a.* FROM alerts a
       JOIN devices d ON d.id = a.device_id
       WHERE d.user_id = $1
       ORDER BY a.created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json(result.rows);
  } else {
    const owned = new Set(
      Array.from(db.getMemoryStore().devices.values())
        .filter(d => String(d.user_id) === String(req.user.id))
        .map(d => d.id)
    );
    res.json(db.getMemoryStore().alerts.filter(a => owned.has(a.device_id)).slice(0, 50));
  }
}));

// Catch-all for single-page application routing and API 404s
app.use((req, res, next) => {
  const isApiRequest =
    req.path.startsWith('/api') ||
    req.path.startsWith('/v1') ||
    req.path.startsWith('/uploads') ||
    req.path.startsWith('/ws') ||
    req.path.startsWith('/pairing') ||
    req.path.startsWith('/devices') ||
    req.path.startsWith('/auth') ||
    req.path.startsWith('/health') ||
    req.headers['accept']?.includes('application/json') ||
    req.headers['content-type']?.includes('application/json') ||
    req.method !== 'GET';

  if (isApiRequest) {
    return res.status(404).json({
      success: false,
      error: 'Not found',
      message: `API endpoint not found: ${req.method} ${req.path}`
    });
  }

  const primaryIndex = path.join(__dirname, '..', 'public', 'index.html');
  if (fs.existsSync(primaryIndex)) {
    return res.sendFile(primaryIndex);
  }
  res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
});

// Global Express Error Handler to ensure API errors always return JSON
app.use((err, req, res, next) => {
  console.error('[Server Error]', err.message);
  const message = process.env.NODE_ENV === 'production' ? 'Internal Server Error' : (err.message || 'Internal Server Error');
  res.status(err.status || 500).json({
    success: false,
    error: message
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const boundPort = server.address().port;
  console.log(`Device Management Backend running on http://0.0.0.0:${boundPort}`);
  console.log(`WebSocket endpoints: ws://0.0.0.0:${boundPort}/ws/device & ws://0.0.0.0:${boundPort}/ws/dashboard`);
});
