import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

// ---------------------------------------------------------------------------
// JWT secret handling
// - Production: JWT_SECRET env var is REQUIRED (no hardcoded fallback). The
//   process refuses to start without it so a default secret can never be used
//   in production.
// - Development/test: if unset, an ephemeral random secret is generated at
//   boot (tokens do not survive restarts, which is fine for local use).
// ---------------------------------------------------------------------------
const MIN_SECRET_LENGTH = 16;

function resolveJwtSecret() {
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  if (fromEnv) {
    if (fromEnv.length < MIN_SECRET_LENGTH) {
      console.error(`[auth] JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters. Refusing to start.`);
      process.exit(1);
    }
    return fromEnv;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('[auth] JWT_SECRET environment variable is required in production. Refusing to start. ' +
      'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
  }
  const generated = crypto.randomBytes(48).toString('hex');
  console.warn('[auth] JWT_SECRET not set; using an ephemeral random secret. Tokens will not survive restarts.');
  return generated;
}

const JWT_SECRET = resolveJwtSecret();
const USER_TOKEN_TTL = process.env.USER_TOKEN_TTL || '7d';
const DEVICE_TOKEN_TTL = process.env.DEVICE_TOKEN_TTL || '365d';

export function generateToken(payload, expiresIn = USER_TOKEN_TTL) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

/** Token for a web dashboard / API user. Always carries type: 'user'. */
export function generateUserToken(user) {
  return generateToken(
    { id: user.id, username: user.username, email: user.email, role: user.role || 'user', type: 'user' },
    USER_TOKEN_TTL
  );
}

/** Token for an Android device agent. Only authorizes that device's own data. */
export function generateDeviceToken(deviceId) {
  return generateToken({ deviceId, type: 'device' }, DEVICE_TOKEN_TTL);
}

function extractBearer(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;
  return parts[1];
}

function unauthorized(res, message = 'Authorization header required') {
  return res.status(401).json({ error: message });
}

/**
 * Verifies a Bearer token and attaches the decoded payload to req.user.
 * Accepts both user and device tokens; pair with requireUser/requireDevice
 * for role separation.
 */
export function verifyToken(req, res, next) {
  const token = extractBearer(req);
  if (!token) return unauthorized(res, 'Format is: Bearer <token>');
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return unauthorized(res, 'Invalid or expired token');
  }
}

/**
 * User/ADMIN authentication only. Device tokens are rejected here so a device
 * JWT can never be used to call administrative endpoints.
 */
export function requireUser(req, res, next) {
  const token = extractBearer(req);
  if (!token) return unauthorized(res, 'Format is: Bearer <token>');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type === 'device' || !decoded.id) {
      return res.status(403).json({ error: 'User authentication required' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return unauthorized(res, 'Invalid or expired token');
  }
}

/**
 * Device authentication only. Attaches req.deviceId from the *token* (never
 * from client-supplied identifiers alone).
 */
export function requireDevice(req, res, next) {
  const token = extractBearer(req);
  if (!token) return unauthorized(res, 'Format is: Bearer <token>');
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.type !== 'device' || !decoded.deviceId) {
      return res.status(403).json({ error: 'Device authentication required' });
    }
    req.device = decoded;
    req.deviceId = decoded.deviceId;
    next();
  } catch (err) {
    return unauthorized(res, 'Invalid or expired token');
  }
}

/**
 * Verifies a JWT outside the Express request cycle (used by the WebSocket
 * handshake). Returns the decoded payload or null.
 */
export function verifyTokenString(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_) {
    return null;
  }
}

export function optionalAuth(req, res, next) {
  const token = extractBearer(req);
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch (_) {}
  }
  next();
}

export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function comparePassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Used to equalize login timing when the user does not exist, so response
// timing does not reveal whether an account is registered.
const DUMMY_HASH = bcrypt.hashSync('timing-equalization-placeholder', 10);
export async function comparePasswordDummy(password) {
  return bcrypt.compare(password, DUMMY_HASH);
}
