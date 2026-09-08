const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/geofences - list (dashboard auth)
router.get('/', auth, (req, res) => {
  try {
    const { device_id } = req.query;
    let query = 'SELECT * FROM geofences';
    const params = [];

    if (device_id) {
      query += ' WHERE device_id = ? OR device_id IS NULL';
      params.push(device_id);
    }
    query += ' ORDER BY created_at DESC';

    const geofences = db.prepare(query).all(...params);
    res.json(geofences);
  } catch (err) {
    console.error('List geofences error:', err.message);
    res.status(500).json({ error: 'Server error fetching geofences' });
  }
});

// POST /api/geofences - create (dashboard auth)
router.post('/', auth, (req, res) => {
  try {
    const { device_id, name, lat, lng, radius_meters } = req.body;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (lat == null || lng == null) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const latVal = parseFloat(lat);
    const lngVal = parseFloat(lng);
    if (isNaN(latVal) || isNaN(lngVal)) {
      return res.status(400).json({ error: 'Invalid lat or lng' });
    }

    const radius = radius_meters != null ? Math.max(1, parseFloat(radius_meters)) : 100;

    const result = db.prepare('INSERT INTO geofences (device_id, name, lat, lng, radius_meters) VALUES (?, ?, ?, ?, ?)')
      .run(device_id || null, name, latVal, lngVal, radius);

    const geofence = db.prepare('SELECT * FROM geofences WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(geofence);
  } catch (err) {
    console.error('Create geofence error:', err.message);
    res.status(500).json({ error: 'Server error creating geofence' });
  }
});

// PUT /api/geofences/:id - update (dashboard auth)
router.put('/:id', auth, (req, res) => {
  try {
    const { name, lat, lng, radius_meters, device_id } = req.body;
    const existing = db.prepare('SELECT * FROM geofences WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Geofence not found' });
    }

    db.prepare(`UPDATE geofences SET name = ?, lat = ?, lng = ?, radius_meters = ?, device_id = ? WHERE id = ?`)
      .run(
        name || existing.name,
        lat != null ? parseFloat(lat) : existing.lat,
        lng != null ? parseFloat(lng) : existing.lng,
        radius_meters != null ? parseFloat(radius_meters) : existing.radius_meters,
        device_id !== undefined ? (device_id || null) : existing.device_id,
        req.params.id
      );

    const updated = db.prepare('SELECT * FROM geofences WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Update geofence error:', err.message);
    res.status(500).json({ error: 'Server error updating geofence' });
  }
});

// DELETE /api/geofences/:id - delete (dashboard auth)
router.delete('/:id', auth, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM geofences WHERE id = ?').get(req.params.id);
    if (!existing) {
      return res.status(404).json({ error: 'Geofence not found' });
    }
    db.prepare('DELETE FROM geofences WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: 'Geofence deleted' });
  } catch (err) {
    console.error('Delete geofence error:', err.message);
    res.status(500).json({ error: 'Server error deleting geofence' });
  }
});

// GET /api/geofences/events - geofence events (dashboard auth)
router.get('/events', auth, (req, res) => {
  try {
    const { device_id, limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    let query = `SELECT ge.*, g.name as geofence_name FROM geofence_events ge LEFT JOIN geofences g ON ge.geofence_id = g.id`;
    const params = [];

    if (device_id) {
      query += ' WHERE ge.device_id = ?';
      params.push(device_id);
    }
    query += ' ORDER BY ge.created_at DESC LIMIT ?';
    params.push(lim);

    const events = db.prepare(query).all(...params);
    res.json(events);
  } catch (err) {
    console.error('Get geofence events error:', err.message);
    res.status(500).json({ error: 'Server error fetching geofence events' });
  }
});

module.exports = router;
