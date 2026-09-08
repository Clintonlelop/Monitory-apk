const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const { STORAGE_DIR } = require('./files');

const router = express.Router();

// GET /api/recordings - list recordings (dashboard auth)
router.get('/', auth, (req, res) => {
  try {
    const { device_id, limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    let query = 'SELECT * FROM recordings WHERE 1=1';
    const params = [];

    if (device_id) {
      query += ' AND device_id = ?';
      params.push(device_id);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);

    const recordings = db.prepare(query).all(...params);
    res.json(recordings);
  } catch (err) {
    console.error('List recordings error:', err.message);
    res.status(500).json({ error: 'Server error fetching recordings' });
  }
});

// GET /api/recordings/:id/download - download recording (dashboard auth)
router.get('/:id/download', auth, (req, res) => {
  try {
    const recording = db.prepare('SELECT * FROM recordings WHERE id = ?').get(req.params.id);
    if (!recording) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    if (!recording.server_path) {
      return res.status(404).json({ error: 'Recording file not available' });
    }

    const filePath = path.join(STORAGE_DIR, recording.server_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Recording file not found on server' });
    }

    res.download(filePath, recording.filename || `recording_${recording.id}.mp4`);
  } catch (err) {
    console.error('Download recording error:', err.message);
    res.status(500).json({ error: 'Server error downloading recording' });
  }
});

module.exports = router;
