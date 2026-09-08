/**
 * pages/camera.js — Remote camera capture page
 * Capture photo command, status tracking, recent captures gallery
 */
(function () {
  'use strict';

  let currentCommand = null;
  let captures = [];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Camera</h1>
          <p class="page-subtitle">Remote photo capture from device camera</p>
        </div>
        <div class="page-actions">
          <span class="connection-status" id="cameraPermStatus">
            <span class="status-dot offline" id="cameraPermDot"></span>
            <span class="status-text" id="cameraPermText">Checking permission…</span>
          </span>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="card">
          <div class="card-header"><div class="card-title">Capture Photo</div></div>
          <div class="card-body">
            <div class="camera-capture-area">
              <button class="camera-capture-btn" id="btnCapturePhoto" title="Capture photo">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
              </button>
              <div style="text-align: center;">
                <div style="font-size: 14px; font-weight: 600; margin-bottom: 4px;">Capture Photo</div>
                <div style="font-size: 12px; color: var(--text-muted);">Sends CAPTURE_PHOTO command to device</div>
              </div>
            </div>
            <div id="commandStatusArea" style="margin-top: 16px; display: none;">
              <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; text-align: center;">Command Status</div>
              <div class="command-status-tracker" id="commandStatusTracker"></div>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">Recent Captures</div>
            <span class="text-muted" style="font-size: 12px;" id="capturesCount"></span>
          </div>
          <div class="card-body">
            <div id="recentCaptures" class="gallery-grid" style="grid-template-columns: repeat(3, 1fr);">
              <div class="loading-container"><div class="loading-spinner"></div></div>
            </div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No device selected</div></div>';
      return;
    }

    document.getElementById('btnCapturePhoto').addEventListener('click', capturePhoto);

    // Check permission
    checkPermission();

    // Load recent captures
    await loadCaptures();

    // WebSocket events
    App.subscribeWS('COMMAND_COMPLETED', (data) => {
      if (currentCommand && (data.command_id === currentCommand.id || data.id === currentCommand.id)) {
        updateCommandStatus('COMPLETED');
        loadCaptures();
      }
    });
    App.subscribeWS('COMMAND_FAILED', (data) => {
      if (currentCommand && (data.command_id === currentCommand.id || data.id === currentCommand.id)) {
        updateCommandStatus('FAILED');
        if (data.error) UI.showToast('Capture failed: ' + data.error, 'error');
      }
    });
    App.subscribeWS('MEDIA_UPLOADED', (data) => {
      if (data.file_type === 'camera_capture' || data.type === 'camera_capture') {
        loadCaptures();
        UI.showToast('New camera capture received', 'success');
      }
    });
    App.subscribeWS('PERMISSION_STATUS_CHANGED', () => checkPermission());
  }

  async function checkPermission() {
    const deviceId = App.currentDeviceId;
    const dot = document.getElementById('cameraPermDot');
    const text = document.getElementById('cameraPermText');
    if (!dot || !text || !deviceId) return;
    try {
      const perms = await API.devices.getPermissions(deviceId);
      const permList = perms.permissions || perms.data || perms || [];
      const cameraPerm = Array.isArray(permList)
        ? permList.find(p => p.permission === 'CAMERA' || p.name === 'Camera')
        : permList.CAMERA;
      const status = cameraPerm?.status || cameraPerm || 'UNKNOWN';
      if (status === 'GRANTED') {
        dot.className = 'status-dot online pulse';
        text.textContent = 'Camera: Granted';
      } else if (status === 'DENIED') {
        dot.className = 'status-dot offline';
        text.textContent = 'Camera: Denied';
      } else {
        dot.className = 'status-dot connecting';
        text.textContent = 'Camera: ' + status;
      }
    } catch {
      dot.className = 'status-dot offline';
      text.textContent = 'Permission unknown';
    }
  }

  async function capturePhoto() {
    const deviceId = App.currentDeviceId;
    const btn = document.getElementById('btnCapturePhoto');
    if (!deviceId || !btn) return;
    btn.disabled = true;

    try {
      const cmd = await API.commands.create(deviceId, 'CAPTURE_PHOTO', { camera: 'rear' });
      currentCommand = cmd.command || cmd;
      showCommandStatus();
      updateCommandStatus('QUEUED');
      // Simulate progression based on typical flow
      setTimeout(() => updateCommandStatus('SENDING'), 500);
      setTimeout(() => updateCommandStatus('RECEIVED'), 1500);
      setTimeout(() => updateCommandStatus('EXECUTING'), 2500);
      UI.showToast('Capture command sent', 'info');
    } catch (err) {
      UI.showToast('Failed to send capture command: ' + err.message, 'error');
    } finally {
      setTimeout(() => { btn.disabled = false; }, 3000);
    }
  }

  function showCommandStatus() {
    const area = document.getElementById('commandStatusArea');
    if (area) area.style.display = 'block';
  }

  function updateCommandStatus(status) {
    const tracker = document.getElementById('commandStatusTracker');
    if (!tracker) return;
    const steps = ['QUEUED', 'SENDING', 'RECEIVED', 'EXECUTING', 'COMPLETED'];
    const currentIdx = steps.indexOf(status);
    const failed = status === 'FAILED';

    tracker.innerHTML = steps.map((step, i) => {
      let cls = '';
      if (failed && i <= currentIdx) cls = 'failed';
      else if (i < currentIdx || status === 'COMPLETED') cls = 'done';
      else if (i === currentIdx) cls = 'active';
      return `<div class="command-status-step ${cls}">${step}</div>${i < steps.length - 1 ? '<div class="command-status-connector"></div>' : ''}`;
    }).join('') + (failed ? '<div class="command-status-step failed">FAILED</div>' : '');
  }

  async function loadCaptures() {
    const deviceId = App.currentDeviceId;
    const container = document.getElementById('recentCaptures');
    const countEl = document.getElementById('capturesCount');
    if (!container || !deviceId) return;
    try {
      const res = await API.media.list({ device_id: deviceId, file_type: 'camera_capture', limit: 9 });
      captures = res.data || res || [];
      if (countEl) countEl.textContent = captures.length + ' items';

      if (captures.length === 0) {
        container.innerHTML = '';
        container.style.gridTemplateColumns = '1fr';
        container.appendChild(UI.emptyState('No captures yet', null, 'Captured photos will appear here.'));
        return;
      }
      container.style.gridTemplateColumns = 'repeat(3, 1fr)';
      container.innerHTML = '';
      captures.slice(0, 9).forEach(item => {
        const el = document.createElement('div');
        el.className = 'gallery-item';
        const url = item.thumbnail_url || item.url || (item.id ? '/api/media/' + item.id + '/download' : '');
        el.innerHTML = `
          ${url ? `<img class="gallery-thumbnail" src="${url}" loading="lazy" onerror="this.style.display='none';">` : ''}
          <div class="gallery-item-overlay">
            <div class="gallery-item-name">${UI.escapeHtml(item.filename || item.name || 'capture')}</div>
            <div class="gallery-item-meta">${UI.formatDateString(item.uploaded_at || item.created_at)}</div>
          </div>
        `;
        el.addEventListener('click', () => {
          const overlay = document.createElement('div');
          overlay.className = 'lightbox';
          overlay.innerHTML = `<button class="lightbox-close">&times;</button><div class="lightbox-content"><img src="${url}"><div class="lightbox-caption">${UI.escapeHtml(item.filename || '')}</div></div>`;
          overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.classList.contains('lightbox-close')) overlay.remove(); });
          document.body.appendChild(overlay);
        });
        container.appendChild(el);
      });
    } catch (err) {
      container.innerHTML = '';
      container.appendChild(UI.emptyState('Failed to load captures', null, err.message));
    }
  }

  const module = { init, refresh: loadCaptures };
  App.registerPage('camera', module);
})();
