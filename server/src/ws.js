import { WebSocketServer } from 'ws';
import { db } from './db.js';
import { normalizeCommandStatus, canAdvanceCommandStatus, isTerminalCommandStatus } from './sync-utils.js';

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  const deviceSockets = new Map(); // deviceId -> WebSocket
  const dashboardSockets = new Set(); // Set<WebSocket>

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/ws/device' || pathname === '/ws/dashboard') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const pathname = url.pathname;

    if (pathname === '/ws/device') {
      const deviceId = url.searchParams.get('deviceId');
      if (!deviceId) {
        ws.close(4001, 'Missing deviceId parameter');
        return;
      }

      deviceSockets.set(deviceId, ws);
      console.log(`[WS] Android device connected: ${deviceId}`);

      // Update status to ONLINE
      updateDeviceStatus(deviceId, 'ONLINE');
      broadcastToDashboards({
        type: 'DEVICE_STATUS_CHANGED',
        deviceId,
        status: 'ONLINE',
        timestamp: Date.now()
      });

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          handleDeviceMessage(deviceId, msg);
        } catch (e) {
          console.error('[WS] Error processing device message:', e);
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Android device disconnected: ${deviceId}`);
        deviceSockets.delete(deviceId);
        updateDeviceStatus(deviceId, 'OFFLINE');
        broadcastToDashboards({
          type: 'DEVICE_STATUS_CHANGED',
          deviceId,
          status: 'OFFLINE',
          timestamp: Date.now()
        });
      });

      ws.on('error', (err) => {
        console.warn(`[WS] Device socket error (${deviceId}):`, err.message);
      });

    } else if (pathname === '/ws/dashboard') {
      dashboardSockets.add(ws);
      console.log('[WS] Web Admin Dashboard client connected');

      ws.on('message', async (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'PING') {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'PONG' }));
            }
          }
        } catch (_) {}
      });

      ws.on('close', () => {
        dashboardSockets.delete(ws);
        console.log('[WS] Web Admin Dashboard client disconnected');
      });
    }
  });

  function broadcastToDashboards(payload) {
    const data = JSON.stringify(payload);
    for (const ws of dashboardSockets) {
      if (ws.readyState === ws.OPEN) {
        ws.send(data);
      }
    }
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

  async function updateDeviceStatus(deviceId, status) {
    const now = new Date();
    if (db.isPostgres()) {
      await db.query(
        `INSERT INTO devices (id, device_name, manufacturer, model, status, last_seen)
         VALUES ($1, 'Android Device', 'Android', 'Device', $2, $3)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, last_seen = EXCLUDED.last_seen`,
        [deviceId, status, now]
      );
    } else {
      let dev = db.getMemoryStore().devices.get(deviceId);
      if (!dev) {
        dev = { id: deviceId, device_name: 'Android Device', status, last_seen: now };
        db.getMemoryStore().devices.set(deviceId, dev);
      } else {
        dev.status = status;
        dev.last_seen = now;
      }
    }
  }

  async function handleDeviceMessage(deviceId, msg) {
    if (msg.type === 'PING') {
      const ws = deviceSockets.get(deviceId);
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'PONG' }));
      }
    } else if (msg.type === 'COMMAND_STATUS') {
      const { commandId, status: rawStatus, result, errorMessage } = msg;
      const status = normalizeCommandStatus(rawStatus);
      if (!status || !commandId) return;
      const now = Date.now();
      let command = null;

      if (db.isPostgres()) {
        const found = await db.query(
          'SELECT id, device_id, status FROM commands WHERE id = $1 AND device_id = $2 LIMIT 1',
          [commandId, deviceId]
        );
        command = found.rows[0];
        if (!command || !canAdvanceCommandStatus(command.status, status)) return;
        await db.query(
          'UPDATE commands SET status = $1, result = $2, error_message = $3, completion_timestamp = $4 WHERE id = $5 AND device_id = $6',
          [status, result ?? null, errorMessage ?? null, isTerminalCommandStatus(status) ? now : null, commandId, deviceId]
        );
      } else {
        const store = db.getMemoryStore();
        command = store.commands.get(commandId);
        if (!command || (command.deviceId !== deviceId && command.device_id !== deviceId) || !canAdvanceCommandStatus(command.status, status)) return;
        command.status = status;
        if (result !== undefined) command.result = result;
        if (errorMessage !== undefined) command.error_message = errorMessage;
        command.completion_timestamp = isTerminalCommandStatus(status) ? now : null;
      }

      broadcastToDashboards({
        type: 'COMMAND_STATUS_UPDATED',
        deviceId,
        commandId,
        status,
        result: result ?? null,
        errorMessage: errorMessage ?? null,
        timestamp: now
      });
    } else if (msg.type === 'ACCESSIBILITY_EVENT') {
      broadcastToDashboards({
        type: 'ACCESSIBILITY_EVENT',
        deviceId,
        packageName: msg.packageName,
        className: msg.className,
        text: msg.text,
        timestamp: msg.timestamp || Date.now()
      });
    }
  }

  return {
    deviceSockets,
    dashboardSockets,
    broadcastToDashboards,
    sendCommandToDevice
  };
}
