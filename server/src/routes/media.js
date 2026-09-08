const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const { STORAGE_DIR } = require('./files');

const router = express.Router();

// GET /api/media - list uploaded media (dashboard auth)
router.get('/', auth, (req, res) => {
  try {
    const { device_id, type, limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    let query = 'SELECT * FROM media WHERE 1=1';
    const params = [];

    if (device_id) {
      query += ' AND device_id = ?';
      params.push(device_id);
    }
    if (type) {
      query += ' AND media_type = ?';
      params.push(type);
    }

    query += ' ORDER BY uploaded_at DESC LIMIT ?';
    params.push(lim);

    const media = db.prepare(query).all(...params);
    res.json(media);
  } catch (err) {
    console.error('List media error:', err.message);
    res.status(500).json({ error: 'Server error fetching media' });
  }
});

// GET /api/media/:id/download - download file with Range support (dashboard auth)
router.get('/:id/download', auth, (req, res) => {
  try {
    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(req.params.id);
    if (!media) {
      return res.status(404).json({ error: 'Media not found' });
    }

    const filePath = path.join(STORAGE_DIR, media.server_path);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = (end - start) + 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`);
        return res.end();
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': media.media_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(media.filename)}"`
      });

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Accept-Ranges': 'bytes',
        'Content-Type': media.media_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(media.filename)}"`
      });
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('Download media error:', err.message);
    res.status(500).json({ error: 'Server error downloading media' });
  }
});

module.exports = router;
