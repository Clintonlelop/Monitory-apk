/**
 * transfers.js — Smart chunked file transfer endpoints
 *
 * Supports:
 * - POST /api/transfers/init       — initialize a chunked upload
 * - POST /api/transfers/:id/chunk  — upload a single chunk
 * - POST /api/transfers/:id/complete — reassemble and verify
 * - GET  /api/transfers/:id/status — get upload status (for resume)
 * - GET  /api/transfers            — list active transfers
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

const STORAGE_DIR = path.join(__dirname, '..', '..', '..', 'storage');
const CHUNKS_DIR = path.join(STORAGE_DIR, 'chunks');
if (!fs.existsSync(CHUNKS_DIR)) {
  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
}

const DEFAULT_CHUNK_SIZE = 256 * 1024; // 256KB
const MIN_CHUNK_SIZE = 64 * 1024;
const MAX_CHUNK_SIZE = 1024 * 1024;

function generateTransferId() {
  return 'tr_' + crypto.randomBytes(12).toString('hex');
}

function md5Buffer(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

// ── POST /api/transfers/init (device auth) ─────────────────────────
router.post('/init', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { filename, size, checksum, mime_type } = req.body;

    if (!filename || size == null) {
      return res.status(400).json({ error: 'filename and size are required' });
    }

    const transferId = generateTransferId();
    const totalChunks = Math.max(1, Math.ceil(parseInt(size) / DEFAULT_CHUNK_SIZE));

    db.prepare(`INSERT INTO file_transfers
        (device_id, transfer_id, filename, size_bytes, mime_type, checksum, total_chunks, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`)
      .run(
        device.id,
        transferId,
        filename,
        parseInt(size),
        mime_type || 'application/octet-stream',
        checksum || null,
        totalChunks
      );

    // Create chunk directory
    const chunkDir = path.join(CHUNKS_DIR, transferId);
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }

    res.status(201).json({
      transfer_id: transferId,
      chunk_size: DEFAULT_CHUNK_SIZE,
      total_chunks: totalChunks
    });
  } catch (err) {
    console.error('[Transfers] Init error:', err.message);
    res.status(500).json({ error: 'Failed to initialize transfer' });
  }
});

// ── POST /api/transfers/:id/chunk (device auth) ────────────────────
router.post('/:id/chunk', deviceAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { chunk_index, total_chunks, checksum, data } = req.body;

    if (chunk_index == null || !data) {
      return res.status(400).json({ error: 'chunk_index and data are required' });
    }

    const transfer = db.prepare('SELECT * FROM file_transfers WHERE transfer_id = ?').get(id);
    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    if (String(transfer.device_id) !== String(req.device.id)) {
      return res.status(403).json({ error: 'Transfer does not belong to this device' });
    }

    if (transfer.status === 'COMPLETED') {
      return res.status(400).json({ error: 'Transfer already completed' });
    }

    // Decode base64 chunk data
    const chunkBuffer = Buffer.from(data, 'base64');
    const actualChecksum = md5Buffer(chunkBuffer);

    // Verify chunk checksum
    if (checksum && checksum.toLowerCase() !== actualChecksum) {
      return res.status(400).json({
        received: false,
        verified: false,
        error: 'Checksum mismatch',
        expected: checksum,
        actual: actualChecksum
      });
    }

    // Check if chunk already received (idempotent)
    const existing = db.prepare(
      'SELECT id FROM transfer_chunks WHERE transfer_id = ? AND chunk_index = ?'
    ).get(id, chunk_index);

    if (!existing) {
      // Save chunk to disk
      const chunkPath = path.join(CHUNKS_DIR, id, `${chunk_index}.bin`);
      fs.writeFileSync(chunkPath, chunkBuffer);

      // Record chunk in DB
      db.prepare(`INSERT INTO transfer_chunks (transfer_id, chunk_index, checksum, size_bytes)
        VALUES (?, ?, ?, ?)`)
        .run(id, parseInt(chunk_index), actualChecksum, chunkBuffer.length);

      // Update transfer status and uploaded count
      db.prepare(`UPDATE file_transfers SET
          status = 'UPLOADING',
          uploaded_chunks = (SELECT COUNT(*) FROM transfer_chunks WHERE transfer_id = ?),
          updated_at = datetime('now')
        WHERE transfer_id = ?`)
        .run(id, id);
    }

    // Broadcast progress
    const updated = db.prepare('SELECT * FROM file_transfers WHERE transfer_id = ?').get(id);
    wsManager.broadcastToDashboards(wsManager.buildEvent('TRANSFER_PROGRESS', transfer.device_id, {
      transfer_id: id,
      filename: transfer.filename,
      uploaded_chunks: updated.uploaded_chunks,
      total_chunks: updated.total_chunks,
      progress_pct: updated.total_chunks > 0
        ? Math.round((updated.uploaded_chunks / updated.total_chunks) * 100)
        : 0,
      status: updated.status
    }));

    res.json({
      received: true,
      verified: true,
      chunk_index: parseInt(chunk_index),
      uploaded_chunks: updated.uploaded_chunks,
      total_chunks: updated.total_chunks
    });
  } catch (err) {
    console.error('[Transfers] Chunk error:', err.message);
    res.status(500).json({ error: 'Failed to process chunk', details: err.message });
  }
});

// ── POST /api/transfers/:id/complete (device auth) ─────────────────
router.post('/:id/complete', deviceAuth, (req, res) => {
  try {
    const { id } = req.params;

    const transfer = db.prepare('SELECT * FROM file_transfers WHERE transfer_id = ?').get(id);
    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    if (String(transfer.device_id) !== String(req.device.id)) {
      return res.status(403).json({ error: 'Transfer does not belong to this device' });
    }

    // Verify all chunks received
    const chunks = db.prepare(
      'SELECT * FROM transfer_chunks WHERE transfer_id = ? ORDER BY chunk_index'
    ).all(id);

    if (chunks.length !== transfer.total_chunks) {
      return res.status(400).json({
        error: 'Not all chunks received',
        received: chunks.length,
        expected: transfer.total_chunks
      });
    }

    db.prepare(`UPDATE file_transfers SET status = 'COMPLETING', updated_at = datetime('now')
      WHERE transfer_id = ?`).run(id);

    // Reassemble file
    const outputPath = path.join(STORAGE_DIR, `${id}_${transfer.filename}`);
    const writeStream = fs.createWriteStream(outputPath);
    const hash = crypto.createHash('md5');

    for (let i = 0; i < transfer.total_chunks; i++) {
      const chunkPath = path.join(CHUNKS_DIR, id, `${i}.bin`);
      if (!fs.existsSync(chunkPath)) {
        writeStream.close();
        db.prepare(`UPDATE file_transfers SET status = 'FAILED', error_message = ?, updated_at = datetime('now')
          WHERE transfer_id = ?`).run(`Missing chunk ${i}`, id);
        return res.status(500).json({ error: `Missing chunk file ${i}` });
      }
      const chunkData = fs.readFileSync(chunkPath);
      writeStream.write(chunkData);
      hash.update(chunkData);
    }
    writeStream.end();

    const fileChecksum = hash.digest('hex');
    const verified = !transfer.checksum || transfer.checksum.toLowerCase() === fileChecksum;

    if (!verified) {
      db.prepare(`UPDATE file_transfers SET
          status = 'FAILED',
          error_message = 'Full file checksum mismatch',
          updated_at = datetime('now')
        WHERE transfer_id = ?`).run(id);

      wsManager.broadcastToDashboards(wsManager.buildEvent('TRANSFER_FAILED', transfer.device_id, {
        transfer_id: id,
        filename: transfer.filename,
        error: 'Checksum verification failed'
      }));

      return res.status(400).json({
        verified: false,
        error: 'Full file checksum mismatch',
        expected: transfer.checksum,
        actual: fileChecksum
      });
    }

    // Create media record
    const mediaResult = db.prepare(`INSERT INTO media
        (device_id, filename, media_type, size_bytes, server_path, uploaded_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))`)
      .run(
        transfer.device_id,
        transfer.filename,
        transfer.mime_type || 'application/octet-stream',
        transfer.size_bytes,
        `${id}_${transfer.filename}`
      );

    db.prepare(`UPDATE file_transfers SET
        status = 'COMPLETED',
        completed_at = datetime('now'),
        updated_at = datetime('now')
      WHERE transfer_id = ?`).run(id);

    // Clean up chunk files
    try {
      const chunkDir = path.join(CHUNKS_DIR, id);
      if (fs.existsSync(chunkDir)) {
        fs.readdirSync(chunkDir).forEach(f => {
          fs.unlinkSync(path.join(chunkDir, f));
        });
        fs.rmdirSync(chunkDir);
      }
    } catch (e) {
      console.error('[Transfers] Cleanup error:', e.message);
    }

    wsManager.broadcastToDashboards(wsManager.buildEvent('TRANSFER_COMPLETED', transfer.device_id, {
      transfer_id: id,
      filename: transfer.filename,
      file_id: mediaResult.lastInsertRowid,
      size_bytes: transfer.size_bytes,
      checksum: fileChecksum
    }));

    res.json({
      verified: true,
      file_id: mediaResult.lastInsertRowid,
      transfer_id: id,
      checksum: fileChecksum
    });
  } catch (err) {
    console.error('[Transfers] Complete error:', err.message);
    db.prepare(`UPDATE file_transfers SET status = 'FAILED', error_message = ?, updated_at = datetime('now')
      WHERE transfer_id = ?`).run(err.message, req.params.id);
    res.status(500).json({ error: 'Failed to complete transfer', details: err.message });
  }
});

// ── GET /api/transfers/:id/status (auth) ───────────────────────────
router.get('/:id/status', auth.combined, (req, res) => {
  try {
    const { id } = req.params;
    const transfer = db.prepare('SELECT * FROM file_transfers WHERE transfer_id = ?').get(id);
    if (!transfer) {
      return res.status(404).json({ error: 'Transfer not found' });
    }

    const chunks = db.prepare(
      'SELECT chunk_index FROM transfer_chunks WHERE transfer_id = ? ORDER BY chunk_index'
    ).all(id);

    const uploadedChunks = chunks.map(c => c.chunk_index);

    res.json({
      transfer_id: id,
      filename: transfer.filename,
      size_bytes: transfer.size_bytes,
      uploaded_chunks: uploadedChunks,
      uploaded_count: uploadedChunks.length,
      total_chunks: transfer.total_chunks,
      status: transfer.status,
      error_message: transfer.error_message,
      created_at: transfer.created_at,
      updated_at: transfer.updated_at
    });
  } catch (err) {
    console.error('[Transfers] Status error:', err.message);
    res.status(500).json({ error: 'Failed to get transfer status' });
  }
});

// ── GET /api/transfers (auth) ──────────────────────────────────────
router.get('/', auth, (req, res) => {
  try {
    const { device_id, status, limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);

    let query = 'SELECT * FROM file_transfers WHERE 1=1';
    const params = [];

    if (device_id) {
      query += ' AND device_id = ?';
      params.push(device_id);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);

    const transfers = db.prepare(query).all(...params);
    res.json(transfers);
  } catch (err) {
    console.error('[Transfers] List error:', err.message);
    res.status(500).json({ error: 'Failed to list transfers' });
  }
});

module.exports = router;
module.exports.CHUNKS_DIR = CHUNKS_DIR;
module.exports.STORAGE_DIR = STORAGE_DIR;
