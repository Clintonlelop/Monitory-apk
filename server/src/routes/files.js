const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', '..', '..', 'storage');
if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
  'video/mp4', 'video/3gpp', 'video/webm', 'video/avi',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg', 'audio/aac',
  'application/pdf', 'application/zip', 'text/plain', 'text/csv',
  'application/octet-stream'
];

const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, STORAGE_DIR); },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.bin';
    const randomName = crypto.randomBytes(16).toString('hex');
    cb(null, `${randomName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  }
});

// POST /api/files/sync - device sends file metadata (device auth)
router.post('/files/sync', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { files } = req.body;

    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'files array is required' });
    }

    const insert = db.prepare(`INSERT INTO files (device_id, filename, file_type, size_bytes, file_path, mime_type, date_modified) VALUES (?, ?, ?, ?, ?, ?, ?)`);

    const tx = db.transaction((items) => {
      for (const f of items) {
        if (!f.filename) continue;
        insert.run(device.id, f.filename, f.file_type || null, f.size_bytes != null ? parseInt(f.size_bytes) : null, f.file_path || null, f.mime_type || null, f.date_modified || null);
      }
    });
    tx(files);

    wsManager.broadcastToDashboards(wsManager.buildEvent('FILES_SYNCED', device.id, { count: files.length }));

    res.status(201).json({ success: true, recorded: files.length });
  } catch (err) {
    console.error('Files sync error:', err.message);
    res.status(500).json({ error: 'Server error syncing files' });
  }
});

// GET /api/devices/:id/files - file metadata list (dashboard auth)
router.get('/devices/:deviceId/files', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { type, limit = 100 } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 500);

    let query = 'SELECT * FROM files WHERE device_id = ?';
    const params = [deviceId];

    if (type) {
      query += ' AND file_type = ?';
      params.push(type);
    }

    query += ' ORDER BY date_modified DESC, created_at DESC LIMIT ?';
    params.push(lim);

    const files = db.prepare(query).all(...params);
    res.json(files);
  } catch (err) {
    console.error('Get files error:', err.message);
    res.status(500).json({ error: 'Server error fetching files' });
  }
});

// POST /api/upload - multipart upload (device auth)
router.post('/upload', deviceAuth, upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const device = req.device;
    const { file_type } = req.body;
    const mediaType = file_type || 'document';

    const result = db.prepare(`INSERT INTO media (device_id, filename, media_type, size_bytes, server_path) VALUES (?, ?, ?, ?, ?)`)
      .run(device.id, req.file.originalname, mediaType, req.file.size, req.file.filename);

    const media = db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid);

    wsManager.broadcastToDashboards(wsManager.buildEvent('MEDIA_UPLOADED', device.id, { media }));

    db.prepare(`INSERT INTO activity_events (device_id, event_type, description, metadata) VALUES (?, 'MEDIA_UPLOADED', ?, ?)`)
      .run(device.id, `File "${req.file.originalname}" uploaded`, JSON.stringify({ media_id: media.id, size: req.file.size }));

    res.status(201).json({ success: true, media });
  } catch (err) {
    console.error('Upload error:', err.message);
    res.status(500).json({ error: 'Server error during upload' });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

module.exports = router;
module.exports.STORAGE_DIR = STORAGE_DIR;
