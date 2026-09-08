/**
 * snapshots.js — Device state snapshot endpoints
 *
 * Supports:
 * - POST /api/snapshots                     — create a snapshot (device auth)
 * - GET  /api/devices/:id/snapshots         — list snapshots (dashboard auth)
 * - GET  /api/snapshots/:id                 — get full snapshot (dashboard auth)
 * - GET  /api/snapshots/compare?from_id=&to_id= — compare two snapshots
 */

const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

// ── POST /api/snapshots (device auth) ──────────────────────────────
router.post('/', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const { snapshot_data } = req.body;

    if (!snapshot_data || typeof snapshot_data !== 'object') {
      return res.status(400).json({ error: 'snapshot_data (object) is required' });
    }

    const dataJson = JSON.stringify(snapshot_data);

    const result = db.prepare(
      'INSERT INTO snapshots (device_id, data) VALUES (?, ?)'
    ).run(device.id, dataJson);

    // Build summary for WS event
    const summary = buildSummary(snapshot_data);

    wsManager.broadcastToDashboards(wsManager.buildEvent('SNAPSHOT_CREATED', device.id, {
      snapshot_id: result.lastInsertRowid,
      device_id: device.id,
      summary,
      created_at: new Date().toISOString()
    }));

    res.status(201).json({
      id: result.lastInsertRowid,
      device_id: device.id,
      created_at: new Date().toISOString()
    });
  } catch (err) {
    console.error('[Snapshots] Create error:', err.message);
    res.status(500).json({ error: 'Failed to create snapshot' });
  }
});

// ── GET /api/devices/:id/snapshots (dashboard auth) ────────────────
router.get('/devices/:deviceId/snapshots', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 200);

    const snapshots = db.prepare(
      'SELECT id, device_id, data, created_at FROM snapshots WHERE device_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(deviceId, lim);

    // Parse and add summary
    const result = snapshots.map(s => {
      let data = {};
      try { data = JSON.parse(s.data); } catch (_) {}
      return {
        id: s.id,
        device_id: s.device_id,
        created_at: s.created_at,
        summary: buildSummary(data)
      };
    });

    res.json(result);
  } catch (err) {
    console.error('[Snapshots] List error:', err.message);
    res.status(500).json({ error: 'Failed to list snapshots' });
  }
});

// ── GET /api/snapshots/compare (dashboard auth) ────────────────────
router.get('/compare', auth, (req, res) => {
  try {
    const { from_id, to_id } = req.query;

    if (!from_id || !to_id) {
      return res.status(400).json({ error: 'from_id and to_id are required' });
    }

    const fromSnap = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(from_id);
    const toSnap = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(to_id);

    if (!fromSnap || !toSnap) {
      return res.status(404).json({ error: 'One or both snapshots not found' });
    }

    let fromData = {}, toData = {};
    try { fromData = JSON.parse(fromSnap.data); } catch (_) {}
    try { toData = JSON.parse(toSnap.data); } catch (_) {}

    const diff = deepDiff(fromData, toData);

    res.json({
      from_id: parseInt(from_id),
      to_id: parseInt(to_id),
      from_created_at: fromSnap.created_at,
      to_created_at: toSnap.created_at,
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed
    });
  } catch (err) {
    console.error('[Snapshots] Compare error:', err.message);
    res.status(500).json({ error: 'Failed to compare snapshots' });
  }
});

// ── GET /api/snapshots/:id (dashboard auth) ────────────────────────
router.get('/:id', auth, (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(id);
    if (!snapshot) {
      return res.status(404).json({ error: 'Snapshot not found' });
    }

    let data = {};
    try { data = JSON.parse(snapshot.data); } catch (_) {}

    res.json({
      id: snapshot.id,
      device_id: snapshot.device_id,
      data,
      created_at: snapshot.created_at
    });
  } catch (err) {
    console.error('[Snapshots] Get error:', err.message);
    res.status(500).json({ error: 'Failed to get snapshot' });
  }
});

// ── Helper: build a summary from snapshot data ─────────────────────
function buildSummary(data) {
  const battery = data.battery || {};
  const storage = data.storage || {};
  const network = data.network || {};
  return {
    battery_level: battery.level != null ? battery.level : null,
    charging: battery.charging || false,
    storage_used_pct: storage.total && storage.used
      ? Math.round((storage.used / storage.total) * 100)
      : null,
    network_type: network.type || null,
    android_version: data.device_info?.android_version || null,
    app_version: data.device_info?.app_version || null
  };
}

// ── Helper: deep diff of two objects ───────────────────────────────
function deepDiff(from, to, prefix = '') {
  const added = [];
  const removed = [];
  const changed = [];

  const allKeys = new Set([
    ...Object.keys(from || {}),
    ...Object.keys(to || {})
  ]);

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const fromVal = from ? from[key] : undefined;
    const toVal = to ? to[key] : undefined;

    if (fromVal === undefined && toVal !== undefined) {
      added.push({ field: path, value: toVal });
    } else if (fromVal !== undefined && toVal === undefined) {
      removed.push({ field: path, value: fromVal });
    } else if (typeof fromVal === 'object' && fromVal !== null &&
               typeof toVal === 'object' && toVal !== null &&
               !Array.isArray(fromVal) && !Array.isArray(toVal)) {
      const nested = deepDiff(fromVal, toVal, path);
      added.push(...nested.added);
      removed.push(...nested.removed);
      changed.push(...nested.changed);
    } else if (JSON.stringify(fromVal) !== JSON.stringify(toVal)) {
      changed.push({ field: path, old_value: fromVal, new_value: toVal });
    }
  }

  return { added, removed, changed };
}

module.exports = router;
