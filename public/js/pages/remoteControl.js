/**
 * pages/remoteControl.js — Remote Screen Control Workspace
 *
 * Full remote-control workspace:
 * - Real-time screen rendering via canvas (JPEG frames over WebSocket)
 * - Touch/click interaction (tap, swipe, scroll, key events)
 * - Adaptive quality display and network quality monitoring
 * - Low-latency mode toggle
 * - Connection quality diagnostics with sparkline charts
 * - Reconnection handling
 *
 * Requires:
 * - Device must have MediaProjection consent (for screen capture)
 * - Device must have AccessibilityService enabled (for input injection)
 */
(function () {
  'use strict';

  // ============================================================
  // State
  // ============================================================
  const state = {
    sessionActive: false,
    sessionId: null,
    sessionStartTime: null,
    deviceResolution: { width: 0, height: 0 },
    canvasSize: { width: 0, height: 0 },
    targetFps: 30,
    targetQuality: 70,
    lowLatency: false,
    // Frame stats
    framesReceived: 0,
    renderFps: 0,
    lastFrameTime: 0,
    frameTimes: [],
    // Quality metrics
    latestQuality: null,
    latencyHistory: [],
    // Input tracking
    isDragging: false,
    dragStart: { x: 0, y: 0 },
    dragStartTime: 0,
    lastInputLatency: 0,
    // Reconnection
    wasConnected: false,
    reconnectAttempts: 0
  };

  // Image object for frame decoding
  let frameImage = null;
  let sessionTimer = null;

  // ============================================================
  // Init
  // ============================================================
  async function init(container) {
    const deviceId = App.currentDeviceId;

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Remote Control</h1>
          <p class="page-subtitle">Real-time screen viewing and touch interaction</p>
        </div>
        <div class="page-actions">
          <span class="connection-status" id="rcConnStatus">
            <span class="status-dot offline" id="rcConnDot"></span>
            <span class="status-text" id="rcConnText">Disconnected</span>
          </span>
        </div>
      </div>

      ${deviceId ? `
      <div class="remote-layout">
        <!-- Left: Screen + Controls -->
        <div class="remote-main">
          <!-- Control Bar -->
          <div class="rc-control-bar">
            <button class="btn btn-primary" id="rcStartBtn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              Start Session
            </button>
            <button class="btn btn-danger" id="rcStopBtn" style="display:none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12"></rect></svg>
              Stop Session
            </button>

            <div class="rc-divider"></div>

            <div class="rc-control-group">
              <label class="rc-control-label">FPS</label>
              <select class="rc-select" id="rcFpsSelect">
                <option value="15">15</option>
                <option value="30" selected>30</option>
                <option value="60">60</option>
              </select>
            </div>

            <div class="rc-control-group">
              <label class="rc-control-label">Quality</label>
              <select class="rc-select" id="rcQualitySelect">
                <option value="40">Low</option>
                <option value="70" selected>Medium</option>
                <option value="90">High</option>
              </select>
            </div>

            <div class="rc-control-group">
              <label class="rc-toggle-label">
                <input type="checkbox" id="rcLowLatencyToggle">
                <span class="rc-toggle-switch"></span>
                <span>Low Latency</span>
              </label>
            </div>
          </div>

          <!-- Screen Canvas Container -->
          <div class="rc-screen-container" id="rcScreenContainer">
            <canvas id="rcScreenCanvas"></canvas>
            <div class="rc-screen-overlay" id="rcScreenOverlay">
              <div class="rc-overlay-content">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-muted); margin-bottom: 12px;">
                  <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
                  <line x1="12" y1="18" x2="12.01" y2="18"></line>
                </svg>
                <div style="font-size: 15px; font-weight: 600; margin-bottom: 4px;">Screen Not Active</div>
                <div style="font-size: 13px; color: var(--text-muted);">Click "Start Session" to begin remote control</div>
              </div>
            </div>
            <!-- Reconnecting overlay -->
            <div class="rc-reconnect-overlay" id="rcReconnectOverlay" style="display:none;">
              <div class="rc-overlay-content">
                <div class="loading-spinner"></div>
                <div style="font-size: 15px; font-weight: 600; margin-top: 12px;">Reconnecting…</div>
                <div style="font-size: 13px; color: var(--text-muted);" id="rcReconnectAttempts">Attempt 1</div>
              </div>
            </div>
          </div>

          <!-- Accessibility notice -->
          <div class="rc-accessibility-notice" id="rcAccessNotice" style="display:none;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0; color: #f59e0b;">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <div>
              <strong>Enable remote control on device</strong>
              <p style="margin: 4px 0 0; font-size: 12px; color: var(--text-muted);">
                To use touch input, enable Accessibility Service on the device:
                Settings → Accessibility → Device Manager Remote Control → Enable.
                Screen viewing works without this, but taps and swipes will not be injected.
              </p>
            </div>
          </div>
        </div>

        <!-- Right: Stats + Quality Panel -->
        <div class="remote-sidebar">
          <!-- Session Stats -->
          <div class="card">
            <div class="card-header"><div class="card-title">Session Stats</div></div>
            <div class="card-body">
              <div class="rc-stats-grid">
                <div class="rc-stat">
                  <div class="rc-stat-label">Resolution</div>
                  <div class="rc-stat-value" id="rcStatResolution">—</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Capture FPS</div>
                  <div class="rc-stat-value" id="rcStatCaptureFps">—</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Render FPS</div>
                  <div class="rc-stat-value" id="rcStatRenderFps">—</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Input Latency</div>
                  <div class="rc-stat-value" id="rcStatInputLatency">—</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Duration</div>
                  <div class="rc-stat-value" id="rcStatDuration">00:00</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Bitrate</div>
                  <div class="rc-stat-value" id="rcStatBitrate">—</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Latency Display (low-latency mode) -->
          <div class="card" id="rcLatencyCard" style="display:none;">
            <div class="card-header"><div class="card-title">Realtime Latency</div></div>
            <div class="card-body">
              <div class="rc-latency-display">
                <div class="rc-latency-value" id="rcLatencyValue">—</div>
                <div class="rc-latency-unit">ms</div>
              </div>
              <div class="rc-latency-details">
                <div><span class="rc-stat-label">STREAM</span> <span id="rcLatencyStream">—</span></div>
                <div><span class="rc-stat-label">NETWORK</span> <span id="rcLatencyNetwork" class="rc-network-badge">—</span></div>
              </div>
            </div>
          </div>

          <!-- Adaptive State -->
          <div class="card">
            <div class="card-header"><div class="card-title">Adaptive Quality</div></div>
            <div class="card-body">
              <div class="rc-adaptive-grid">
                <div class="rc-stat">
                  <div class="rc-stat-label">Quality Level</div>
                  <div class="rc-stat-value" id="rcAdaptiveQuality">—</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Current FPS</div>
                  <div class="rc-stat-value" id="rcAdaptiveFps">—</div>
                </div>
                <div class="rc-stat">
                  <div class="rc-stat-label">Resolution</div>
                  <div class="rc-stat-value" id="rcAdaptiveResolution">—</div>
                </div>
              </div>
              <div class="rc-adaptive-reason" id="rcAdaptiveReason">No recent adjustments</div>
            </div>
          </div>

          <!-- Connection Quality -->
          <div class="card">
            <div class="card-header">
              <div class="card-title">Connection Quality</div>
              <span class="rc-network-badge" id="rcNetworkBadge">—</span>
            </div>
            <div class="card-body">
              <!-- Latency sparkline -->
              <div class="rc-sparkline-container">
                <div class="rc-sparkline-label">
                  <span>Ping / Latency</span>
                  <span id="rcLatencyText">— ms</span>
                </div>
                <canvas id="rcLatencySparkline" width="260" height="50"></canvas>
              </div>

              <div class="rc-quality-grid">
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Jitter</span>
                  <span id="rcJitter">— ms</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Packet Loss</span>
                  <span id="rcPacketLoss">— %</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Upload</span>
                  <span id="rcUploadSpeed">—</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Download</span>
                  <span id="rcDownloadSpeed">—</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Connection</span>
                  <span id="rcConnType">—</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">WS State</span>
                  <span id="rcWsState" class="rc-ws-state disconnected">—</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Reconnects</span>
                  <span id="rcReconnects">0</span>
                </div>
                <div class="rc-quality-item">
                  <span class="rc-stat-label">Battery Temp</span>
                  <span id="rcBatteryTemp">—</span>
                </div>
              </div>

              <!-- Auto-adapt indicator -->
              <div class="rc-autoadapt" id="rcAutoAdapt" style="display:none;">
                <span class="rc-autoadapt-dot"></span>
                <span id="rcAutoAdaptText">Adapting to network conditions…</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      ` : `
        <div id="healthContent"></div>
      `}
    `;

    if (!deviceId) {
      const content = document.getElementById('healthContent');
      if (content) {
        content.innerHTML = '';
        content.appendChild(UI.emptyState('No device selected', null, 'Select a device to use remote control.'));
      }
      return;
    }

    // Initialize elements
    initElements();
    initCanvas();
    bindControls();
    subscribeWebSocket();
    startSessionTimer();

    // Check current session status
    try {
      const status = await API.remote.status(deviceId);
      if (status && status.active) {
        state.sessionActive = true;
        state.sessionId = status.session?.id;
        state.sessionStartTime = new Date(status.session.started_at).getTime();
        updateSessionUI(true);
      }
    } catch (e) {
      // Ignore — no active session
    }
  }

  // ============================================================
  // Element initialization
  // ============================================================
  function initElements() {
    frameImage = new Image();
    frameImage.onload = renderFrame;
  }

  function initCanvas() {
    const canvas = document.getElementById('rcScreenCanvas');
    if (!canvas) return;
    const container = document.getElementById('rcScreenContainer');
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    state.canvasSize = { width: rect.width, height: rect.height };
  }

  // ============================================================
  // Controls
  // ============================================================
  function bindControls() {
    const startBtn = document.getElementById('rcStartBtn');
    const stopBtn = document.getElementById('rcStopBtn');
    const fpsSelect = document.getElementById('rcFpsSelect');
    const qualitySelect = document.getElementById('rcQualitySelect');
    const lowLatencyToggle = document.getElementById('rcLowLatencyToggle');
    const canvas = document.getElementById('rcScreenCanvas');

    if (startBtn) startBtn.addEventListener('click', startSession);
    if (stopBtn) stopBtn.addEventListener('click', stopSession);

    if (fpsSelect) {
      fpsSelect.addEventListener('change', () => {
        state.targetFps = parseInt(fpsSelect.value);
        sendStreamControl();
      });
    }

    if (qualitySelect) {
      qualitySelect.addEventListener('change', () => {
        state.targetQuality = parseInt(qualitySelect.value);
        sendStreamControl();
      });
    }

    if (lowLatencyToggle) {
      lowLatencyToggle.addEventListener('change', () => {
        state.lowLatency = lowLatencyToggle.checked;
        document.getElementById('rcLatencyCard').style.display = state.lowLatency ? '' : 'none';
        sendStreamControl();
      });
    }

    // Canvas input events
    if (canvas) {
      // Mouse events
      canvas.addEventListener('mousedown', onPointerDown);
      canvas.addEventListener('mousemove', onPointerMove);
      canvas.addEventListener('mouseup', onPointerUp);
      canvas.addEventListener('wheel', onWheel, { passive: false });
      canvas.addEventListener('contextmenu', (e) => e.preventDefault());

      // Touch events
      canvas.addEventListener('touchstart', onTouchStart, { passive: false });
      canvas.addEventListener('touchmove', onTouchMove, { passive: false });
      canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    }

    // Window resize
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    const canvas = document.getElementById('rcScreenCanvas');
    const container = document.getElementById('rcScreenContainer');
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    state.canvasSize = { width: rect.width, height: rect.height };
  }

  // ============================================================
  // Session management
  // ============================================================
  async function startSession() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;

    try {
      UI.showToast('Starting remote control session…', 'info');
      const result = await API.remote.start(deviceId, {
        target_fps: state.targetFps,
        target_quality: state.targetQuality,
        low_latency: state.lowLatency
      });

      if (result && result.session) {
        state.sessionActive = true;
        state.sessionId = result.session.id;
        state.sessionStartTime = Date.now();
        state.framesReceived = 0;
        state.latencyHistory = [];
        updateSessionUI(true);
        UI.showToast('Remote control session started', 'success');

        // Show accessibility notice (input may not work without it)
        document.getElementById('rcAccessNotice').style.display = '';
      }
    } catch (err) {
      UI.showToast(err.message || 'Failed to start session', 'error');
    }
  }

  async function stopSession() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;

    try {
      await API.remote.stop(deviceId);
      state.sessionActive = false;
      state.sessionId = null;
      updateSessionUI(false);
      UI.showToast('Remote control session stopped', 'info');
    } catch (err) {
      UI.showToast(err.message || 'Failed to stop session', 'error');
    }
  }

  function updateSessionUI(active) {
    const startBtn = document.getElementById('rcStartBtn');
    const stopBtn = document.getElementById('rcStopBtn');
    const overlay = document.getElementById('rcScreenOverlay');

    if (startBtn) startBtn.style.display = active ? 'none' : '';
    if (stopBtn) stopBtn.style.display = active ? '' : 'none';
    if (overlay) overlay.style.display = active ? 'none' : '';
  }

  function sendStreamControl() {
    if (!state.sessionActive) return;
    WebSocketManager.send({
      type: 'STREAM_CONTROL',
      device_id: App.currentDeviceId,
      action: 'update',
      target_fps: state.targetFps,
      target_quality: state.targetQuality,
      low_latency: state.lowLatency
    });
  }

  // ============================================================
  // WebSocket subscription
  // ============================================================
  function subscribeWebSocket() {
    // Screen frames
    App.subscribeWS('SCREEN_FRAME', (data) => {
      if (data.device_id != App.currentDeviceId) return;
      handleScreenFrame(data);
    });

    // Quality reports
    App.subscribeWS('QUALITY_REPORT', (data) => {
      if (data.device_id != App.currentDeviceId) return;
      handleQualityReport(data);
    });

    // Connection status
    WebSocketManager.onStatusChange((status) => {
      updateConnectionStatus(status);
    });
    updateConnectionStatus(WebSocketManager.getState());
  }

  function updateConnectionStatus(status) {
    const dot = document.getElementById('rcConnDot');
    const text = document.getElementById('rcConnText');
    const wsState = document.getElementById('rcWsState');
    const reconnectOverlay = document.getElementById('rcReconnectOverlay');

    if (!dot || !text) return;

    dot.className = 'status-dot ' + status;
    if (status === 'connected') {
      dot.classList.add('pulse');
      text.textContent = 'Connected';
      if (wsState) {
        wsState.textContent = 'Connected';
        wsState.className = 'rc-ws-state connected';
      }
      // If we were reconnecting, hide overlay
      if (state.wasConnected && state.sessionActive) {
        if (reconnectOverlay) reconnectOverlay.style.display = 'none';
        state.reconnectAttempts = 0;
      }
      state.wasConnected = true;
    } else if (status === 'connecting') {
      dot.classList.add('pulse');
      text.textContent = 'Connecting…';
      if (wsState) {
        wsState.textContent = 'Connecting';
        wsState.className = 'rc-ws-state connecting';
      }
    } else {
      text.textContent = 'Disconnected';
      if (wsState) {
        wsState.textContent = 'Disconnected';
        wsState.className = 'rc-ws-state disconnected';
      }
      // Show reconnecting overlay if session was active
      if (state.sessionActive && state.wasConnected) {
        state.reconnectAttempts++;
        if (reconnectOverlay) {
          reconnectOverlay.style.display = '';
          const attemptsEl = document.getElementById('rcReconnectAttempts');
          if (attemptsEl) attemptsEl.textContent = `Attempt ${state.reconnectAttempts}`;
        }
        document.getElementById('rcReconnects').textContent = state.reconnectAttempts;
      }
    }
  }

  // ============================================================
  // Frame handling
  // ============================================================
  function handleScreenFrame(data) {
    if (!data.frame_data) return;

    state.framesReceived++;
    state.deviceResolution = {
      width: data.width || state.deviceResolution.width,
      height: data.height || state.deviceResolution.height
    };

    // Calculate render FPS
    const now = performance.now();
    if (state.lastFrameTime > 0) {
      const delta = now - state.lastFrameTime;
      state.frameTimes.push(delta);
      if (state.frameTimes.length > 30) state.frameTimes.shift();
      const avgDelta = state.frameTimes.reduce((a, b) => a + b, 0) / state.frameTimes.length;
      state.renderFps = avgDelta > 0 ? Math.round(1000 / avgDelta) : 0;
    }
    state.lastFrameTime = now;

    // Load frame into image
    try {
      frameImage.src = 'data:image/jpeg;base64,' + data.frame_data;
    } catch (e) {
      // Ignore decode errors
    }

    // Update capture FPS from device
    if (data.fps) {
      document.getElementById('rcStatCaptureFps').textContent = data.fps + ' FPS';
    }
  }

  function renderFrame() {
    const canvas = document.getElementById('rcScreenCanvas');
    if (!canvas || !frameImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate aspect-preserving fit
    const imgRatio = frameImage.width / frameImage.height;
    const canvasRatio = canvas.width / canvas.height;
    let drawW, drawH, drawX, drawY;

    if (imgRatio > canvasRatio) {
      drawW = canvas.width;
      drawH = canvas.width / imgRatio;
      drawX = 0;
      drawY = (canvas.height - drawH) / 2;
    } else {
      drawH = canvas.height;
      drawW = canvas.height * imgRatio;
      drawX = (canvas.width - drawW) / 2;
      drawY = 0;
    }

    ctx.drawImage(frameImage, drawX, drawY, drawW, drawH);

    // Update render FPS display
    document.getElementById('rcStatRenderFps').textContent = state.renderFps + ' FPS';
  }

  // ============================================================
  // Quality report handling
  // ============================================================
  function handleQualityReport(data) {
    state.latestQuality = data;

    // Latency
    const latency = data.latency_ms != null ? data.latency_ms : 0;
    document.getElementById('rcLatencyText').textContent = latency + ' ms';

    // Latency color coding
    const latencyEl = document.getElementById('rcLatencyText');
    if (latencyEl) {
      latencyEl.style.color = latency < 50 ? '#10b981' : latency < 150 ? '#f59e0b' : '#ef4444';
    }

    // Low-latency big display
    const latencyValue = document.getElementById('rcLatencyValue');
    if (latencyValue) {
      latencyValue.textContent = latency;
      latencyValue.style.color = latency < 50 ? '#10b981' : latency < 150 ? '#f59e0b' : '#ef4444';
    }

    // Update latency history for sparkline
    state.latencyHistory.push(latency);
    if (state.latencyHistory.length > 30) state.latencyHistory.shift();
    drawLatencySparkline();

    // Jitter
    document.getElementById('rcJitter').textContent = (data.jitter_ms != null ? data.jitter_ms : '—') + ' ms';

    // Packet loss
    const loss = data.packet_loss_pct != null ? data.packet_loss_pct : 0;
    const lossEl = document.getElementById('rcPacketLoss');
    lossEl.textContent = loss.toFixed(1) + ' %';
    lossEl.style.color = loss > 5 ? '#ef4444' : loss > 2 ? '#f59e0b' : '';

    // Speeds
    document.getElementById('rcUploadSpeed').textContent = formatSpeed(data.upload_speed_kbps);
    document.getElementById('rcDownloadSpeed').textContent = formatSpeed(data.download_speed_kbps);

    // Connection type
    document.getElementById('rcConnType').textContent = data.network_type || '—';

    // WS state
    if (data.ws_state) {
      const wsState = document.getElementById('rcWsState');
      wsState.textContent = data.ws_state;
      wsState.className = 'rc-ws-state ' + data.ws_state.toLowerCase();
    }

    // Reconnects
    if (data.reconnection_attempts != null) {
      document.getElementById('rcReconnects').textContent = data.reconnection_attempts;
    }

    // Battery temp
    if (data.battery_temp != null) {
      document.getElementById('rcBatteryTemp').textContent = data.battery_temp.toFixed(1) + '°C';
    }

    // Resolution
    document.getElementById('rcStatResolution').textContent =
      state.deviceResolution.width > 0
        ? state.deviceResolution.width + ' × ' + state.deviceResolution.height
        : '—';

    // Bitrate
    document.getElementById('rcStatBitrate').textContent =
      data.bitrate_kbps != null ? formatBitrate(data.bitrate_kbps) : '—';

    // Input latency
    if (data.input_latency_ms != null) {
      document.getElementById('rcStatInputLatency').textContent = data.input_latency_ms + ' ms';
    }

    // Adaptive quality
    document.getElementById('rcAdaptiveQuality').textContent = data.quality != null ? data.quality : '—';
    document.getElementById('rcAdaptiveFps').textContent = data.fps != null ? data.fps + ' FPS' : '—';
    document.getElementById('rcAdaptiveResolution').textContent = data.resolution || '—';

    // Adaptive reason
    const reasonEl = document.getElementById('rcAdaptiveReason');
    if (data.adjustment_reason && data.adjustment_reason !== 'Initialized') {
      reasonEl.textContent = data.adjustment_reason;
      reasonEl.classList.add('active');
      // Show auto-adapt indicator
      const autoAdapt = document.getElementById('rcAutoAdapt');
      if (autoAdapt) {
        autoAdapt.style.display = '';
        document.getElementById('rcAutoAdaptText').textContent = data.adjustment_reason;
      }
    } else {
      reasonEl.textContent = 'No recent adjustments';
      reasonEl.classList.remove('active');
      document.getElementById('rcAutoAdapt').style.display = 'none';
    }

    // Network quality badge
    const quality = getNetworkQuality(latency, data.jitter_ms || 0, loss);
    const badge = document.getElementById('rcNetworkBadge');
    badge.textContent = quality;
    badge.className = 'rc-network-badge ' + quality.toLowerCase();

    const streamInfo = document.getElementById('rcLatencyStream');
    if (streamInfo) {
      streamInfo.textContent = state.deviceResolution.width > 0
        ? state.deviceResolution.width + 'p / ' + (data.fps || '—') + ' FPS'
        : '—';
    }
    document.getElementById('rcLatencyNetwork').textContent = quality;
    document.getElementById('rcLatencyNetwork').className = 'rc-network-badge ' + quality.toLowerCase();
  }

  // ============================================================
  // Sparkline
  // ============================================================
  function drawLatencySparkline() {
    const canvas = document.getElementById('rcLatencySparkline');
    if (!canvas || state.latencyHistory.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const data = state.latencyHistory;
    const max = Math.max(...data, 100);
    const min = Math.min(...data, 0);
    const range = max - min || 1;

    ctx.clearRect(0, 0, w, h);

    // Draw line
    ctx.beginPath();
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 1.5;
    data.forEach((val, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((val - min) / range) * (h - 4) - 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.fill();
  }

  // ============================================================
  // Input handling
  // ============================================================
  function canvasToDeviceCoords(clientX, clientY) {
    const canvas = document.getElementById('rcScreenCanvas');
    if (!canvas || state.deviceResolution.width === 0) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    // Calculate the drawn image area (aspect-preserving fit)
    const imgRatio = state.deviceResolution.width / state.deviceResolution.height;
    const canvasRatio = rect.width / rect.height;
    let drawW, drawH, drawX, drawY;

    if (imgRatio > canvasRatio) {
      drawW = rect.width;
      drawH = rect.width / imgRatio;
      drawX = 0;
      drawY = (rect.height - drawH) / 2;
    } else {
      drawH = rect.height;
      drawW = rect.height * imgRatio;
      drawX = (rect.width - drawW) / 2;
      drawY = 0;
    }

    // Scale to device resolution
    const deviceX = ((x - drawX) / drawW) * state.deviceResolution.width;
    const deviceY = ((y - drawY) / drawH) * state.deviceResolution.height;

    return {
      x: Math.round(Math.max(0, Math.min(deviceX, state.deviceResolution.width))),
      y: Math.round(Math.max(0, Math.min(deviceY, state.deviceResolution.height)))
    };
  }

  function onPointerDown(e) {
    if (!state.sessionActive) return;
    state.isDragging = true;
    state.dragStart = canvasToDeviceCoords(e.clientX, e.clientY);
    state.dragStartTime = Date.now();
  }

  function onPointerMove(e) {
    if (!state.isDragging || !state.sessionActive) return;
  }

  function onPointerUp(e) {
    if (!state.isDragging || !state.sessionActive) return;
    state.isDragging = false;

    const end = canvasToDeviceCoords(e.clientX, e.clientY);
    const duration = Date.now() - state.dragStartTime;
    const dx = Math.abs(end.x - state.dragStart.x);
    const dy = Math.abs(end.y - state.dragStart.y);

    if (dx < 10 && dy < 10 && duration < 500) {
      // Tap
      sendInputEvent({ action: 'tap', x: state.dragStart.x, y: state.dragStart.y });
    } else {
      // Swipe
      sendInputEvent({
        action: 'swipe',
        x: state.dragStart.x,
        y: state.dragStart.y,
        x2: end.x,
        y2: end.y,
        duration: Math.max(100, duration)
      });
    }
  }

  function onWheel(e) {
    if (!state.sessionActive) return;
    e.preventDefault();
    const coords = canvasToDeviceCoords(e.clientX, e.clientY);
    sendInputEvent({
      action: 'scroll',
      x: coords.x,
      y: coords.y,
      duration: e.deltaY
    });
  }

  function onTouchStart(e) {
    if (!state.sessionActive) return;
    e.preventDefault();
    const touch = e.touches[0];
    state.isDragging = true;
    state.dragStart = canvasToDeviceCoords(touch.clientX, touch.clientY);
    state.dragStartTime = Date.now();
  }

  function onTouchMove(e) {
    if (!state.sessionActive) return;
    e.preventDefault();
  }

  function onTouchEnd(e) {
    if (!state.isDragging || !state.sessionActive) return;
    e.preventDefault();
    state.isDragging = false;

    const touch = e.changedTouches[0];
    const end = canvasToDeviceCoords(touch.clientX, touch.clientY);
    const duration = Date.now() - state.dragStartTime;
    const dx = Math.abs(end.x - state.dragStart.x);
    const dy = Math.abs(end.y - state.dragStart.y);

    if (dx < 10 && dy < 10 && duration < 500) {
      sendInputEvent({ action: 'tap', x: state.dragStart.x, y: state.dragStart.y });
    } else {
      sendInputEvent({
        action: 'swipe',
        x: state.dragStart.x,
        y: state.dragStart.y,
        x2: end.x,
        y2: end.y,
        duration: Math.max(100, duration)
      });
    }
  }

  function sendInputEvent(event) {
    WebSocketManager.send({
      type: 'INPUT_EVENT',
      device_id: App.currentDeviceId,
      ...event
    });
  }

  // ============================================================
  // Session timer
  // ============================================================
  function startSessionTimer() {
    if (sessionTimer) clearInterval(sessionTimer);
    sessionTimer = setInterval(() => {
      if (state.sessionActive && state.sessionStartTime) {
        const elapsed = Math.floor((Date.now() - state.sessionStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const el = document.getElementById('rcStatDuration');
        if (el) el.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      }
    }, 1000);
  }

  // ============================================================
  // Helpers
  // ============================================================
  function formatSpeed(kbps) {
    if (kbps == null) return '—';
    if (kbps >= 1000) return (kbps / 1000).toFixed(1) + ' MB/s';
    return kbps + ' KB/s';
  }

  function formatBitrate(kbps) {
    if (kbps == null) return '—';
    if (kbps >= 1000) return (kbps / 1000).toFixed(1) + ' Mbps';
    return kbps + ' Kbps';
  }

  function getNetworkQuality(latency, jitter, loss) {
    if (latency < 50 && jitter < 20 && loss < 1) return 'EXCELLENT';
    if (latency < 200 && jitter < 50 && loss < 3) return 'GOOD';
    if (latency < 500 && loss < 5) return 'FAIR';
    return 'POOR';
  }

  // ============================================================
  // Cleanup
  // ============================================================
  function cleanup() {
    if (sessionTimer) {
      clearInterval(sessionTimer);
      sessionTimer = null;
    }
    window.removeEventListener('resize', onResize);
  }

  // ============================================================
  // Module registration
  // ============================================================
  const module = {
    init,
    cleanup,
    refresh: () => {}
  };
  App.registerPage('remoteControl', module);
})();
