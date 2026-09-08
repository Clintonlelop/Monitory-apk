const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

const db = require('./src/db/database');
const { initSchema } = require('./src/db/schema');
const wsManager = require('./src/ws/manager');

// Route imports
const authRoutes = require('./src/routes/auth');
const deviceRoutes = require('./src/routes/devices');
const commandRoutes = require('./src/routes/commands');
const telemetryRoutes = require('./src/routes/telemetry');
const locationRoutes = require('./src/routes/locations');
const geofenceRoutes = require('./src/routes/geofences');
const notificationRoutes = require('./src/routes/notifications');
const usageRoutes = require('./src/routes/usage');
const contactRoutes = require('./src/routes/contacts');
const callRoutes = require('./src/routes/calls');
const smsRoutes = require('./src/routes/sms');
const fileRoutes = require('./src/routes/files');
const mediaRoutes = require('./src/routes/media');
const recordingRoutes = require('./src/routes/recordings');
const activityRoutes = require('./src/routes/activity');
const remoteRoutes = require('./src/routes/remote');
const transferRoutes = require('./src/routes/transfers');
const snapshotRoutes = require('./src/routes/snapshots');
const diagnosticRoutes = require('./src/routes/diagnostics');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const PORT = process.env.PORT || 3000;

// Initialize database
initSchema();
console.log('[DB] Schema initialized');

const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false });

