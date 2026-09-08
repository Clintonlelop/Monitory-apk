const db = require('../db/database');

/**
 * Device token verification middleware.
 * Devices authenticate via X-Device-Token header or device_token in body.
 * Attaches req.device with the device record.
 */
function deviceAuth(req, res, next) {
  try {
    let deviceToken = req.headers['x-device-token'];

    // Also allow device_token in body for POST requests
    if (!deviceToken && req.body && req.body.device_token) {
      deviceToken = req.body.device_token;
    }

    if (!deviceToken) {
      return res.status(401).json({ error: 'Missing device token. Provide X-Device-Token header or device_token in body.' });
    }

    const device = db.prepare('SELECT * FROM devices WHERE device_token = ?').get(deviceToken);
    if (!device) {
      return res.status(401).json({ error: 'Invalid device token' });
    }

    req.device = device;

    // Update last_seen
    db.prepare('UPDATE devices SET last_seen = datetime(\'now\') WHERE id = ?').run(device.id);

    next();
  } catch (err) {
    console.error('deviceAuth error:', err.message);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

module.exports = deviceAuth;
