const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

const VALID_MESSAGE_TYPES = ['INBOX', 'SENT'];

// POST /api/sms/sync - device syncs SMS (device auth)
router.post('/sms/sync', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { messages } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const upsert = db.prepare(`INSERT INTO sms_messages (device_id, address, body, message_type, date, thread_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(device_id, address, date) DO UPDATE SET body = excluded.body, message_type = excluded.message_type, thread_id = excluded.thread_id`);

    const tx = db.transaction((items) => {
      for (const m of items) {
        if (!m.address || !m.date) continue;
        const msgType = VALID_MESSAGE_TYPES.includes(m.message_type) ? m.message_type : 'INBOX';
        upsert.run(device.id, m.address, m.body || null, msgType, m.date, m.thread_id || null);
      }
    });
    tx(messages);

    wsManager.broadcastToDashboards(wsManager.buildEvent('SMS_SYNCED', device.id, { count: messages.length }));

    res.status(201).json({ success: true, synced: messages.length });
  } catch (err) {
    console.error('SMS sync error:', err.message);
    res.status(500).json({ error: 'Server error syncing SMS' });
  }
});

// GET /api/devices/:id/sms - list (dashboard auth)
router.get('/devices/:deviceId/sms', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 100, thread_id } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    let query = 'SELECT * FROM sms_messages WHERE device_id = ?';
    const params = [deviceId];

    if (thread_id) {
      query += ' AND thread_id = ?';
      params.push(thread_id);
    }

    query += ' ORDER BY date DESC LIMIT ?';
    params.push(lim);

    const messages = db.prepare(query).all(...params);
    res.json(messages);
  } catch (err) {
    console.error('Get SMS error:', err.message);
    res.status(500).json({ error: 'Server error fetching SMS' });
  }
});

module.exports = router;
