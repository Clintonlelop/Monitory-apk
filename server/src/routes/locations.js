const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');
const { isInsideGeofence } = require('../utils/geofence');

const router = express.Router();

function evaluateGeofences(deviceId, lat, lng, timestamp) {
  const geofences = db.prepare('SELECT * FROM geofences WHERE device_id = ? OR device_id IS NULL').all(deviceId);

  for (const fence of geofences) {
    const currentlyInside = isInsideGeofence(lat, lng, fence.lat, fence.lng, fence.radius_meters);
    const lastEvent = db.prepare(`SELECT event_type FROM geofence_events WHERE geofence_id = ? AND device_id = ? ORDER BY created_at DESC LIMIT 1`).get(fence.id, deviceId);
    const wasInside = lastEvent ? lastEvent.event_type === 'ENTER' : false;

    if (currentlyInside && !wasInside) {
      db.prepare(`INSERT INTO geofence_events (geofence_id, device_id, event_type, lat, lng, timestamp) VALUES (?, ?, 'ENTER', ?, ?, ?)`)
        .run(fence.id, deviceId, lat, lng, timestamp || new Date().toISOString());

      wsManager.broadcastToDashboards(wsManager.buildEvent('GEOFENCE_EVENT', deviceId, {
        geofence_id: fence.id, geofence_name: fence.name, event_type: 'ENTER', lat, lng
      }));

      db.prepare(`INSERT INTO activity_events (device_id, event_type, description, metadata) VALUES (?, 'GEOFENCE_ENTER', ?, ?)`)
        .run(deviceId, `Entered geofence "${fence.name}"`, JSON.stringify({ geofence_id: fence.id }));
    } else if (!currentlyInside && wasInside) {
      db.prepare(`INSERT INTO geofence_events (geofence_id, device_id, event_type, lat, lng, timestamp) VALUES (?, ?, 'EXIT', ?, ?, ?)`)
        .run(fence.id, deviceId, lat, lng, timestamp || new Date().toISOString());

      wsManager.broadcastToDashboards(wsManager.buildEvent('GEOFENCE_EVENT', deviceId, {
        geofence_id: fence.id, geofence_name: fence.name, event_type: 'EXIT', lat, lng
      }));

      db.prepare(`INSERT INTO activity_events (device_id, event_type, description, metadata) VALUES (?, 'GEOFENCE_EXIT', ?, ?)`)
        .run(deviceId, `Exited geofence "${fence.name}"`, JSON.stringify({ geofence_id: fence.id }));
    }
  }
}

// POST /api/locations - device sends location (device auth)
router.post('/locations', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { lat, lng, accuracy, altitude, speed, provider, timestamp } = req.body;

    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const latVal = parseFloat(lat);
    const lngVal = parseFloat(lng);
    if (isNaN(latVal) || isNaN(lngVal) || latVal < -90 || latVal > 90 || lngVal < -180 || lngVal > 180) {
      return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }

    const ts = timestamp || new Date().toISOString();

    db.prepare(`INSERT INTO locations (device_id, lat, lng, accuracy, altitude, speed, provider, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(device.id, latVal, lngVal, accuracy != null ? parseFloat(accuracy) : null, altitude != null ? parseFloat(altitude) : null, speed != null ? parseFloat(speed) : null, provider || null, ts);

    db.prepare(`UPDATE devices SET lat = ?, lng = ?, location_accuracy = ?, location_timestamp = ?, last_seen = datetime('now') WHERE id = ?`)
      .run(latVal, lngVal, accuracy != null ? parseFloat(accuracy) : null, ts, device.id);

    evaluateGeofences(device.id, latVal, lngVal, ts);

    wsManager.broadcastToDashboards(wsManager.buildEvent('LOCATION_UPDATED', device.id, {
      lat: latVal, lng: lngVal, accuracy, altitude, speed, provider, timestamp: ts
    }));

    res.status(201).json({ success: true, message: 'Location recorded' });
  } catch (err) {
    console.error('Location error:', err.message);
    res.status(500).json({ error: 'Server error recording location' });
  }
});

// GET /api/devices/:id/locations - location history (dashboard auth)
router.get('/devices/:deviceId/locations', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 1000);

    const locations = db.prepare('SELECT * FROM locations WHERE device_id = ? ORDER BY created_at DESC LIMIT ?').all(deviceId, lim);
    res.json(locations);
  } catch (err) {
    console.error('Get locations error:', err.message);
    res.status(500).json({ error: 'Server error fetching locations' });
  }
});

module.exports = router;
module.exports.evaluateGeofences = evaluateGeofences;
