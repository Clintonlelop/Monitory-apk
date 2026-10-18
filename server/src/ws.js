import { WebSocketServer } from 'ws';
import { db } from './db.js';
import { verifyTokenString } from './auth.js';

const MAX_WS_PAYLOAD = 256 * 1024; // 256 KB per message
const MSG_LIMIT = 120; // messages per window per socket
const MSG_WINDOW_MS = 60 * 1000;

const DEVICE_STATUSES = new Set(['ONLINE', 'OFFLINE', 'ENROLLED']);
const COMMAND_STATUS_FROM_DEVICE = new Set(['RECEIVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED']);

// ---------- data helpers (memory + PostgreSQL) ----------------------------

async function getDevice(deviceId) {
  if (db.isPostgres()) {
    const result = await db.query('SELECT id, user_id, status FROM devices WHERE id = $1', [deviceId]);
    return result.rows[0] || null;
  }
  return db.getMemoryStore().devices.get(deviceId) || null;
}

async function updateDeviceStatus(deviceId, status) {
  const now = new Date();
  if (db.isPostgres()) {
    await db.query(
      'UPDATE devices SET status = $1, last_seen = $2 WHERE id = $3',
      [status, now, deviceId]
    );
  } else {
    const dev = db.getMemoryStore().devices.get(deviceId);
    if (dev) {
      dev.status = status;
      dev.last_seen = now;
    }
  }
}

async function listPendingCommands(deviceId) {
  if (db.isPostgres()) {
    const result = await db.query(
      `SELECT id, device_id, command_type, parameters, status, timestamp FROM commands
       WHERE device_id = $1 AND status IN ('PENDING', 'QUEUED') ORDER BY timestamp ASC LIMIT 50`,
      [deviceId]
    );
    return result.rows.map(r => ({
      commandId: r.id,
      deviceId: r.device_id,
      commandType: r.command_type,
      parameters: r.parameters || {},
      status: r.status,
      timestamp: Number(r.timestamp)
    }));
  }
  return Array.from(db.getMemoryStore().commands.values())
    .filter(c => c.deviceId === deviceId && (c.status === 'PENDING' || c.status === 'QUEUED'))
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(c => ({
      commandId: c.commandId,
      deviceId: c.deviceId,
      commandType: c.commandType,
      parameters: c.parameters || {},
      status: c.status,
      timestamp: Number(c.timestamp)
    }));
}

async function markCommandStatus(deviceId, commandId, { status, result, errorMessage }) {
  const now = Date.now();
  let found = false;
  if (db.isPostgres()) {
    const upd = await db.query(
      `UPDATE commands SET status = $1, result = COALESCE($2, result), error_message = COALESCE($3, error_message),
       completion_timestamp = $4 WHERE id = $5 AND device_id = $6`,
      [status, result || null, errorMessage || null, status === 'COMPLETED' || status === 'FAILED' ? now : null, commandId, deviceId]
    );
    found = upd.rowCount > 0;
  } else {
    const cmd = db.getMemoryStore().commands.get(commandId);
    if (cmd && cmd.deviceId === deviceId) {
      cmd.status = status;
      if (result !== undefined) cmd.result = result;
      if (errorMessage !== undefined) cmd.error_message = errorMessage;
      if (status === 'COMPLETED' || status === 'FAILED') cmd.completion_timestamp = now;
      found = true;
    }
  }
  return found;
}

async function markCommandSent(commandId) {
  if (db.isPostgres()) {
    await db.query(`UPDATE commands SET status = 'SENT' WHERE id = $1 AND status IN ('PENDING', 'QUEUED')`, [commandId]);
  } else {
    const cmd = db.getMemoryStore().commands.get(commandId);
    if (cmd && (cmd.status === 'PENDING' || cmd.status === 'QUEUED')) cmd.status = 'SENT';
  }
}

