const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

// POST /api/usage - device sends batch usage (device auth)
router.post('/usage', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { usage } = req.body;

    if (!usage || !Array.isArray(usage)) {
      return res.status(400).json({ error: 'usage array is required' });
    }

    const insert = db.prepare(`INSERT INTO app_usage (device_id, package_name, app_name, usage_seconds, last_used, date) VALUES (?, ?, ?, ?, ?, ?)`);

    const tx = db.transaction((items) => {
      for (const item of items) {
        if (!item.package_name) continue;
        insert.run(
          device.id,
          item.package_name,
          item.app_name || null,
          item.usage_seconds != null ? parseInt(item.usage_seconds) : 0,
          item.last_used || null,
          item.date || null
        );
      }
    });
    tx(usage);

    wsManager.broadcastToDashboards(wsManager.buildEvent('USAGE_UPDATED', device.id, { count: usage.length }));

    res.status(201).json({ success: true, recorded: usage.length });
  } catch (err) {
    console.error('Usage sync error:', err.message);
    res.status(500).json({ error: 'Server error recording usage data' });
  }
});

// GET /api/devices/:id/usage - usage data (dashboard auth)
router.get('/devices/:deviceId/usage', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { date, days = 7 } = req.query;

    let query = 'SELECT * FROM app_usage WHERE device_id = ?';
    const params = [deviceId];

    if (date) {
      query += ' AND date = ?';
      params.push(date);
    } else if (days) {
      query += ` AND date >= date('now', ?)`;
      params.push(`-${parseInt(days)} days`);
    }

    query += ' ORDER BY date DESC, usage_seconds DESC';

    const usage = db.prepare(query).all(...params);
    res.json(usage);
  } catch (err) {
    console.error('Get usage error:', err.message);
    res.status(500).json({ error: 'Server error fetching usage data' });
  }
});

module.exports = router;
