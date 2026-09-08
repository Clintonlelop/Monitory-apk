const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

// POST /api/notifications - device sends notification (device auth)
router.post('/notifications', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { package_name, title, text, category, posted_time } = req.body;

    if (!package_name && !title) {
      return res.status(400).json({ error: 'package_name or title is required' });
    }

    db.prepare(`INSERT INTO notifications (device_id, package_name, title, text, category, posted_time) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(device.id, package_name || null, title || null, text || null, category || null, posted_time || null);

    wsManager.broadcastToDashboards(wsManager.buildEvent('NOTIFICATION_RECEIVED', device.id, {
      package_name, title, text, category, posted_time
    }));

    res.status(201).json({ success: true, message: 'Notification recorded' });
  } catch (err) {
    console.error('Notification error:', err.message);
    res.status(500).json({ error: 'Server error recording notification' });
  }
});

// GET /api/devices/:id/notifications - list (dashboard auth)
router.get('/devices/:deviceId/notifications', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    const notifications = db.prepare('SELECT * FROM notifications WHERE device_id = ? ORDER BY created_at DESC LIMIT ?').all(deviceId, lim);
    res.json(notifications);
  } catch (err) {
    console.error('Get notifications error:', err.message);
    res.status(500).json({ error: 'Server error fetching notifications' });
  }
});

module.exports = router;
