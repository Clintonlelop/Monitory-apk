const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

const VALID_STATUSES = ['QUEUED', 'SENDING', 'RECEIVED', 'EXECUTING', 'COMPLETED', 'FAILED'];

// POST /api/devices/:id/commands - create QUEUED command (dashboard auth)
router.post('/api/devices/:id/commands', auth, (req, res) => {
  try {
    const deviceId = req.params.id;
    const { type, payload } = req.body;

    if (!type || typeof type !== 'string') {
      return res.status(400).json({ error: 'Command type is required' });
    }

    const device = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId);
    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const payloadJson = payload ? JSON.stringify(payload) : null;
    const result = db.prepare(`INSERT INTO commands (device_id, type, payload, status) VALUES (?, ?, ?, 'QUEUED')`)
      .run(deviceId, type, payloadJson);

    const command = db.prepare('SELECT * FROM commands WHERE id = ?').get(result.lastInsertRowid);
    if (command.payload) command.payload = JSON.parse(command.payload);
    if (command.result) command.result = JSON.parse(command.result);

    // If device is online via WS, send command immediately
    const sent = wsManager.sendToDevice(parseInt(deviceId), { type: 'COMMAND', command });
    if (sent) {
      db.prepare(`UPDATE commands SET status = 'SENDING', updated_at = datetime('now') WHERE id = ?`).run(command.id);
      command.status = 'SENDING';
    }

    // Log activity
    db.prepare(`INSERT INTO activity_events (device_id, event_type, description, metadata) VALUES (?, 'COMMAND_QUEUED', ?, ?)`)
      .run(parseInt(deviceId), `Command "${type}" queued`, JSON.stringify({ command_id: command.id, type }));

    res.status(201).json(command);
  } catch (err) {
    console.error('Create command error:', err.message);
    res.status(500).json({ error: 'Server error creating command' });
  }
});

// GET /api/devices/:id/commands - command history (dashboard auth)
router.get('/api/devices/:id/commands', auth, (req, res) => {
  try {
    const deviceId = req.params.id;
    const { status, limit = 50 } = req.query;
    const lim = Math.min(parseInt(limit) || 50, 500);

    let query = 'SELECT * FROM commands WHERE device_id = ?';
    const params = [deviceId];

    if (status && VALID_STATUSES.includes(status.toUpperCase())) {
      query += ' AND status = ?';
      params.push(status.toUpperCase());
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);

    const commands = db.prepare(query).all(...params);
    for (const c of commands) {
      if (c.payload) c.payload = JSON.parse(c.payload);
      if (c.result) c.result = JSON.parse(c.result);
    }

    res.json(commands);
  } catch (err) {
    console.error('List commands error:', err.message);
    res.status(500).json({ error: 'Server error fetching commands' });
  }
});

// GET /api/devices/:id/commands/pending - device fetches pending commands (device auth)
router.get('/api/devices/:id/commands/pending', deviceAuth, (req, res) => {
  try {
    const deviceId = req.params.id;
    if (String(req.device.id) !== String(deviceId)) {
      return res.status(403).json({ error: 'Device token does not match device ID' });
    }

    const commands = db.prepare(`SELECT * FROM commands WHERE device_id = ? AND status IN ('QUEUED', 'SENDING') ORDER BY created_at ASC`).all(deviceId);

    for (const c of commands) {
      if (c.payload) c.payload = JSON.parse(c.payload);
      if (c.result) c.result = JSON.parse(c.result);
      // Mark as RECEIVED
      db.prepare(`UPDATE commands SET status = 'RECEIVED', updated_at = datetime('now') WHERE id = ?`).run(c.id);
      c.status = 'RECEIVED';
    }

    res.json(commands);
  } catch (err) {
    console.error('Pending commands error:', err.message);
    res.status(500).json({ error: 'Server error fetching pending commands' });
  }
});

// PUT /api/commands/:id/status - device updates command status (device auth)
router.put('/api/commands/:id/status', deviceAuth, (req, res) => {
  try {
    const commandId = req.params.id;
    const { status, result, error } = req.body;

    if (!status || !VALID_STATUSES.includes(status.toUpperCase())) {
      return res.status(400).json({ error: `Valid status required: ${VALID_STATUSES.join(', ')}` });
    }

    const command = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (!command) {
      return res.status(404).json({ error: 'Command not found' });
    }

    if (String(req.device.id) !== String(command.device_id)) {
      return res.status(403).json({ error: 'Device token does not match command device' });
    }

    const resultJson = result ? JSON.stringify(result) : null;
    const upperStatus = status.toUpperCase();
    const completedAt = ['COMPLETED', 'FAILED'].includes(upperStatus) ? new Date().toISOString() : null;

    db.prepare(`UPDATE commands SET status = ?, result = COALESCE(?, result), error_message = ?, updated_at = datetime('now'), completed_at = COALESCE(?, completed_at) WHERE id = ?`)
      .run(upperStatus, resultJson, error || null, completedAt, commandId);

    const updated = db.prepare('SELECT * FROM commands WHERE id = ?').get(commandId);
    if (updated.payload) updated.payload = JSON.parse(updated.payload);
    if (updated.result) updated.result = JSON.parse(updated.result);

    // Broadcast to dashboard
    const eventType = upperStatus === 'COMPLETED' ? 'COMMAND_COMPLETED' : upperStatus === 'FAILED' ? 'COMMAND_FAILED' : null;
    if (eventType) {
      wsManager.broadcastToDashboards(wsManager.buildEvent(eventType, command.device_id, { command: updated }));
    }

    res.json(updated);
  } catch (err) {
    console.error('Update command status error:', err.message);
    res.status(500).json({ error: 'Server error updating command status' });
  }
});

module.exports = router;