app.use('/api/auth', authLimiter);
app.use('/api', apiLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/', commandRoutes); // uses full /api/... paths
app.use('/api', telemetryRoutes);
app.use('/api', locationRoutes);
app.use('/api/geofences', geofenceRoutes);
app.use('/api', notificationRoutes);
app.use('/api', usageRoutes);
app.use('/api', contactRoutes);
app.use('/api', callRoutes);
app.use('/api', smsRoutes);
app.use('/api', fileRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/recordings', recordingRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/remote', remoteRoutes.router);
app.use('/api/transfers', transferRoutes);
app.use('/api/snapshots', snapshotRoutes);
app.use('/api/diagnostics', diagnosticRoutes);

// 404 for API
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve dashboard static files
const dashboardDir = path.join(__dirname, '..', 'dashboard');
app.use(express.static(dashboardDir));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  const indexPath = path.join(dashboardDir, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      res.status(404).json({ error: 'Dashboard not found' });
    }
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// WebSocket Server
// ============================================================
const wss = new WebSocketServer({ server, path: '/ws' });

function setDeviceOnline(deviceId, online) {
  db.prepare('UPDATE devices SET online = ?, last_seen = datetime(\'now\') WHERE id = ?').run(online ? 1 : 0, deviceId);
}

/**
 * Handle COMMAND_STATUS from device (extracted from inline handler).
 */
function handleCommandStatus(msg, deviceId) {
  const { command_id, status, result, error } = msg;
  const validStatuses = ['QUEUED', 'SENDING', 'RECEIVED', 'EXECUTING', 'COMPLETED', 'FAILED'];

  if (!status || !validStatuses.includes(status.toUpperCase())) {
    return;
  }

  const command = db.prepare('SELECT * FROM commands WHERE id = ?').get(command_id);
  if (!command || String(command.device_id) !== String(deviceId)) {
    return;
  }

  const resultJson = result ? JSON.stringify(result) : null;
  const upperStatus = status.toUpperCase();
  const completedAt = ['COMPLETED', 'FAILED'].includes(upperStatus) ? new Date().toISOString() : null;

  db.prepare(`UPDATE commands SET status = ?, result = COALESCE(?, result), error_message = ?, updated_at = datetime('now'), completed_at = COALESCE(?, completed_at) WHERE id = ?`)
    .run(upperStatus, resultJson, error || null, completedAt, command_id);

  const updated = db.prepare('SELECT * FROM commands WHERE id = ?').get(command_id);
  if (updated.payload) { try { updated.payload = JSON.parse(updated.payload); } catch (_) {} }
  if (updated.result) { try { updated.result = JSON.parse(updated.result); } catch (_) {} }

  const eventType = upperStatus === 'COMPLETED' ? 'COMMAND_COMPLETED' : upperStatus === 'FAILED' ? 'COMMAND_FAILED' : null;
  if (eventType) {
    wsManager.broadcastToDashboards(wsManager.buildEvent(eventType, deviceId, { command: updated }));
  }
}

/**
 * Store a quality report from device in the database.
 */
function storeQualityReport(deviceId, msg) {
  try {
    // Get active session ID if any
    const activeSession = remoteRoutes.getActiveSession(deviceId);
    const sessionId = activeSession ? activeSession.id : null;

    db.prepare(`INSERT INTO remote_quality_reports
      (device_id, session_id, latency_ms, jitter_ms, packet_loss_pct, fps, resolution,
       bitrate_kbps, network_type, quality, frame_interval_ms, low_latency,
       adjustment_reason, input_latency_ms, upload_speed_kbps, download_speed_kbps,
       ws_state, reconnection_attempts, battery_temp, battery_level, cpu_load, session_duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        deviceId,
        sessionId,
        msg.latency_ms != null ? parseInt(msg.latency_ms) : null,
        msg.jitter_ms != null ? parseInt(msg.jitter_ms) : null,
        msg.packet_loss_pct != null ? parseFloat(msg.packet_loss_pct) : null,
        msg.fps != null ? parseInt(msg.fps) : null,
        msg.resolution || null,
        msg.bitrate_kbps != null ? parseInt(msg.bitrate_kbps) : null,
        msg.network_type || null,
        msg.quality != null ? parseInt(msg.quality) : null,
        msg.frame_interval_ms != null ? parseInt(msg.frame_interval_ms) : null,
        msg.low_latency ? 1 : 0,
        msg.adjustment_reason || null,
        msg.input_latency_ms != null ? parseInt(msg.input_latency_ms) : null,
        msg.upload_speed_kbps != null ? parseInt(msg.upload_speed_kbps) : null,
        msg.download_speed_kbps != null ? parseInt(msg.download_speed_kbps) : null,
        msg.ws_state || null,
        msg.reconnection_attempts != null ? parseInt(msg.reconnection_attempts) : null,
        msg.battery_temp != null ? parseFloat(msg.battery_temp) : null,
        msg.battery_level != null ? parseInt(msg.battery_level) : null,
        msg.cpu_load != null ? parseFloat(msg.cpu_load) : null,
        msg.session_duration_ms != null ? parseInt(msg.session_duration_ms) : null
      );
  } catch (e) {
    console.error('[WS] Store quality report error:', e.message);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const deviceToken = url.searchParams.get('device_token');

  let role = null;
  let deviceId = null;

  // Dashboard auth via JWT
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      role = 'dashboard';
      wsManager.addDashboard(ws);
      console.log('[WS] Dashboard connected:', decoded.username);
    } catch (e) {
      ws.close(4001, 'Invalid token');
      return;
    }
  }
  // Device auth via device_token
  else if (deviceToken) {
    const device = db.prepare('SELECT * FROM devices WHERE device_token = ?').get(deviceToken);
    if (!device) {
      ws.close(4002, 'Invalid device token');
      return;
    }
    role = 'device';
    deviceId = device.id;
    wsManager.addDevice(deviceId, ws);
    setDeviceOnline(deviceId, true);

    // Track connect event
    try {
      db.prepare(`INSERT INTO connection_events (device_id, event_type, reason)
        VALUES (?, 'CONNECT', 'websocket')`).run(deviceId);
    } catch (e) {
      console.error('[WS] Connect event store error:', e.message);
    }

    // Check if this is a reconnect (was recently offline)
    const recentDisconnect = db.prepare(
      `SELECT timestamp FROM connection_events WHERE device_id = ? AND event_type = 'DISCONNECT' ORDER BY timestamp DESC LIMIT 1`
    ).get(deviceId);

    if (recentDisconnect) {
      // Calculate downtime
      const disconnectTime = new Date(recentDisconnect.timestamp).getTime();
      const downtimeMs = Date.now() - disconnectTime;
      const downtimeSeconds = Math.round(downtimeMs / 1000);

      wsManager.broadcastToDashboards(wsManager.buildEvent('DEVICE_RECONNECTED', deviceId, {
        name: device.name, model: device.model,
        downtime_seconds: downtimeSeconds,
        attempt: 1
      }));
    } else {
      // Broadcast DEVICE_ONLINE
      wsManager.broadcastToDashboards(wsManager.buildEvent('DEVICE_ONLINE', deviceId, {
        name: device.name, model: device.model
      }));
    }

    db.prepare(`INSERT INTO activity_events (device_id, event_type, description) VALUES (?, 'DEVICE_ONLINE', ?)`)
      .run(deviceId, `Device "${device.name || device.device_token}" came online`);

    // On reconnect: send any QUEUED/SENDING commands
    try {
      const pendingCommands = db.prepare(
        `SELECT * FROM commands WHERE device_id = ? AND status IN ('QUEUED', 'SENDING') ORDER BY created_at ASC`
      ).all(deviceId);

      for (const cmd of pendingCommands) {
        let payload = null;
        try { payload = cmd.payload ? JSON.parse(cmd.payload) : null; } catch (_) {}
        wsManager.sendToDevice(deviceId, {
          type: 'COMMAND',
          command: {
            id: String(cmd.id),
            type: cmd.type,
            payload,
            created_at: cmd.created_at
          }
        });
        db.prepare(`UPDATE commands SET status = 'SENDING', updated_at = datetime('now') WHERE id = ?`).run(cmd.id);
      }
    } catch (e) {
      console.error('[WS] Reconnect command flush error:', e.message);
    }

    console.log('[WS] Device connected:', deviceId, device.name || device.device_token);
  } else {
    ws.close(4000, 'Authentication required');
    return;
  }

  // Handle incoming messages
  ws.on('message', (data) => {
    const byteLen = data.length;
    wsManager.recordIncoming(ws, byteLen);

    try {
      const msg = JSON.parse(data.toString());
      const msgType = msg.type;

      // ── Messages from devices ──
      if (role === 'device') {
        if (msgType === 'COMMAND_STATUS' && msg.command_id) {
          handleCommandStatus(msg, deviceId);
        } else if (msgType === 'SCREEN_FRAME') {
          // Relay screen frame to dashboards
          const { frame_data, width, height, timestamp, fps, quality, sequence } = msg;
          wsManager.relayScreenFrame(deviceId, {
            frame_data, width, height, timestamp, fps, quality, sequence
          });
        } else if (msgType === 'QUALITY_REPORT') {
          // Store quality report and relay to dashboards
          storeQualityReport(deviceId, msg);
          wsManager.relayQualityReport(deviceId, msg);
        } else if (msgType === 'PING') {
          // Respond with PONG for latency measurement
          ws.send(JSON.stringify({ type: 'PONG', seq: msg.seq, timestamp: Date.now() }));
        } else if (msgType === 'CONNECTION_STATE_CHANGED') {
          // Device reports connection state changes
          const { state, reason, attempt } = msg;
          try {
            db.prepare(`INSERT INTO connection_events (device_id, event_type, reason)
              VALUES (?, ?, ?)`).run(deviceId, state || 'STATE_CHANGE', reason || null);
          } catch (e) {
            console.error('[WS] Connection event store error:', e.message);
          }
          wsManager.broadcastToDashboards(wsManager.buildEvent('CONNECTION_STATE_CHANGED', deviceId, {
            state, reason, attempt,
            timestamp: new Date().toISOString()
          }));
        }
      }
      // ── Messages from dashboards ──
      else if (role === 'dashboard') {
        if (msgType === 'INPUT_EVENT' && msg.device_id) {
          // Relay input event to device
          const targetDeviceId = msg.device_id;
          const { action, x, y, x2, y2, duration, key_code } = msg;
          wsManager.relayInputEvent(targetDeviceId, {
            action, x, y, x2, y2, duration, key_code
          });
        } else if (msgType === 'STREAM_CONTROL' && msg.device_id) {
          // Relay stream control to device
          const targetDeviceId = msg.device_id;
          const { action, target_fps, target_quality, low_latency } = msg;
          wsManager.relayStreamControl(targetDeviceId, {
            action, target_fps, target_quality, low_latency
          });
        }
      }
    } catch (e) {
      console.error('[WS] Message parse error:', e.message);
    }
  });

  // Handle disconnect
  ws.on('close', (code, reason) => {
    if (role === 'dashboard') {
      wsManager.removeDashboard(ws);
      console.log('[WS] Dashboard disconnected');
    } else if (role === 'device' && deviceId) {
      wsManager.removeDevice(deviceId, ws);

      // Only mark offline if no other connections for this device
      if (!wsManager.isDeviceOnline(deviceId)) {
        setDeviceOnline(deviceId, false);

        // Track disconnect event
        try {
          const disconnectReason = code === 1000 ? 'normal' : (code === 1006 ? 'timeout/abnormal' : `code_${code}`);
          db.prepare(`INSERT INTO connection_events (device_id, event_type, reason)
            VALUES (?, 'DISCONNECT', ?)`).run(deviceId, disconnectReason);
        } catch (e) {
          console.error('[WS] Disconnect event store error:', e.message);
        }

        wsManager.broadcastToDashboards(wsManager.buildEvent('DEVICE_OFFLINE', deviceId, {
          reason: code === 1000 ? 'normal' : 'abnormal',
          code
        }));

        const device = db.prepare('SELECT name FROM devices WHERE id = ?').get(deviceId);
        db.prepare(`INSERT INTO activity_events (device_id, event_type, description) VALUES (?, 'DEVICE_OFFLINE', ?)`)
          .run(deviceId, `Device "${device?.name || deviceId}" went offline`);

        console.log('[WS] Device disconnected:', deviceId, 'code:', code);
      }
    }
  });

  ws.on('error', (err) => {
    console.error('[WS] Error:', err.message);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`[Server] Android MDM Backend running on port ${PORT}`);
  console.log(`[Server] API: http://localhost:${PORT}/api`);
  console.log(`[Server] WS:  ws://localhost:${PORT}/ws`);
  console.log(`[Server] Dashboard: http://localhost:${PORT}/`);
});

module.exports = { app, server };
