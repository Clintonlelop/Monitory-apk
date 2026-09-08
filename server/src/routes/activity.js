const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/activity - activity timeline (dashboard auth)
router.get('/', auth, (req, res) => {
  try {
    const { device_id, limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    let query = 'SELECT * FROM activity_events WHERE 1=1';
    const params = [];

    if (device_id) {
      query += ' AND device_id = ?';
      params.push(device_id);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);

    const events = db.prepare(query).all(...params);

    // Parse metadata JSON
    for (const e of events) {
      if (e.metadata) {
        try { e.metadata = JSON.parse(e.metadata); } catch (_) { /* keep as string */ }
      }
    }

    res.json(events);
  } catch (err) {
    console.error('Get activity error:', err.message);
    res.status(500).json({ error: 'Server error fetching activity events' });
  }
});

module.exports = router;
