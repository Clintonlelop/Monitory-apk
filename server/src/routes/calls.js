const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

const VALID_CALL_TYPES = ['INCOMING', 'OUTGOING', 'MISSED'];

// POST /api/calls/sync - device syncs call log (device auth)
router.post('/calls/sync', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { calls } = req.body;

    if (!calls || !Array.isArray(calls)) {
      return res.status(400).json({ error: 'calls array is required' });
    }

    const upsert = db.prepare(`INSERT INTO calls (device_id, number, contact_name, call_type, duration_seconds, call_date) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, number, call_date) DO UPDATE SET contact_name = excluded.contact_name, call_type = excluded.call_type, duration_seconds = excluded.duration_seconds`);

    const tx = db.transaction((items) => {
      for (const c of items) {
        if (!c.number || !c.call_date) continue;
        const callType = VALID_CALL_TYPES.includes(c.call_type) ? c.call_type : 'INCOMING';
        upsert.run(device.id, c.number, c.contact_name || null, callType, c.duration_seconds != null ? parseInt(c.duration_seconds) : 0, c.call_date);
      }
    });
    tx(calls);

    wsManager.broadcastToDashboards(wsManager.buildEvent('CALLS_SYNCED', device.id, { count: calls.length }));

    res.status(201).json({ success: true, synced: calls.length });
  } catch (err) {
    console.error('Calls sync error:', err.message);
    res.status(500).json({ error: 'Server error syncing calls' });
  }
});

// GET /api/devices/:id/calls - list (dashboard auth)
router.get('/devices/:deviceId/calls', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    const calls = db.prepare('SELECT * FROM calls WHERE device_id = ? ORDER BY call_date DESC LIMIT ?').all(deviceId, lim);
    res.json(calls);
  } catch (err) {
    console.error('Get calls error:', err.message);
    res.status(500).json({ error: 'Server error fetching calls' });
  }
});

module.exports = router;
