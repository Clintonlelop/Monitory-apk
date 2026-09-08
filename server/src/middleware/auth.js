const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

/**
 * JWT verification middleware for dashboard users.
 * Expects Authorization: Bearer <token>
 */
function auth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = auth;

/**
 * Combined auth: accepts either JWT (dashboard) or device token (device).
 * Sets req.user (JWT) or req.device (device token) accordingly.
 */
module.exports.combined = function combinedAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const deviceToken = req.headers['x-device-token'] || req.body?.device_token;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      return next();
    } catch (_) {
      // fall through to device auth
    }
  }

  if (deviceToken) {
    const db = require('../db/database');
    const device = db.prepare('SELECT * FROM devices WHERE device_token = ?').get(deviceToken);
    if (device) {
      req.device = device;
      return next();
    }
  }

  return res.status(401).json({ error: 'Missing or invalid authentication' });
};
