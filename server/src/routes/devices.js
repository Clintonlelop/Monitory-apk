const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

// POST /api/devices/register - device pairing (dashboard auth)
router.post('/register', auth, (req, res) => {
  try {
    const { device_token, name, model, manufacturer, android_version, app_version, display } = req.body;

    if (!device_token || typeof device_token !== 'string') {
      return res.status(400).json({ error: 'device_token is required' });
    }

    // Parse display info
    const displayWidth = display?.resolution_width != null ? parseInt(display.resolution_width) : null;
    const displayHeight = display?.resolution_height != null ? parseInt(display.resolution_height) : null;
    const displayRefreshRate = display?.refresh_rate != null ? parseFloat(display.refresh_rate) : null;
    const displayCurrentMode = display?.current_mode != null ? parseFloat(display.current_mode) : null;
    const displaySupportedRates = display?.supported_rates ? JSON.stringify(display.supported_rates) : null;
    const displayDensity = display?.density_dpi != null ? parseInt(display.density_dpi) : null;
    const displayOrientation = display?.orientation != null ? parseInt(display.orientation) : null;
    const displaySize = display?.display_size_inches != null ? parseFloat(display.display_size_inches) : null;

    const existing = db.prepare('SELECT * FROM devices WHERE device_token = ?').get(device_token);
    if (existing) {
      // Update device info if already registered
      db.prepare(`UPDATE devices SET
          name = ?, model = ?, manufacturer = ?, android_version = ?, app_version = ?,
          display_width = COALESCE(?, display_width),
          display_height = COALESCE(?, display_height),
          display_refresh_rate = COALESCE(?, display_refresh_rate),
          display_current_mode = COALESCE(?, display_current_mode),
          display_supported_rates = COALESCE(?, display_supported_rates),
          display_density = COALESCE(?, display_density),
          display_orientation = COALESCE(?, display_orientation),
          display_size = COALESCE(?, display_size),
          last_seen = datetime('now')
        WHERE id = ?`)
        .run(
          name || existing.name, model || existing.model, manufacturer || existing.manufacturer,
          android_version || existing.android_version, app_version || existing.app_version,
          displayWidth, displayHeight, displayRefreshRate, displayCurrentMode,
          displaySupportedRates, displayDensity, displayOrientation, displaySize,
          existing.id
        );
      const updated = db.prepare('SELECT * FROM devices WHERE id = ?').get(existing.id);
      return res.json(updated);
    }

    const result = db.prepare(`INSERT INTO devices
        (device_token, name, model, manufacturer, android_version, app_version,
         display_width, display_height, display_refresh_rate, display_current_mode,
         display_supported_rates, display_density, display_orientation, display_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        device_token, name || null, model || null, manufacturer || null,
        android_version || null, app_version || null,
        displayWidth, displayHeight, displayRefreshRate, displayCurrentMode,
        displaySupportedRates, displayDensity, displayOrientation, displaySize
      );

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);

    // Log activity
    db.prepare(`INSERT INTO activity_events (device_id, event_type, description) VALUES (?, 'DEVICE_REGISTERED', ?)`)
      .run(device.id, `Device "${device.name || device.device_token}" registered`);

    res.status(201).json(device);
  } catch (err) {
    console.error('Device register error:', err.message);
    res.status(500).json({ error: 'Server error during device registration' });
  }
});

// GET /api/devices - list all devices (dashboard auth)
router.get('/', auth, (req, res) => {
  try {
    const devices = db.prepare('SELECT * FROM devices ORDER BY created_at DESC').all();
    res.json(devices);
  } catch (err) {
    console.error('List devices error:', err.message);
    res.status(500).json({ error: 'Server error fetching devices' });
  }
});

// GET /api/devices/:id - single device detail (dashboard auth)
router.get('/:id', auth, (req, res) => {
  try {
    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    res.json(device);
  } catch (err) {
    console.error('Get device error:', err.message);
    res.status(500).json({ error: 'Server error fetching device' });
  }
});

// GET /api/devices/:id/permissions - permission states (dashboard auth)
router.get('/:id/permissions', auth, (req, res) => {
  try {
    const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(req.params.id);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }
    const permissions = db.prepare('SELECT * FROM permissions WHERE device_id = ? ORDER BY permission_name').all(req.params.id);
    res.json(permissions);
  } catch (err) {
    console.error('Get permissions error:', err.message);
    res.status(500).json({ error: 'Server error fetching permissions' });
  }
});

// PUT /api/devices/:id/permissions - update permission states (device auth)
router.put('/:id/permissions', deviceAuth, (req, res) => {
  try {
    const deviceId = req.params.id;
    if (String(req.device.id) !== String(deviceId)) {
      return res.status(403).json({ error: 'Device token does not match device ID' });
    }

    const { permissions } = req.body;
    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({ error: 'permissions array is required' });
    }

    const upsert = db.prepare(`INSERT INTO permissions (device_id, permission_name, status, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(device_id, permission_name) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`);

    const tx = db.transaction((perms) => {
      for (const p of perms) {
        if (!p.permission_name) continue;
        const status = ['GRANTED', 'DENIED', 'REQUIRES_USER_ACTION', 'NOT_AVAILABLE'].includes(p.status) ? p.status : 'REQUIRES_USER_ACTION';
        upsert.run(deviceId, p.permission_name, status);
      }
    });
    tx(permissions);

    // Broadcast permission status change
    wsManager.broadcastToDashboards(wsManager.buildEvent('PERMISSION_STATUS_CHANGED', parseInt(deviceId), { count: permissions.length }));

    const updated = db.prepare('SELECT * FROM permissions WHERE device_id = ? ORDER BY permission_name').all(deviceId);
    res.json(updated);
  } catch (err) {
    console.error('Update permissions error:', err.message);
    res.status(500).json({ error: 'Server error updating permissions' });
  }
});

module.exports = router;
