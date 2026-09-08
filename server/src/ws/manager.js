/**
 * WebSocket Connection Manager
 * Tracks dashboard and device WebSocket connections.
 * Provides broadcast utilities for real-time events.
 *
 * Extended for remote control: relays SCREEN_FRAME, QUALITY_REPORT
 * from device→dashboard, and INPUT_EVENT, STREAM_CONTROL from dashboard→device.
 */

class WSManager {
  constructor() {
    this.dashboardClients = new Set();
    this.deviceClients = new Map(); // device_id -> Set of ws
    this.lowLatencyDevices = new Set(); // device_ids in low-latency mode

    // Server-side WS metrics per client
    this.clientMetrics = new Map(); // ws -> {messages_in, bytes_in, messages_out, bytes_out, connected_at}
  }

  addDashboard(ws) {
    this.dashboardClients.add(ws);
    this.initMetrics(ws);
  }

  removeDashboard(ws) {
    this.dashboardClients.delete(ws);
    this.clientMetrics.delete(ws);
  }

  addDevice(deviceId, ws) {
    if (!this.deviceClients.has(deviceId)) {
      this.deviceClients.set(deviceId, new Set());
    }
    this.deviceClients.get(deviceId).add(ws);
    this.initMetrics(ws);
  }

  removeDevice(deviceId, ws) {
    const set = this.deviceClients.get(deviceId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        this.deviceClients.delete(deviceId);
      }
    }
    this.clientMetrics.delete(ws);
  }

  isDeviceOnline(deviceId) {
    return this.deviceClients.has(deviceId) && this.deviceClients.get(deviceId).size > 0;
  }

  // ── Low-latency mode tracking ──

  setLowLatencyMode(deviceId, enabled) {
    if (enabled) {
      this.lowLatencyDevices.add(String(deviceId));
    } else {
      this.lowLatencyDevices.delete(String(deviceId));
    }
  }

  isLowLatency(deviceId) {
    return this.lowLatencyDevices.has(String(deviceId));
  }

  // ── Metrics tracking ──

  initMetrics(ws) {
    this.clientMetrics.set(ws, {
      messages_in: 0,
      bytes_in: 0,
      messages_out: 0,
      bytes_out: 0,
      connected_at: Date.now()
    });
  }

  recordIncoming(ws, bytes) {
    const m = this.clientMetrics.get(ws);
    if (m) {
      m.messages_in++;
      m.bytes_in += bytes;
    }
  }

  recordOutgoing(ws, bytes) {
    const m = this.clientMetrics.get(ws);
    if (m) {
      m.messages_out++;
      m.bytes_out += bytes;
    }
  }

  getMetrics(ws) {
    return this.clientMetrics.get(ws) || null;
  }

  /**
   * Broadcast an event message to all connected dashboard clients.
   */
  broadcastToDashboards(message) {
    const data = JSON.stringify(message);
    const byteLen = Buffer.byteLength(data);
    for (const ws of this.dashboardClients) {
      if (ws.readyState === 1) {
        ws.send(data);
        this.recordOutgoing(ws, byteLen);
      }
    }
  }

  /**
   * Send a command message to a specific device.
   * In low-latency mode, messages are sent immediately (no queueing).
   */
  sendToDevice(deviceId, message) {
    const set = this.deviceClients.get(deviceId);
    if (!set) return false;
    const data = JSON.stringify(message);
    const byteLen = Buffer.byteLength(data);
    let sent = false;
    for (const ws of set) {
      if (ws.readyState === 1) {
        ws.send(data);
        this.recordOutgoing(ws, byteLen);
        sent = true;
      }
    }
    return sent;
  }

  /**
   * Relay a screen frame from device to all dashboards.
   * SCREEN_FRAME messages are high-frequency; in low-latency mode
   * they are prioritized and sent immediately.
   */
  relayScreenFrame(deviceId, frameData) {
    const message = {
      type: 'SCREEN_FRAME',
      device_id: deviceId,
      ...frameData
    };
    const data = JSON.stringify(message);
    const byteLen = Buffer.byteLength(data);
    for (const ws of this.dashboardClients) {
      if (ws.readyState === 1) {
        ws.send(data);
        this.recordOutgoing(ws, byteLen);
      }
    }
  }

  /**
   * Relay a quality report from device to all dashboards.
   */
  relayQualityReport(deviceId, reportData) {
    const message = {
      type: 'QUALITY_REPORT',
      device_id: deviceId,
      ...reportData
    };
    this.broadcastToDashboards(message);
  }

  /**
   * Relay an input event from dashboard to a specific device.
   * In low-latency mode, INPUT_EVENT is processed immediately.
   */
  relayInputEvent(deviceId, inputData) {
    return this.sendToDevice(deviceId, {
      type: 'INPUT_EVENT',
      device_id: deviceId,
      ...inputData
    });
  }

  /**
   * Relay stream control from dashboard to a specific device.
   */
  relayStreamControl(deviceId, controlData) {
    // Track low-latency mode
    if (controlData.low_latency !== undefined) {
      this.setLowLatencyMode(deviceId, controlData.low_latency);
    }
    return this.sendToDevice(deviceId, {
      type: 'STREAM_CONTROL',
      device_id: deviceId,
      ...controlData
    });
  }

  /**
   * Helper to build a standard dashboard event message.
   */
  buildEvent(type, deviceId, data) {
    return {
      type,
      device_id: deviceId,
      data: data || {},
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new WSManager();
