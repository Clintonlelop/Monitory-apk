/**
 * pages/calls.js — Call log page
 * Call log table with type filtering, search, and sync
 */
(function () {
  'use strict';

  let calls = [];
  let filterType = '';
  let searchQuery = '';

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Calls</h1>
          <p class="page-subtitle">Device call history and logs</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="btnSyncCalls">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            Sync Calls
          </button>
        </div>
      </div>
      <div class="filter-bar">
        <input type="text" class="search-input form-input" id="callsSearch" placeholder="Search by number or name…">
        <select class="filter-select form-select" id="callsTypeFilter">
          <option value="">All types</option>
          <option value="incoming">Incoming</option>
          <option value="outgoing">Outgoing</option>
          <option value="missed">Missed</option>
        </select>
      </div>
      <div class="card">
        <div class="card-body no-padding">
          <div id="callsContent">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading call log…</span></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('callsContent').innerHTML = '';
      document.getElementById('callsContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view call logs.')
      );
      return;
    }

    document.getElementById('callsSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderCalls();
    });

    document.getElementById('callsTypeFilter').addEventListener('change', (e) => {
      filterType = e.target.value;
      renderCalls();
    });

    document.getElementById('btnSyncCalls').addEventListener('click', () => {
      API.commands.create(deviceId, 'SYNC_CALLS', {}).then(() => {
        UI.showToast('Call log sync command sent', 'success');
      }).catch(() => {});
    });

    await loadCalls();

    App.subscribeWS('CALLS_SYNCED', () => loadCalls());
  }

  async function loadCalls() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.calls.list(deviceId, { limit: 500 });
      calls = res.data || res || [];
      renderCalls();
    } catch (err) {
      document.getElementById('callsContent').innerHTML = '';
      document.getElementById('callsContent').appendChild(
        UI.emptyState('Failed to load call log', null, err.message)
      );
    }
  }

  function renderCalls() {
    const content = document.getElementById('callsContent');
    if (!content) return;

    let filtered = calls;
    if (filterType) {
      filtered = filtered.filter(c => (c.type || c.call_type || '').toLowerCase() === filterType);
    }
    if (searchQuery) {
      filtered = filtered.filter(c =>
        (c.number || c.phone_number || '').toLowerCase().includes(searchQuery) ||
        (c.contact_name || c.name || '').toLowerCase().includes(searchQuery)
      );
    }

    if (filtered.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        calls.length === 0 ? 'No call logs yet' : 'No matching calls',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>',
        calls.length === 0
          ? 'Click "Sync Calls" to pull call logs from the device. Requires Phone permission.'
          : 'Try adjusting your search or filter.'
      ));
      return;
    }

    const headers = [
      { label: 'Contact / Number', key: 'contact' },
      { label: 'Type', key: 'type' },
      { label: 'Duration', key: 'duration' },
      { label: 'Date & Time', key: 'date' }
    ];
    const rows = filtered.map(c => {
      const type = (c.type || c.call_type || '').toLowerCase();
      const typeBadge = document.createElement('span');
      typeBadge.className = 'badge ' + (type === 'incoming' ? 'badge-info' : type === 'outgoing' ? 'badge-success' : type === 'missed' ? 'badge-danger' : 'badge-muted');
      typeBadge.textContent = type || 'unknown';

      return {
        contact: c.contact_name || c.name || c.number || c.phone_number || 'Unknown',
        type: typeBadge,
        duration: c.duration != null ? UI.formatDuration(c.duration) : '—',
        date: UI.formatDateString(c.timestamp || c.date || c.created_at)
      };
    });

    content.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.appendChild(UI.createTable(headers, rows));
    content.appendChild(wrapper);
  }

  const module = { init, refresh: loadCalls };
  App.registerPage('calls', module);
})();
