/**
 * pages/snapshots.js — Device State Snapshots
 * Capture, view, and compare device state snapshots
 */
(function () {
  'use strict';

  let snapshots = [];
  let selectedSnapshot = null;
  let compareMode = false;
  let compareFrom = null;
  let compareTo = null;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">State Snapshots</h1>
          <p class="page-subtitle">Capture and compare device management state at points in time</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary btn-sm" id="btnCompareMode">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"></path><path d="M8 3H3v5"></path><path d="M21 3l-7 7"></path><path d="M3 3l7 7"></path><path d="M16 21h5v-5"></path><path d="M8 21H3v-5"></path><path d="M21 21l-7-7"></path><path d="M3 21l7-7"></path></svg>
            Compare
          </button>
          <button class="btn btn-primary btn-sm" id="btnCreateSnapshot">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
            Create Snapshot
          </button>
        </div>
      </div>
      <div id="compareBar" style="display:none;" class="compare-bar">
        <span>Compare mode: select two snapshots</span>
        <span id="compareSelection">From: — | To: —</span>
        <button class="btn btn-xs btn-primary" id="btnRunCompare" disabled>Compare</button>
        <button class="btn btn-xs btn-ghost" id="btnCancelCompare">Cancel</button>
      </div>
      <div id="snapshotsContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading snapshots…</span></div>
      </div>
    `;

    document.getElementById('btnCreateSnapshot').addEventListener('click', () => {
      if (!deviceId) return;
      API.commands.create(deviceId, 'CREATE_SNAPSHOT', {})
        .then(() => UI.showToast('Snapshot command sent to device', 'success'))
        .catch(err => UI.showToast('Failed: ' + err.message, 'error'));
    });

    document.getElementById('btnCompareMode').addEventListener('click', () => {
      compareMode = !compareMode;
      compareFrom = null;
      compareTo = null;
      document.getElementById('compareBar').style.display = compareMode ? 'flex' : 'none';
      document.getElementById('btnRunCompare').disabled = true;
      updateCompareSelection();
      renderSnapshotList();
    });

    document.getElementById('btnCancelCompare').addEventListener('click', () => {
      compareMode = false;
      compareFrom = null;
      compareTo = null;
      document.getElementById('compareBar').style.display = 'none';
      renderSnapshotList();
    });

    document.getElementById('btnRunCompare').addEventListener('click', () => {
      if (compareFrom && compareTo) runCompare();
    });

    if (!deviceId) {
      document.getElementById('snapshotsContent').innerHTML = '';
      document.getElementById('snapshotsContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view snapshots.')
      );
      return;
    }

    await loadSnapshots();

    App.subscribeWS('SNAPSHOT_CREATED', () => {
      UI.showToast('New snapshot created', 'success');
      loadSnapshots();
    });
  }

  async function loadSnapshots() {
    const deviceId = App.currentDeviceId;
    try {
      const data = await API.snapshots.list(deviceId, { limit: 50 });
      snapshots = Array.isArray(data) ? data : (data.snapshots || []);
      renderSnapshotList();
    } catch (err) {
      document.getElementById('snapshotsContent').innerHTML = '';
      document.getElementById('snapshotsContent').appendChild(
        UI.emptyState('Failed to load', null, err.message)
      );
    }
  }

  function renderSnapshotList() {
    const content = document.getElementById('snapshotsContent');
    if (!content) return;

    if (snapshots.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('No snapshots', null, 'Click "Create Snapshot" to capture device state.'));
      return;
    }

    content.innerHTML = `
      <div class="snapshot-grid">
        ${snapshots.map(s => snapshotCard(s)).join('')}
      </div>
      <div id="snapshotDetail"></div>
      <div id="compareResult"></div>
    `;

    snapshots.forEach(s => {
      const el = document.getElementById('snap-' + s.id);
      if (el) {
        el.addEventListener('click', () => {
          if (compareMode) {
            handleCompareSelect(s);
          } else {
            viewSnapshot(s.id);
          }
        });
      }
    });
  }

  function snapshotCard(s) {
    const sum = s.summary || {};
    const isFrom = compareFrom && compareFrom.id === s.id;
    const isTo = compareTo && compareTo.id === s.id;
    const selectedClass = isFrom ? 'snapshot-selected-from' : (isTo ? 'snapshot-selected-to' : '');

    return `
      <div class="snapshot-card ${selectedClass}" id="snap-${s.id}" data-id="${s.id}">
        <div class="snapshot-card-header">
          <span class="snapshot-time">${formatTime(s.created_at)}</span>
          ${isFrom ? '<span class="badge badge-info">From</span>' : ''}
          ${isTo ? '<span class="badge badge-warning">To</span>' : ''}
        </div>
        <div class="snapshot-card-stats">
          <div class="snapshot-stat">
            <span class="snapshot-stat-label">Battery</span>
            <span class="snapshot-stat-value">${sum.battery_level != null ? sum.battery_level + '%' : '—'}</span>
          </div>
          <div class="snapshot-stat">
            <span class="snapshot-stat-label">Storage</span>
            <span class="snapshot-stat-value">${sum.storage_used_pct != null ? sum.storage_used_pct + '%' : '—'}</span>
          </div>
          <div class="snapshot-stat">
            <span class="snapshot-stat-label">Network</span>
            <span class="snapshot-stat-value">${sum.network_type || '—'}</span>
          </div>
        </div>
        <div class="snapshot-card-footer">
          <span class="snapshot-android">Android ${sum.android_version || '—'}</span>
        </div>
      </div>
    `;
  }

  function handleCompareSelect(s) {
    if (!compareFrom) {
      compareFrom = s;
    } else if (!compareTo) {
      compareTo = s;
      document.getElementById('btnRunCompare').disabled = false;
    } else {
      compareFrom = s;
      compareTo = null;
      document.getElementById('btnRunCompare').disabled = true;
    }
    updateCompareSelection();
    renderSnapshotList();
  }

  function updateCompareSelection() {
    const el = document.getElementById('compareSelection');
    if (el) {
      el.textContent = `From: ${compareFrom ? formatTime(compareFrom.created_at) : '—'} | To: ${compareTo ? formatTime(compareTo.created_at) : '—'}`;
    }
  }

  async function viewSnapshot(id) {
    try {
      const data = await API.snapshots.get(id);
      selectedSnapshot = data;
      renderSnapshotDetail(data);
    } catch (err) {
      UI.showToast('Failed to load snapshot: ' + err.message, 'error');
    }
  }

  function renderSnapshotDetail(data) {
    const detail = document.getElementById('snapshotDetail');
    if (!detail) return;
    const d = data.data || {};

    detail.innerHTML = `
      <div class="section-card" style="margin-top:16px;">
        <div class="section-header">
          <h3 class="section-title">Snapshot Details — ${formatTime(data.created_at)}</h3>
          <button class="btn btn-xs btn-ghost" onclick="document.getElementById('snapshotDetail').innerHTML=''">Close</button>
        </div>
        <div class="snapshot-detail-grid">
          ${snapshotSection('Device Info', d.device_info)}
          ${snapshotSection('Battery', d.battery)}
          ${snapshotSection('Storage', d.storage)}
          ${snapshotSection('RAM', d.ram)}
          ${snapshotSection('Network', d.network)}
          ${snapshotSection('Services', d.service_status)}
          ${snapshotSection('Sync State', d.sync_state)}
          ${snapshotSection('Display', d.display)}
          ${snapshotSection('Connection', d.connection)}
          ${d.permissions ? snapshotSection('Permissions', d.permissions) : ''}
        </div>
      </div>
    `;
  }

  function snapshotSection(title, data) {
    if (!data) return '';
    const entries = Object.entries(data);
    return `
      <div class="snapshot-section">
        <h4 class="snapshot-section-title">${title}</h4>
        <table class="snapshot-detail-table">
          ${entries.map(([k, v]) => `
            <tr>
              <td class="snapshot-key">${k.replace(/_/g, ' ')}</td>
              <td class="snapshot-value mono">${typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (v != null ? v : '—')}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    `;
  }

  async function runCompare() {
    try {
      const data = await API.snapshots.compare(compareFrom.id, compareTo.id);
      renderCompareResult(data);
    } catch (err) {
      UI.showToast('Compare failed: ' + err.message, 'error');
    }
  }

  function renderCompareResult(data) {
    const el = document.getElementById('compareResult');
    if (!el) return;

    const changed = data.changed || [];
    const added = data.added || [];
    const removed = data.removed || [];

    el.innerHTML = `
      <div class="section-card" style="margin-top:16px;">
        <div class="section-header">
          <h3 class="section-title">Comparison Result</h3>
          <span class="text-muted">${formatTime(data.from_created_at)} → ${formatTime(data.to_created_at)}</span>
        </div>
        <div class="compare-summary">
          <span class="badge badge-success">${changed.length} changed</span>
          <span class="badge badge-info">${added.length} added</span>
          <span class="badge badge-danger">${removed.length} removed</span>
        </div>
        ${changed.length > 0 ? `
        <table class="data-table compare-table">
          <thead><tr><th>Field</th><th>Old Value</th><th>New Value</th><th>Change</th></tr></thead>
          <tbody>
            ${changed.map(c => {
              const direction = classifyChange(c.field, c.old_value, c.new_value);
              return `
                <tr class="compare-row-${direction}">
                  <td class="mono">${c.field}</td>
                  <td class="mono">${formatVal(c.old_value)}</td>
                  <td class="mono">${formatVal(c.new_value)}</td>
                  <td><span class="diff-indicator diff-${direction}">${direction === 'improved' ? '↑ Improved' : direction === 'degraded' ? '↓ Degraded' : '~ Neutral'}</span></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        ` : '<p class="text-muted">No changes detected between snapshots.</p>'}
      </div>
    `;
  }

  function classifyChange(field, oldVal, newVal) {
    const f = field.toLowerCase();
    const oldNum = parseFloat(oldVal);
    const newNum = parseFloat(newVal);

    if (isNaN(oldNum) || isNaN(newNum)) return 'neutral';

    // Battery level increase = improved
    if (f.includes('battery') && (f.includes('level') || f.includes('percent'))) {
      return newNum > oldNum ? 'improved' : 'degraded';
    }
    // Storage used increase = degraded
    if (f.includes('storage') && f.includes('used')) {
      return newNum > oldNum ? 'degraded' : 'improved';
    }
    // RAM used increase = degraded
    if (f.includes('ram') && f.includes('used')) {
      return newNum > oldNum ? 'degraded' : 'improved';
    }
    // Available storage/RAM increase = improved
    if (f.includes('available')) {
      return newNum > oldNum ? 'improved' : 'degraded';
    }
    return 'neutral';
  }

  function formatVal(v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  function formatTime(ts) {
    if (!ts) return '—';
    try {
      const d = new Date(ts);
      return d.toLocaleString();
    } catch (_) { return ts; }
  }

  function refresh() {
    loadSnapshots();
  }

  App.registerPage('snapshots', { init, refresh });
})();
