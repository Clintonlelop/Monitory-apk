const express = require('express');
const crypto = require('crypto');
const db = require('../db/database');
const auth = require('../middleware/auth');
const wsManager = require('../ws/manager');

const router = express.Router();

// ============================================================
// In-memory active sessions (device_id -> session info)
// ============================================================
const activeSessions = new Map();

/**
 * Get active session for a device.
 */
function getActiveSession(deviceId) {
  return activeSessions.get(String(deviceId)) || null;
}

/**
 * Set active session for a device.
 */
function setActiveSession(deviceId, session) {
  activeSessions.set(String(deviceId), session);
}

/**
 * Remove active session for a device.
 */
function removeActiveSession(deviceId) {
  activeSessions.delete(String(deviceId));
}

// ============================================================
// POST /api/remote/:deviceId/start - Start a remote control session
// ============================================================
router.post('/:deviceId/start', auth, (req, res) => {
  try {
    const deviceId = parseInt(req.params.deviceId);
    const { target_fps = 30, target_quality = 70, low_latency = false } = req.body || {};

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Check if device is online
    if (!wsManager.isDeviceOnline(deviceId)) {
      return res.status(400).json({ error: 'Device is offline. Cannot start remote control session.' });
    }

    // Check if there's already an active session
    const existing = getActiveSession(deviceId);
    if (existing && existing.status === 'ACTIVE') {
      return res.status(409).json({ error: 'Remote control session already active', session: existing });
    }

    // Generate session ID
    const sessionId = crypto.randomBytes(8).toString('hex');

    // Create session record in DB
    db.prepare(`INSERT INTO remote_sessions (device_id, session_id, status, target_fps, target_quality, low_latency)
      VALUES (?, ?, 'ACTIVE', ?, ?, ?)`)
      .run(deviceId, sessionId,
        parseInt(target_fps) || 30,
        parseInt(target_quality) || 70,
        low_latency ? 1 : 0);

    const session = {
      id: sessionId,
      device_id: deviceId,
      status: 'ACTIVE',
      started_at: new Date().toISOString(),
      target_fps: parseInt(target_fps) || 30,
      target_quality: parseInt(target_quality) || 70,
      low_latency: !!low_latency
    };

    setActiveSession(deviceId, session);

    // Send START_REMOTE_CONTROL command to device via WebSocket
    wsManager.sendToDevice(deviceId, {
      type: 'COMMAND',
      command: {
        id: `remote_${sessionId}`,
        type: 'START_REMOTE_CONTROL',
        payload: {
          target_fps: session.target_fps,
          target_quality: session.target_quality,
          low_latency: session.low_latency
        }
      }
    });

    // Log activity
    db.prepare(`INSERT INTO activity_events (device_id, event_type, description) VALUES (?, 'REMOTE_CONTROL_STARTED', ?)`)
      .run(deviceId, `Remote control session started (${sessionId})`);

    console.log(`[Remote] Session started: ${sessionId} for device ${deviceId}`);

    res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('Remote start error:', err.message);
    res.status(500).json({ error: 'Server error starting remote session' });
  }
});

