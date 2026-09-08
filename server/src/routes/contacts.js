const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

// POST /api/contacts/sync - device syncs contacts (device auth)
router.post('/contacts/sync', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { contacts } = req.body;

    if (!contacts || !Array.isArray(contacts)) {
      return res.status(400).json({ error: 'contacts array is required' });
    }

    const upsert = db.prepare(`INSERT INTO contacts (device_id, name, phone, email) VALUES (?, ?, ?, ?) ON CONFLICT(device_id, phone) DO UPDATE SET name = excluded.name, email = excluded.email`);

    const tx = db.transaction((items) => {
      for (const c of items) {
        if (!c.phone) continue;
        upsert.run(device.id, c.name || null, c.phone, c.email || null);
      }
    });
    tx(contacts);

    wsManager.broadcastToDashboards(wsManager.buildEvent('CONTACTS_SYNCED', device.id, { count: contacts.length }));

    db.prepare(`INSERT INTO activity_events (device_id, event_type, description) VALUES (?, 'CONTACTS_SYNCED', ?)`)
      .run(device.id, `${contacts.length} contacts synced`);

    res.status(201).json({ success: true, synced: contacts.length });
  } catch (err) {
    console.error('Contacts sync error:', err.message);
    res.status(500).json({ error: 'Server error syncing contacts' });
  }
});

// GET /api/devices/:id/contacts - list (dashboard auth)
router.get('/devices/:deviceId/contacts', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const contacts = db.prepare('SELECT * FROM contacts WHERE device_id = ? ORDER BY name ASC').all(deviceId);
    res.json(contacts);
  } catch (err) {
    console.error('Get contacts error:', err.message);
    res.status(500).json({ error: 'Server error fetching contacts' });
  }
});

module.exports = router;
