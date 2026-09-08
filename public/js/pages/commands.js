/**
 * pages/commands.js — Command history & dispatch page
 * Command history table, new command modal, live status updates
 */
(function () {
  'use strict';

  let commands = [];
  let filterStatus = '';
  let filterType = '';
  let expandedCmd = null;

  const COMMAND_TYPES = [
    'GET_LOCATION', 'REFRESH_TELEMETRY', 'CAPTURE_PHOTO',
    'START_SCREEN_RECORDING', 'STOP_SCREEN_RECORDING',
    'SYNC_CONTACTS', 'SYNC_CALLS', 'SYNC_SMS', 'SYNC_FILES', 'SYNC_ALL',
    'REQUEST_PERMISSIONS', 'LOCK_DEVICE', 'WIPE_DEVICE',
    'PLAY_SOUND', 'VIBRATE', 'TOGGLE_WIFI', 'TOGGLE_BLUETOOTH',
    'TAKE_SCREENSHOT', 'CLEAR_NOTIFICATIONS'
  ];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Commands</h1>
          <p class="page-subtitle">Command history and dispatch center</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="btnNewCommand">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            New Command
          </button>
        </div>
      </div>
      <div class="filter-bar">
        <select class="filter-select form-select" id="cmdStatusFilter">
          <option value="">All Statuses</option>
          <option value="QUEUED">Queued</option>
          <option value="SENDING">Sending</option>
          <option value="RECEIVED">Received</option>
          <option value="EXECUTING">Executing</option>
          <option value="COMPLETED">Completed</option>
          <option value="FAILED">Failed</option>
        </select>
        <select class="filter-select form-select" id="cmdTypeFilter">
          <option value="">All Types</option>
          ${COMMAND_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
        <span class="text-muted" id="cmdCount" style="font-size: 12px;"></span>
      </div>
      <div class="card">
        <div class="card-body no-padding">
          <div id="commandsContent">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading commands…</span></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('commandsContent').innerHTML = '';
      document.getElementById('commandsContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view commands.')
      );
      return;
    }

    document.getElementById('cmdStatusFilter').addEventListener('change', (e) => {
      filterStatus = e.target.value; renderCommands();
    });
    document.getElementById('cmdTypeFilter').addEventListener('change', (e) => {
      filterType = e.target.value; renderCommands();
    });
    document.getElementById('btnNewCommand').addEventListener('click', showNewCommandModal);

    await loadCommands();

    App.subscribeWS('COMMAND_COMPLETED', () => loadCommands());
    App.subscribeWS('COMMAND_FAILED', () => loadCommands());
  }

  async function loadCommands() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.commands.list(deviceId, { limit: 200 });
      commands = res.data || res || [];
      renderCommands();
    } catch (err) {
      document.getElementById('commandsContent').innerHTML = '';
      document.getElementById('commandsContent').appendChild(
        UI.emptyState('Failed to load commands', null, err.message)
      );
    }
  }

  function renderCommands() {
    const content = document.getElementById('commandsContent');
    const countEl = document.getElementById('cmdCount');
    if (!content) return;

    let filtered = commands;
    if (filterStatus) filtered = filtered.filter(c => (c.status || '') === filterStatus);
    if (filterType) filtered = filtered.filter(c => (c.type || c.command_type || '') === filterType);

    if (countEl) countEl.textContent = filtered.length + ' / ' + commands.length + ' commands';

    if (filtered.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        commands.length === 0 ? 'No commands yet' : 'No matching commands',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>',
        commands.length === 0 ? 'Click "New Command" to send a command to the device.' : 'Try adjusting filters.'
      ));
      return;
    }

    content.innerHTML = '';
    const table = document.createElement('table');
    table.className = 'data-table';
    table.innerHTML = `
      <thead><tr>
        <th></th>
        <th>Command ID</th>
        <th>Type</th>
        <th>Status</th>
        <th>Created</th>
        <th>Completed</th>
        <th>Result / Error</th>
      </tr></thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector('tbody');

    filtered.forEach(cmd => {
      const id = cmd.id || cmd.command_id;
      const isExpanded = expandedCmd === id;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="width: 32px;">
          <button class="command-expand-btn ${isExpanded ? 'expanded' : ''}" data-id="${id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
        </td>
        <td class="mono" style="font-size: 11px;">${UI.escapeHtml(String(id).substring(0, 12))}…</td>
        <td><span class="badge badge-primary">${UI.escapeHtml(cmd.type || cmd.command_type || '—')}</span></td>
        <td></td>
        <td>${UI.formatDateString(cmd.created_at || cmd.timestamp)}</td>
        <td>${cmd.completed_at ? UI.formatDateString(cmd.completed_at) : '—'}</td>
        <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${UI.escapeHtml(cmd.result || cmd.error || '—')}</td>
      `;
      tr.querySelector('td:nth-child(4)').appendChild(UI.createStatusBadge(cmd.status || 'UNKNOWN'));

      tr.querySelector('.command-expand-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        expandedCmd = expandedCmd === id ? null : id;
        renderCommands();
      });

      tbody.appendChild(tr);

      if (isExpanded) {
        const detailTr = document.createElement('tr');
        detailTr.className = 'command-detail-row';
        detailTr.innerHTML = `<td colspan="7"><div class="command-detail-content">
          <div class="grid grid-2" style="gap: 12px;">
            <div>
              <div class="command-detail-label">Payload</div>
              <div class="command-detail-value">${UI.escapeHtml(JSON.stringify(cmd.payload || {}, null, 2))}</div>
            </div>
            <div>
              <div class="command-detail-label">Result</div>
              <div class="command-detail-value">${UI.escapeHtml(cmd.result ? (typeof cmd.result === 'string' ? cmd.result : JSON.stringify(cmd.result, null, 2)) : '—')}</div>
            </div>
          </div>
          ${cmd.error ? `<div style="margin-top: 12px;"><div class="command-detail-label">Error</div><div class="command-detail-value" style="color: var(--danger);">${UI.escapeHtml(cmd.error)}</div></div>` : ''}
        </div></td>`;
        tbody.appendChild(detailTr);
      }
    });

    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.appendChild(table);
    content.appendChild(wrapper);
  }

  async function showNewCommandModal() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;

    const formHtml = `
      <div class="form-group">
        <label class="form-label">Command Type</label>
        <select class="form-select" id="newCmdType">
          ${COMMAND_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Payload (JSON, optional)</label>
        <textarea class="form-textarea" id="newCmdPayload" placeholder='{"key": "value"}'></textarea>
        <div class="form-hint">Optional JSON payload to send with the command.</div>
      </div>
    `;

    const result = await UI.showModal('Send New Command', formHtml, {
      buttons: [
        { text: 'Cancel', class: 'btn-secondary', value: null },
        { text: 'Send Command', class: 'btn-primary', value: 'send' }
      ]
    });

    if (result !== 'send') return;

    const type = document.getElementById('newCmdType')?.value;
    const payloadStr = document.getElementById('newCmdPayload')?.value;
    let payload = {};
    if (payloadStr && payloadStr.trim()) {
      try { payload = JSON.parse(payloadStr); }
      catch { UI.showToast('Invalid JSON payload', 'error'); return; }
    }

    try {
      await API.commands.create(deviceId, type, payload);
      UI.showToast(`Command ${type} sent to device`, 'success');
      loadCommands();
    } catch (err) {
      UI.showToast('Failed to send command: ' + err.message, 'error');
    }
  }

  const module = { init, refresh: loadCommands };
  App.registerPage('commands', module);
})();