// ---------------------------------------------------------------------------

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_PAYLOAD });

  const deviceSockets = new Map(); // deviceId -> WebSocket
  const dashboardSockets = new Set(); // Set<WebSocket> (each carries ws.userId)

  server.on('upgrade', (request, socket, head) => {
    // NOTE: request.url may contain a token query parameter (needed for browser
    // and Android clients). It is never logged below.
    let pathname;
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      pathname = url.pathname;
    } catch (_) {
      socket.destroy();
      return;
    }

    if (pathname !== '/ws/device' && pathname !== '/ws/dashboard') {
      socket.destroy();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    // Token from ?token= (required for browser/Android WS clients) or an
    // Authorization header for non-browser clients.
    const headerAuth = request.headers['authorization'];
    const headerToken = headerAuth && headerAuth.startsWith('Bearer ') ? headerAuth.slice(7) : null;
    const token = headerToken || url.searchParams.get('token');
    const decoded = verifyTokenString(token);

    if (!decoded) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    if (pathname === '/ws/device') {
      if (decoded.type !== 'device' || !decoded.deviceId) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      // The token's deviceId is authoritative; a mismatching client-supplied
      // deviceId is rejected (prevents impersonation).
      const claimedDeviceId = url.searchParams.get('deviceId');
      if (claimedDeviceId && claimedDeviceId !== decoded.deviceId) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    } else {
      if (decoded.type === 'device' || !decoded.id) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.authPayload = decoded;
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (ws, request) => {
    let pathname = '/ws/dashboard';
    try {
      pathname = new URL(request.url, `http://${request.headers.host || 'localhost'}`).pathname;
    } catch (_) {}

    // Per-socket message rate limiting
    let msgCount = 0;
    let msgWindowStart = Date.now();

    function rateLimited() {
      const now = Date.now();
      if (now - msgWindowStart > MSG_WINDOW_MS) {
        msgWindowStart = now;
        msgCount = 0;
      }
      msgCount += 1;
      return msgCount > MSG_LIMIT;
    }

    if (pathname === '/ws/device') {
      const deviceId = ws.authPayload.deviceId;

      (async () => {
        const device = await getDevice(deviceId);
        if (!device) {
          ws.close(4404, 'Unknown device');
          return;
        }

        // Replace any stale socket for this device.
        const previous = deviceSockets.get(deviceId);
        if (previous && previous !== ws && previous.readyState === previous.OPEN) {
          try { previous.close(4000, 'Replaced by new connection'); } catch (_) {}
        }
        deviceSockets.set(deviceId, ws);
        console.log(`[WS] Android device connected: ${deviceId}`);

        await updateDeviceStatus(deviceId, 'ONLINE');
        broadcastDeviceEvent(deviceId, {
          type: 'DEVICE_STATUS_CHANGED',
          deviceId,
          status: 'ONLINE',
          timestamp: Date.now()
        });

        // Deliver commands queued while the device was offline.
        try {
          const pending = await listPendingCommands(deviceId);
          for (const command of pending) {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'COMMAND', command }));
              await markCommandSent(command.commandId);
            }
          }
          if (pending.length > 0) {
            console.log(`[WS] Replayed ${pending.length} queued command(s) to ${deviceId}`);
          }
        } catch (e) {
          console.error('[WS] Failed to replay pending commands:', e.message);
        }
      })();

      ws.on('message', async (data) => {
        if (rateLimited()) {
          ws.close(4429, 'Too many messages');
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          await handleDeviceMessage(deviceId, msg);
        } catch (e) {
          console.error('[WS] Error processing device message:', e.message);
        }
      });

      ws.on('close', () => {
        if (deviceSockets.get(deviceId) === ws) {
          deviceSockets.delete(deviceId);
          console.log(`[WS] Android device disconnected: ${deviceId}`);
          updateDeviceStatus(deviceId, 'OFFLINE').catch(() => {});
          broadcastDeviceEvent(deviceId, {
            type: 'DEVICE_STATUS_CHANGED',
            deviceId,
            status: 'OFFLINE',
            timestamp: Date.now()
          });
        }
      });

      ws.on('error', (err) => {
        console.warn(`[WS] Device socket error (${deviceId}):`, err.message);
      });

    } else {
      ws.userId = ws.authPayload.id;
      dashboardSockets.add(ws);
      console.log(`[WS] Web dashboard client connected (user ${ws.userId})`);

      ws.on('message', async (data) => {
        if (rateLimited()) {
          ws.close(4429, 'Too many messages');
          return;
        }
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'PING') {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'PONG' }));
            }
          }
          // Other inbound dashboard messages are ignored (no command channel
          // from browsers over WS; commands go through authenticated HTTP).
        } catch (_) {}
      });

      ws.on('close', () => {
        dashboardSockets.delete(ws);
        console.log('[WS] Web dashboard client disconnected');
      });
    }
  });

  /**
   * Deliver an event to dashboard sockets of users who own the device.
   * Falls back to delivering nothing (not everything) if ownership cannot
   * be resolved — events must never leak across tenants.
   */
  async function broadcastDeviceEvent(deviceId, payload) {
    let ownerId = null;
    try {
      const device = await getDevice(deviceId);
      ownerId = device ? device.user_id : null;
    } catch (_) {
      return;
    }
    if (ownerId === null || ownerId === undefined) return;
    sendToUserDashboards(ownerId, payload);
  }

  function sendToUserDashboards(userId, payload) {
    const data = JSON.stringify(payload);
    for (const ws of dashboardSockets) {
      if (ws.userId === userId && ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
  }

  // Backwards-compatible name used by HTTP handlers. Events that carry a
  // deviceId are scoped to the owning user's dashboards; events without a
  // deviceId are dropped (there are no truly global events).
  function broadcastToDashboards(payload) {
    if (payload && payload.deviceId) {
      return broadcastDeviceEvent(payload.deviceId, payload);
    }
    return Promise.resolve();
  }

  function sendCommandToDevice(deviceId, command) {
    const ws = deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== ws.OPEN) {
      return false;
    }
    ws.send(JSON.stringify({
      type: 'COMMAND',
      command
    }));
    return true;
  }

  async function handleDeviceMessage(deviceId, msg) {
    if (msg.type === 'PING') {
      const ws = deviceSockets.get(deviceId);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } else if (msg.type === 'COMMAND_STATUS') {
      const { commandId, status, result, errorMessage } = msg;
      if (!commandId || !COMMAND_STATUS_FROM_DEVICE.has(status)) {
        return; // malformed or unrecognized status
      }
      // Only the owning device may update its own commands; markCommandStatus
      // enforces the device_id match against the authenticated socket identity.
      const found = await markCommandStatus(deviceId, commandId, { status, result, errorMessage });
      if (!found) {
        console.warn(`[WS] Rejected COMMAND_STATUS for foreign/unknown command ${commandId} from ${deviceId}`);
        return;
      }

      broadcastDeviceEvent(deviceId, {
        type: 'COMMAND_STATUS_UPDATED',
        deviceId,
        commandId,
        status,
        result,
        errorMessage,
        timestamp: Date.now()
      });
    } else if (msg.type === 'ACCESSIBILITY_EVENT') {
      // Authenticated device socket only (enforced by handshake). Events are
      // scoped to the device owner's dashboards.
      broadcastDeviceEvent(deviceId, {
        type: 'ACCESSIBILITY_EVENT',
        deviceId,
        packageName: msg.packageName,
        className: msg.className,
        text: msg.text,
        timestamp: msg.timestamp || Date.now()
      });
    } else if (msg.type === 'DEVICE_ONLINE') {
      await updateDeviceStatus(deviceId, 'ONLINE');
      broadcastDeviceEvent(deviceId, {
        type: 'DEVICE_STATUS_CHANGED',
        deviceId,
        status: 'ONLINE',
        timestamp: Date.now()
      });
    }
    // Unknown message types are ignored.
  }

  return {
    deviceSockets,
    dashboardSockets,
    broadcastToDashboards,
    broadcastDeviceEvent,
    sendCommandToDevice
  };
}
