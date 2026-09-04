import { WebSocketServer } from 'ws';
import { db } from './db.js';

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
            ws.send(JSON.stringify({ type: 'PONG' }));
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
      await db.query('UPDATE devices SET status = $1, last_seen = $2 WHERE id = $3', [status, now, deviceId]);
    } else {
      const dev = db.getMemoryStore().devices.get(deviceId);
      if (dev) {
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
      const { commandId, status, result, errorMessage } = msg;
      const now = Date.now();

      if (db.isPostgres()) {
        await db.query(
          'UPDATE commands SET status = $1, result = $2, error_message = $3, completion_timestamp = $4 WHERE id = $5',
          [status, result || null, errorMessage || null, now, commandId]
        );
      } else {
        const cmd = db.getMemoryStore().commands.get(commandId);
        if (cmd) {
          cmd.status = status;
          if (result) cmd.result = result;
          if (errorMessage) cmd.error_message = errorMessage;
          cmd.completion_timestamp = now;
        }
      }

      broadcastToDashboards({
        type: 'COMMAND_STATUS_UPDATED',
        deviceId,
        commandId,
        status,
        result,
        errorMessage,
        timestamp: now
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