// ============================================================
// POST /api/remote/:deviceId/stop - Stop a remote control session
// ============================================================
router.post('/:deviceId/stop', auth, (req, res) => {
  try {
    const deviceId = parseInt(req.params.deviceId);

    const session = getActiveSession(deviceId);
    if (!session) {
      return res.status(404).json({ error: 'No active remote control session' });
    }

    // Calculate duration
    const startedAt = new Date(session.started_at).getTime();
    const durationSec = Math.floor((Date.now() - startedAt) / 1000);

    // Update DB record
    db.prepare(`UPDATE remote_sessions SET status = 'ENDED', ended_at = datetime('now'), duration_seconds = ? WHERE session_id = ?`)
      .run(durationSec, session.id);

    // Send STOP_REMOTE_CONTROL command to device
    wsManager.sendToDevice(deviceId, {
      type: 'COMMAND',
      command: {
        id: `remote_stop_${session.id}`,
        type: 'STOP_REMOTE_CONTROL',
        payload: {}
      }
    });

    // Remove from active sessions
    removeActiveSession(deviceId);

    // Log activity
    db.prepare(`INSERT INTO activity_events (device_id, event_type, description) VALUES (?, 'REMOTE_CONTROL_STOPPED', ?)`)
      .run(deviceId, `Remote control session stopped (${session.id}), duration: ${durationSec}s`);

    console.log(`[Remote] Session stopped: ${session.id} for device ${deviceId}, duration: ${durationSec}s`);

    res.json({ success: true, session: { ...session, status: 'ENDED', duration_seconds: durationSec } });
  } catch (err) {
    console.error('Remote stop error:', err.message);
    res.status(500).json({ error: 'Server error stopping remote session' });
  }
});

// ============================================================
// GET /api/remote/:deviceId/status - Get remote session status
// ============================================================
router.get('/:deviceId/status', auth, (req, res) => {
  try {
    const deviceId = parseInt(req.params.deviceId);

    const session = getActiveSession(deviceId);
    const deviceOnline = wsManager.isDeviceOnline(deviceId);

    if (session) {
      const durationSec = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000);
      return res.json({
        active: true,
        session: { ...session, duration_seconds: durationSec },
        device_online: deviceOnline
      });
    }

    // Check DB for most recent session
    const recent = db.prepare(`SELECT * FROM remote_sessions WHERE device_id = ? ORDER BY started_at DESC LIMIT 1`).get(deviceId);

    res.json({
      active: false,
      session: recent || null,
      device_online: deviceOnline
    });
  } catch (err) {
    console.error('Remote status error:', err.message);
    res.status(500).json({ error: 'Server error fetching remote status' });
  }
});

// ============================================================
// GET /api/remote/:deviceId/metrics - Get recent quality reports
// ============================================================
router.get('/:deviceId/metrics', auth, (req, res) => {
  try {
    const deviceId = parseInt(req.params.deviceId);
    const { limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 500);

    const reports = db.prepare(`SELECT * FROM remote_quality_reports WHERE device_id = ? ORDER BY created_at DESC LIMIT ?`)
      .all(deviceId, lim);

    // Calculate aggregate stats
    const stats = {
      count: reports.length,
      avg_latency_ms: reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + (r.latency_ms || 0), 0) / reports.length)
        : 0,
      avg_jitter_ms: reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + (r.jitter_ms || 0), 0) / reports.length)
        : 0,
      avg_packet_loss_pct: reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + (r.packet_loss_pct || 0), 0) / reports.length * 10) / 10
        : 0,
      avg_fps: reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + (r.fps || 0), 0) / reports.length)
        : 0,
      avg_bitrate_kbps: reports.length > 0
        ? Math.round(reports.reduce((sum, r) => sum + (r.bitrate_kbps || 0), 0) / reports.length)
        : 0
    };

    res.json({ reports, stats });
  } catch (err) {
    console.error('Remote metrics error:', err.message);
    res.status(500).json({ error: 'Server error fetching remote metrics' });
  }
});

// ============================================================
// GET /api/remote/:deviceId/sessions - Get session history
// ============================================================
router.get('/:deviceId/sessions', auth, (req, res) => {
  try {
    const deviceId = parseInt(req.params.deviceId);
    const { limit = 20 } = req.query;
    const lim = Math.min(parseInt(limit) || 20, 200);

    const sessions = db.prepare(`SELECT * FROM remote_sessions WHERE device_id = ? ORDER BY started_at DESC LIMIT ?`)
      .all(deviceId, lim);

    res.json(sessions);
  } catch (err) {
    console.error('Remote sessions error:', err.message);
    res.status(500).json({ error: 'Server error fetching sessions' });
  }
});

module.exports = { router, getActiveSession, setActiveSession, removeActiveSession };
