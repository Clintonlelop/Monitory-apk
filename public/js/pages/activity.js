/**
 * pages/activity.js — Activity timeline page
 * Vertical timeline of all activity events with filtering and live updates
 */
(function () {
  'use strict';

  let events = [];
  let filterType = '';
  let page = 1;
  const PAGE_SIZE = 50;

  const EVENT_TYPES = [
    { value: '', label: 'All Events' },
    { value: 'DEVICE_ONLINE', label: 'Device Online' },
    { value: 'DEVICE_OFFLINE', label: 'Device Offline' },
    { value: 'TELEMETRY_UPDATED', label: 'Telemetry' },
    { value: 'LOCATION_UPDATED', label: 'Location' },
    { value: 'NOTIFICATION_RECEIVED', label: 'Notification' },
    { value: 'COMMAND_COMPLETED', label: 'Command Completed' },
    { value: 'COMMAND_FAILED', label: 'Command Failed' },
    { value: 'MEDIA_UPLOADED', label: 'Media Uploaded' },
    { value: 'CONTACTS_SYNCED', label: 'Contacts Synced' },
    { value: 'CALLS_SYNCED', label: 'Calls Synced' },
    { value: 'SMS_SYNCED', label: 'SMS Synced' },
    { value: 'FILES_SYNCED', label: 'Files Synced' },
    { value: 'SCREEN_RECORDING_STARTED', label: 'Recording Started' },
    { value: 'SCREEN_RECORDING_COMPLETED', label: 'Recording Completed' },
    { value: 'GEOFENCE_EVENT', label: 'Geofence Event' },
    { value: 'PERMISSION_STATUS_CHANGED', label: 'Permission Changed' },
    { value: 'USAGE_UPDATED', label: 'Usage Updated' }
  ];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Activity Timeline</h1>
          <p class="page-subtitle">Complete audit log of all system activity</p>
        </div>
      </div>
      <div class="filter-bar">
        <select class="filter-select form-select" id="activityTypeFilter">
          ${EVENT_TYPES.map(t => `<option value="${t.value}">${t.label}</option>`).join('')}
        </select>
        <span class="text-muted" id="activityCount" style="font-size: 12px;"></span>
      </div>
      <div class="card">
        <div class="card-body">
          <div id="activityContent">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading activity…</span></div>
          </div>
          <div id="activityLoadMore" style="text-align: center; margin-top: 16px; display: none;">
            <button class="btn btn-secondary btn-sm" id="btnLoadMore">Load More</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('activityTypeFilter').addEventListener('change', (e) => {
      filterType = e.target.value;
      page = 1;
      renderActivity();
    });

    document.getElementById('btnLoadMore')?.addEventListener('click', () => {
      page++;
      renderActivity();
    });

    await loadActivity();

    // Live events prepended
    App.subscribeWS('*', (data) => {
      const eventType = data.type || data.event;
      if (eventType) {
        events.unshift({
          type: eventType,
          description: data.description || eventType.replace(/_/g, ' '),
          device_id: data.device_id || App.currentDeviceId,
          timestamp: data.timestamp || new Date().toISOString(),
          data: data
        });
        renderActivity();
      }
    });
  }

  async function loadActivity() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.activity.list({ device_id: deviceId, limit: 200 });
      events = res.data || res || [];
      renderActivity();
    } catch (err) {
      document.getElementById('activityContent').innerHTML = '';
      document.getElementById('activityContent').appendChild(
        UI.emptyState('Failed to load activity', null, err.message)
      );
    }
  }

  function getEventClass(type) {
    const t = (type || '').toLowerCase();
    if (t.includes('online')) return 'device_online';
    if (t.includes('offline')) return 'device_offline';
    if (t.includes('telemetry')) return 'telemetry';
    if (t.includes('location')) return 'location';
    if (t.includes('notification')) return 'notification';
    if (t.includes('command')) return 'command';
    if (t.includes('media') || t.includes('recording')) return 'media';
    if (t.includes('geofence')) return 'geofence';
    return 'default';
  }

  function renderActivity() {
    const content = document.getElementById('activityContent');
    const countEl = document.getElementById('activityCount');
    const loadMoreEl = document.getElementById('activityLoadMore');
    if (!content) return;

    let filtered = events;
    if (filterType) {
      filtered = events.filter(e => (e.type || e.event_type || '') === filterType);
    }

    if (countEl) countEl.textContent = filtered.length + ' events';

    if (filtered.length === 0) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState(
        'No activity yet',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>',
        'System activity will appear here in real-time.'
      ));
      if (loadMoreEl) loadMoreEl.style.display = 'none';
      return;
    }

    const visible = filtered.slice(0, page * PAGE_SIZE);
    const hasMore = visible.length < filtered.length;

    const timeline = document.createElement('div');
    timeline.className = 'timeline';

    visible.forEach(event => {
      const type = event.type || event.event_type || 'EVENT';
      const cls = getEventClass(type);
      const item = document.createElement('div');
      item.className = 'timeline-item';
      item.innerHTML = `
        <div class="timeline-dot ${cls}"></div>
        <div class="timeline-content">
          <div class="timeline-header">
            <span class="timeline-type">${UI.escapeHtml(event.description || type.replace(/_/g, ' '))}</span>
            <span class="timeline-time">${UI.formatDateString(event.timestamp || event.created_at)}</span>
          </div>
          ${event.details ? `<div class="timeline-desc">${UI.escapeHtml(event.details)}</div>` : ''}
          ${event.device_id ? `<div class="timeline-device">Device: ${UI.escapeHtml(event.device_id)}</div>` : ''}
        </div>
      `;
      timeline.appendChild(item);
    });

    content.innerHTML = '';
    content.appendChild(timeline);

    if (loadMoreEl) {
      loadMoreEl.style.display = hasMore ? 'block' : 'none';
    }
  }

  const module = { init, refresh: loadActivity };
  App.registerPage('activity', module);
})();
