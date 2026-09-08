/**
 * pages/transfers.js — File Transfer Manager
 * Upload/download queues, progress, speed, ETA, history
 */
(function () {
  'use strict';

  let activeTransfers = {};
  let transferHistory = [];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">File Transfers</h1>
          <p class="page-subtitle">Chunked upload/download manager with resume and verification</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="btnUploadFile">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Upload File
          </button>
          <input type="file" id="filePicker" style="display:none;">
          <button class="btn btn-secondary btn-sm" id="btnSendDeviceUpload">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
            Device → Server
          </button>
        </div>
      </div>
      <div id="transfersContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading transfers…</span></div>
      </div>
    `;

    document.getElementById('btnUploadFile').addEventListener('click', () => {
      document.getElementById('filePicker').click();
    });

    document.getElementById('filePicker').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleBrowserUpload(file);
    });

    document.getElementById('btnSendDeviceUpload').addEventListener('click', () => {
      const filePath = prompt('Enter file path on device (e.g., /sdcard/Download/file.pdf):');
      if (filePath) {
        API.commands.create(deviceId, 'UPLOAD_FILE_CHUNKED', { file_path: filePath, priority: 1 })
          .then(() => UI.showToast('Chunked upload command sent to device', 'success'))
          .catch(err => UI.showToast('Failed: ' + err.message, 'error'));
      }
    });

    if (!deviceId) {
      document.getElementById('transfersContent').innerHTML = '';
      document.getElementById('transfersContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view transfers.')
      );
      return;
    }

    await loadTransfers();

    App.subscribeWS('TRANSFER_PROGRESS', (data) => {
      const d = data.data || data;
      if (d.transfer_id) {
        activeTransfers[d.transfer_id] = { ...activeTransfers[d.transfer_id], ...d, status: d.status || 'UPLOADING' };
        renderTransfers();
      }
    });

    App.subscribeWS('TRANSFER_COMPLETED', (data) => {
      const d = data.data || data;
      if (d.transfer_id) {
        delete activeTransfers[d.transfer_id];
        UI.showToast(`Transfer completed: ${d.filename || ''}`, 'success');
        loadTransfers();
      }
    });

    App.subscribeWS('TRANSFER_FAILED', (data) => {
      const d = data.data || data;
      if (d.transfer_id) {
        activeTransfers[d.transfer_id] = { ...activeTransfers[d.transfer_id], ...d, status: 'FAILED' };
        UI.showToast(`Transfer failed: ${d.filename || ''}`, 'error');
        renderTransfers();
      }
    });
  }

  async function loadTransfers() {
    const deviceId = App.currentDeviceId;
    try {
      const data = await API.transfers.list({ device_id: deviceId, limit: 50 });
      const transfers = Array.isArray(data) ? data : (data.transfers || []);
      transferHistory = transfers.filter(t => t.status === 'COMPLETED' || t.status === 'FAILED');
      const active = transfers.filter(t => t.status === 'PENDING' || t.status === 'UPLOADING' || t.status === 'COMPLETING');
      active.forEach(t => { activeTransfers[t.transfer_id] = t; });
      renderTransfers();
    } catch (err) {
      document.getElementById('transfersContent').innerHTML = '';
      document.getElementById('transfersContent').appendChild(
        UI.emptyState('Failed to load', null, err.message)
      );
    }
  }

  function renderTransfers() {
    const content = document.getElementById('transfersContent');
    if (!content) return;

    const activeList = Object.values(activeTransfers);
    const hasActive = activeList.length > 0;
    const hasHistory = transferHistory.length > 0;

    content.innerHTML = `
      ${hasActive ? `
      <div class="section-card">
        <div class="section-header">
          <h3 class="section-title">Active Transfers</h3>
          <span class="badge badge-info">${activeList.length}</span>
        </div>
        <div class="transfer-table-wrap">
          <table class="data-table transfer-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Size</th>
                <th>Progress</th>
                <th>Speed</th>
                <th>ETA</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${activeList.map(t => transferRow(t)).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : `
      <div class="empty-state-inline">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
        <p>No active transfers</p>
      </div>
      `}

      ${hasHistory ? `
      <div class="section-card" style="margin-top:16px;">
        <div class="section-header">
          <h3 class="section-title">Transfer History</h3>
          <span class="badge badge-secondary">${transferHistory.length}</span>
        </div>
        <div class="transfer-table-wrap">
          <table class="data-table transfer-table">
            <thead>
              <tr>
                <th>Filename</th>
                <th>Size</th>
                <th>Status</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              ${transferHistory.map(t => `
                <tr>
                  <td class="mono">${t.filename || '—'}</td>
                  <td>${t.size_bytes ? UI.formatBytes(t.size_bytes) : '—'}</td>
                  <td><span class="status-pill ${t.status === 'COMPLETED' ? 'pass' : 'fail'}">${t.status}</span></td>
                  <td>${t.completed_at || t.created_at || '—'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
      ` : ''}
    `;
  }

  function transferRow(t) {
    const pct = t.total_chunks > 0 ? Math.round((t.uploaded_chunks / t.total_chunks) * 100) : (t.progress_pct || 0);
    const speed = t.speed_bytes_per_sec || t.speed || 0;
    const eta = t.eta_seconds || t.eta || 0;
    const statusClass = t.status === 'FAILED' ? 'fail' : (t.status === 'COMPLETED' ? 'pass' : 'info');

    return `
      <tr>
        <td class="mono">${t.filename || '—'}</td>
        <td>${t.size_bytes ? UI.formatBytes(t.size_bytes) : '—'}</td>
        <td style="min-width:160px;">
          <div class="transfer-progress-wrap">
            <div class="transfer-progress-bar">
              <div class="transfer-progress-fill" style="width:${pct}%"></div>
            </div>
            <span class="transfer-progress-text">${pct}%</span>
          </div>
        </td>
        <td>${speed ? UI.formatBytes(speed) + '/s' : '—'}</td>
        <td>${eta ? formatEta(eta) : '—'}</td>
        <td><span class="status-pill ${statusClass}">${t.status || 'UPLOADING'}</span></td>
        <td>${priorityLabel(t.priority)}</td>
        <td>
          ${t.status !== 'FAILED' && t.status !== 'COMPLETED' ? `
            <button class="btn btn-xs btn-ghost" title="Pause">⏸</button>
            <button class="btn btn-xs btn-ghost" title="Cancel">✕</button>
          ` : ''}
        </td>
      </tr>
    `;
  }

  function priorityLabel(p) {
    switch (p) {
      case 3: return '<span class="badge badge-danger">Urgent</span>';
      case 2: return '<span class="badge badge-warning">High</span>';
      case 0: return '<span class="badge badge-secondary">Low</span>';
      default: return '<span class="badge badge-info">Normal</span>';
    }
  }

  function formatEta(seconds) {
    if (seconds <= 0) return '—';
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
  }

  async function handleBrowserUpload(file) {
    UI.showToast(`Uploading ${file.name} (${UI.formatBytes(file.size)})…`, 'info');
    try {
      await API.upload(file, App.currentDeviceId, 'generic');
      UI.showToast('File uploaded successfully', 'success');
      loadTransfers();
    } catch (err) {
      UI.showToast('Upload failed: ' + err.message, 'error');
    }
  }

  function refresh() {
    loadTransfers();
  }

  App.registerPage('transfers', { init, refresh });
})();
