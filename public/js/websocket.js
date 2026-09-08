/**
 * websocket.js — WebSocket connection management + event handling
 * Android MDM Dashboard
 * Connects to ws://<host>/ws?token=<jwt>
 * Auto-reconnect with exponential backoff
 * Event bus pattern: pages subscribe to events
 */
const WebSocketManager = (function () {
  'use strict';

  const DEBUG = false;
  const RECONNECT_BASE_DELAY = 1000;  // 1s
  const RECONNECT_MAX_DELAY = 30000;   // 30s

  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let shouldReconnect = true;
  const listeners = {}; // eventType -> [callback]
  const statusListeners = [];

  function log(...args) {
    if (DEBUG) console.log('[WS]', ...args);
  }

  /**
   * Build WebSocket URL based on current location
   */
  function buildUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = Auth.getToken();
    return `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;
  }

  /**
   * Connect to WebSocket
   */
  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    shouldReconnect = true;
    const url = buildUrl();
    log('Connecting to', url);
    updateStatus('connecting');

    try {
      ws = new WebSocket(url);
    } catch (err) {
      log('WebSocket constructor error:', err);
      scheduleReconnect();
      return;
    }

    ws.onopen = function () {
      log('Connected');
      reconnectAttempts = 0;
      updateStatus('connected');
      // Refresh current page data on reconnect
      if (typeof App !== 'undefined' && App.navigate) {
        setTimeout(() => App.navigate(), 500);
      }
    };

    ws.onmessage = function (event) {
      try {
        const data = JSON.parse(event.data);
        log('Received event:', data.type || data.event);
        handleMessage(data);
      } catch (err) {
        log('Failed to parse message:', err, event.data);
      }
    };

    ws.onerror = function (err) {
      log('WebSocket error:', err);
    };

    ws.onclose = function (event) {
      log('Disconnected. Code:', event.code, 'Reason:', event.reason);
      updateStatus('disconnected');
      ws = null;
      if (shouldReconnect) {
        scheduleReconnect();
      }
    };
  }

  /**
   * Schedule reconnect with exponential backoff
   */
  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );
    log(`Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    updateStatus('reconnecting');
    reconnectTimer = setTimeout(() => {
      if (shouldReconnect) connect();
    }, delay);
  }

  /**
   * Disconnect WebSocket (no reconnect)
   */
  function disconnect() {
    shouldReconnect = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (ws) {
      ws.close();
      ws = null;
    }
    updateStatus('disconnected');
  }

  /**
   * Get current connection state
   */
  function getState() {
    if (!ws) return 'disconnected';
    switch (ws.readyState) {
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CONNECTING: return 'connecting';
      default: return 'disconnected';
    }
  }

  /**
   * Update connection status and notify listeners
   */
  function updateStatus(status) {
    statusListeners.forEach(cb => {
      try { cb(status); } catch (e) { log('Status listener error:', e); }
    });
  }

  /**
   * Subscribe to connection status changes
   */
  function onStatusChange(callback) {
    statusListeners.push(callback);
  }

  /**
   * Handle incoming WebSocket message
   */
  function handleMessage(data) {
    const eventType = data.type || data.event;
    if (!eventType) return;

    // Emit to specific event listeners
    emit(eventType, data);

    // Also emit wildcard
    emit('*', data);

    // Default toast notifications for key events
    if (typeof UI !== 'undefined' && UI.showToast) {
      switch (eventType) {
        case 'DEVICE_ONLINE':
          UI.showToast(`Device ${data.device_id || ''} is now online`, 'success');
          break;
        case 'DEVICE_OFFLINE':
          UI.showToast(`Device ${data.device_id || ''} went offline`, 'warning');
          break;
        case 'NOTIFICATION_RECEIVED':
          UI.showToast('New notification received', 'info');
          break;
        case 'MEDIA_UPLOADED':
          UI.showToast('New media uploaded', 'success');
          break;
        case 'COMMAND_COMPLETED':
          UI.showToast(`Command ${data.command_id || ''} completed`, 'success');
          break;
        case 'COMMAND_FAILED':
          UI.showToast(`Command ${data.command_id || ''} failed`, 'error');
          break;
        case 'CONTACTS_SYNCED':
          UI.showToast('Contacts synced', 'success');
          break;
        case 'CALLS_SYNCED':
          UI.showToast('Call log synced', 'success');
          break;
        case 'SMS_SYNCED':
          UI.showToast('SMS synced', 'success');
          break;
        case 'FILES_SYNCED':
          UI.showToast('Files synced', 'success');
          break;
        case 'SCREEN_RECORDING_STARTED':
          UI.showToast('Screen recording started', 'info');
          break;
        case 'SCREEN_RECORDING_COMPLETED':
          UI.showToast('Screen recording completed', 'success');
          break;
        case 'GEOFENCE_EVENT':
          UI.showToast(`Geofence ${data.action || ''}: ${data.geofence_name || ''}`, 'info');
          break;
        case 'DEVICE_RECONNECTED':
          UI.showToast(`Device reconnected after ${data.data?.downtime_seconds || 0}s`, 'success');
          break;
        case 'SNAPSHOT_CREATED':
          UI.showToast('Device snapshot created', 'success');
          break;
        case 'TRANSFER_COMPLETED':
          UI.showToast(`Transfer completed: ${data.data?.filename || ''}`, 'success');
          break;
        case 'TRANSFER_FAILED':
          UI.showToast(`Transfer failed: ${data.data?.filename || ''}`, 'error');
          break;
      }
    }
  }

  /**
   * Subscribe to an event type
   * @param {string} event - Event type or '*' for all
   * @param {function} callback - Callback(data)
   * @returns {function} Unsubscribe function
   */
  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
    return function () {
      const idx = listeners[event].indexOf(callback);
      if (idx > -1) listeners[event].splice(idx, 1);
    };
  }

  /**
   * Emit event to all subscribers
   */
  function emit(event, data) {
    const cbs = listeners[event] || [];
    cbs.forEach(cb => {
      try { cb(data); } catch (e) { log('Listener error for', event, ':', e); }
    });
  }

  /**
   * Remove all listeners for a specific event (or all if no event given)
   */
  function off(event) {
    if (event) {
      delete listeners[event];
    } else {
      Object.keys(listeners).forEach(k => delete listeners[k]);
    }
  }

  /**
   * Send a message through WebSocket
   */
  function send(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  function getReconnectAttempts() {
    return reconnectAttempts;
  }

  return {
    connect,
    disconnect,
    getState,
    onStatusChange,
    on,
    off,
    emit,
    send,
    getReconnectAttempts
  };
})();
