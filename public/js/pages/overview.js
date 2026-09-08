/**
 * pages/overview.js — Overview dashboard page
 * Status cards, quick actions, recent activity, mini charts
 */
(function () {
  'use strict';

  let miniMapInstance = null;
  let batteryChart = null;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Overview</h1>
          <p class="page-subtitle" id="overviewDeviceName">Select a device to view details</p>
        </div>
        <div class="page-actions overview-quick-actions">
          <button class="btn btn-secondary btn-sm" id="btnRefreshTelemetry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            Refresh
          </button>
          <button class="btn btn-secondary btn-sm" id="btnGetLocation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            Get Location
          </button>
          <button class="btn btn-primary btn-sm" id="btnSyncAll">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            Sync All
          </button>
        </div>
      </div>
      <div id="overviewContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading device data…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('overviewContent').innerHTML = '';
      document.getElementById('overviewContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device from the dropdown above to view its overview.')
      );
      return;
    }

    const device = App.getCurrentDevice();
    if (device) {
      document.getElementById('overviewDeviceName').textContent =
        (device.name || device.model || device.id) + ' — ' + (device.manufacturer || '');
    }

    // Bind quick actions
    document.getElementById('btnRefreshTelemetry').addEventListener('click', () => {
      API.commands.create(deviceId, 'REFRESH_TELEMETRY', {}).then(() => {
        UI.showToast('Telemetry refresh command sent', 'success');
      }).catch(() => {});
    });
    document.getElementById('btnGetLocation').addEventListener('click', () => {
      API.commands.create(deviceId, 'GET_LOCATION', {}).then(() => {
        UI.showToast('Location request sent', 'success');
      }).catch(() => {});
    });
    document.getElementById('btnSyncAll').addEventListener('click', async () => {
      try {
        await API.commands.create(deviceId, 'SYNC_ALL', {});
        UI.showToast('Sync all command sent', 'success');
      } catch (e) {}
    });

    await loadOverview(container);

    // Subscribe to real-time updates
    App.subscribeWS('TELEMETRY_UPDATED', () => loadOverview(container));
    App.subscribeWS('LOCATION_UPDATED', () => loadOverview(container));
    App.subscribeWS('DEVICE_ONLINE', () => loadOverview(container));
    App.subscribeWS('DEVICE_OFFLINE', () => loadOverview(container));
  }

  async function loadOverview(container) {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    const content = document.getElementById('overviewContent');
    if (!content) return;

    try {
      const [telemetryRes, locationsRes, activityRes] = await Promise.allSettled([
        API.telemetry.list(deviceId, { limit: 24 }),
        API.locations.list(deviceId, { limit: 1 }),
        API.activity.list({ device_id: deviceId, limit: 10 })
      ]);

      const telemetry = telemetryRes.status === 'fulfilled' ? (telemetryRes.value.data || telemetryRes.value) : [];
      const locations = locationsRes.status === 'fulfilled' ? (locationsRes.value.data || locationsRes.value) : [];
      const activity = activityRes.status === 'fulfilled' ? (activityRes.value.data || activityRes.value) : [];

      const latest = Array.isArray(telemetry) && telemetry.length > 0 ? telemetry[0] : {};
      const latestLoc = Array.isArray(locations) && locations.length > 0 ? locations[0] : null;
      const device = App.getCurrentDevice() || {};

      content.innerHTML = `
        <div class="grid grid-5" style="margin-bottom: 16px;">
          ${statCard('Status', device.online ? 'Online' : 'Offline', device.online ? 'text-success' : 'text-danger',
            `<div class="stat-icon" style="background: ${device.online ? 'var(--success-dim)' : 'var(--danger-dim)'}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${device.online ? '#10b981' : '#ef4444'}" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg></div>`,
            device.last_seen ? 'Last seen ' + UI.formatDateString(device.last_seen) : 'Never')}
          ${statCard('Battery', latest.battery_percent != null ? latest.battery_percent + '%' : '—', '',
            `<div class="stat-icon" style="background: var(--info-dim)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"></rect><line x1="23" y1="13" x2="23" y2="11"></line></svg></div>`,
            latest.charging ? 'Charging' : (latest.battery_temp != null ? latest.battery_temp + '°C' : 'Discharging'))}
          ${statCard('Storage', latest.storage_used != null && latest.storage_total ? Math.round((latest.storage_used / latest.storage_total) * 100) + '%' : '—', '',
            `<div class="stat-icon" style="background: var(--warning-dim)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg></div>`,
            latest.storage_used != null ? UI.formatBytes(latest.storage_used) + ' used' : 'No data')}
          ${statCard('RAM', latest.ram_used != null && latest.ram_total ? Math.round((latest.ram_used / latest.ram_total) * 100) + '%' : '—', '',
            `<div class="stat-icon" style="background: var(--accent-primary-dim)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 10v.01M10 10v.01M14 10v.01M18 10v.01"></path></svg></div>`,
            latest.ram_used != null ? UI.formatBytes(latest.ram_used) + ' used' : 'No data')}
          ${statCard('Network', latest.network_type || '—', '',
            `<div class="stat-icon" style="background: var(--success-dim)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg></div>`,
            latest.wifi_ssid || latest.network_type || 'Unknown')}
        </div>
        <div class="grid grid-2">
          <div class="card">
            <div class="card-header">
              <div class="card-title">Battery (24h)</div>
              <span class="badge badge-muted">Live</span>
            </div>
            <div class="card-body">
              <div id="overviewBatteryChart" style="height: 200px;"></div>
            </div>
          </div>
          <div class="card">
            <div class="card-header">
              <div class="card-title">Current Location</div>
              ${latestLoc ? `<span class="badge badge-success">Updated</span>` : ''}
            </div>
            <div class="card-body no-padding">
              <div id="overviewMiniMap" class="overview-mini-map"></div>
            </div>
          </div>
        </div>
        <div class="card mt-4">
          <div class="card-header">
            <div class="card-title">Recent Activity</div>
            <span class="text-muted" style="font-size: 12px;">Last 10 events</span>
          </div>
          <div class="card-body no-padding">
            <div class="overview-activity-feed" id="overviewActivityFeed"></div>
          </div>
        </div>
      `;

      // Render battery chart
      renderBatteryChart(telemetry);

      // Render mini map
      if (latestLoc) {
        renderMiniMap(latestLoc);
      } else {
        const mapEl = document.getElementById('overviewMiniMap');
        if (mapEl) {
          mapEl.style.display = 'flex';
          mapEl.style.alignItems = 'center';
          mapEl.style.justifyContent = 'center';
          mapEl.innerHTML = '<div class="empty-state"><div class="empty-state-title">No location data</div><div class="empty-state-desc">Location has not been reported yet.</div></div>';
        }
      }

      // Render activity feed
      renderActivityFeed(activity);

    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Failed to load overview', null, err.message));
    }
  }

  function statCard(label, value, valueClass, icon, sub) {
    return `
      <div class="stat-card">
        <div class="stat-card-header">
          <span class="stat-label">${label}</span>
          ${icon}
        </div>
        <div class="stat-value ${valueClass || ''}">${value}</div>
        <div class="stat-sub">${sub || ''}</div>
      </div>
    `;
  }

  function renderBatteryChart(telemetry) {
    const el = document.getElementById('overviewBatteryChart');
    if (!el || typeof echarts === 'undefined') return;
    const data = Array.isArray(telemetry) ? [...telemetry].reverse() : [];
    const xData = data.map(t => {
      const d = new Date(t.timestamp || t.created_at || Date.now());
      return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
    });
    const yData = data.map(t => t.battery_percent != null ? t.battery_percent : null);
    Charts.init(el, Charts.lineChart(xData, [{ name: 'Battery %', data: yData, color: '#10b981', area: true }], {
      yAxis: { type: 'value', min: 0, max: 100 },
      grid: { left: '3%', right: '4%', bottom: '3%', top: '8%', containLabel: true }
    }));
  }

  function renderMiniMap(location) {
    const el = document.getElementById('overviewMiniMap');
    if (!el || typeof L === 'undefined') return;
    if (miniMapInstance) {
      try { miniMapInstance.map.remove(); } catch (e) {}
    }
    miniMapInstance = MapHelper.init(el, { zoomControl: false, attributionControl: false });
    if (miniMapInstance) {
      MapHelper.addDeviceMarker(miniMapInstance, location.lat || location.latitude, location.lng || location.longitude, {
        accuracy: location.accuracy,
        zoom: 14
      });
    }
  }

  function renderActivityFeed(activity) {
    const feed = document.getElementById('overviewActivityFeed');
    if (!feed) return;
    if (!activity || activity.length === 0) {
      feed.appendChild(UI.emptyState('No activity yet', null, 'Device activity will appear here.'));
      return;
    }
    activity.forEach(event => {
      const item = document.createElement('div');
      item.className = 'activity-feed-item';
      const type = (event.type || event.event_type || '').toLowerCase();
      const colors = {
        device_online: '#10b981', device_offline: '#ef4444', telemetry: '#06b6d4',
        location: '#3b82f6', notification: '#8b5cf6', command: '#f59e0b',
        media: '#ec4899', geofence: '#f97316'
      };
      const color = colors[type] || '#64748b';
      item.innerHTML = `
        <div class="activity-feed-icon" style="background: ${color}20;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: ${color};"></div>
        </div>
        <div class="activity-feed-content">
          <div class="activity-feed-title">${UI.escapeHtml(event.description || event.type || 'Event')}</div>
          <div class="activity-feed-desc">${UI.escapeHtml(event.device_id || '')}</div>
        </div>
        <div class="activity-feed-time">${UI.formatDateString(event.timestamp || event.created_at)}</div>
      `;
      feed.appendChild(item);
    });
  }

  const module = { init, refresh: () => loadOverview(document.getElementById('pageContainer')) };
  App.registerPage('overview', module);
})();
