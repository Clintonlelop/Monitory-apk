/**
 * pages/deviceHealth.js — Device Health / Telemetry page
 * Full telemetry display, battery history, storage/RAM breakdown
 */
(function () {
  'use strict';

  let chartMode = '24h'; // '24h' or '7d'

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Device Health</h1>
          <p class="page-subtitle">Real-time device telemetry and diagnostics</p>
        </div>
        <div class="page-actions">
          <span class="connection-status" id="liveIndicator" style="display: none;">
            <span class="status-dot online pulse"></span>
            <span class="status-text">Live</span>
          </span>
          <button class="btn btn-secondary btn-sm" id="btnViewPerf" onclick="location.hash='#/performance'">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 14l4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path></svg>
            Performance
          </button>
          <button class="btn btn-secondary btn-sm" id="btnRefreshHealth">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            Refresh
          </button>
        </div>
      </div>
      <div id="healthContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading telemetry…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('healthContent').innerHTML = '';
      document.getElementById('healthContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view its health metrics.')
      );
      return;
    }

    document.getElementById('btnRefreshHealth').addEventListener('click', () => loadHealth());

    await loadHealth();

    App.subscribeWS('TELEMETRY_UPDATED', () => {
      document.getElementById('liveIndicator')?.style.setProperty('display', 'flex');
      loadHealth();
      setTimeout(() => { document.getElementById('liveIndicator')?.style.setProperty('display', 'none'); }, 3000);
    });
  }

  async function loadHealth() {
    const deviceId = App.currentDeviceId;
    const content = document.getElementById('healthContent');
    if (!content || !deviceId) return;

    try {
      const limit = chartMode === '24h' ? 48 : 168;
      const telemetryRes = await API.telemetry.list(deviceId, { limit });
      const telemetry = telemetryRes.data || telemetryRes;
      const latest = Array.isArray(telemetry) && telemetry.length > 0 ? telemetry[0] : {};
      const device = App.getCurrentDevice() || {};

      content.innerHTML = `
        <!-- Telemetry Cards -->
        <div class="health-telemetry-grid" style="margin-bottom: 16px;">
          ${telemetryItem('Battery', latest.battery_percent != null ? latest.battery_percent + '%' : '—',
            latest.charging ? 'Charging' : 'Discharging',
            latest.battery_temp != null ? latest.battery_temp + '°C' : '',
            '#10b981', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"></rect><line x1="23" y1="13" x2="23" y2="11"></line></svg>')}
          ${telemetryItem('Network', latest.network_type || '—',
            latest.wifi_ssid ? 'Wi-Fi: ' + latest.wifi_ssid : '',
            latest.signal_strength != null ? 'Signal: ' + latest.signal_strength : '',
            '#3b82f6', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>')}
          ${telemetryItem('Storage', latest.storage_total ? UI.formatBytes(latest.storage_used || 0) + ' / ' + UI.formatBytes(latest.storage_total) : '—',
            latest.storage_total ? Math.round((latest.storage_used / latest.storage_total) * 100) + '% used' : '',
            '',
            '#f59e0b', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>')}
          ${telemetryItem('RAM', latest.ram_total ? UI.formatBytes(latest.ram_used || 0) + ' / ' + UI.formatBytes(latest.ram_total) : '—',
            latest.ram_total ? Math.round((latest.ram_used / latest.ram_total) * 100) + '% used' : '',
            latest.ram_available != null ? 'Free: ' + UI.formatBytes(latest.ram_available) : '',
            '#8b5cf6', '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M6 10v.01M10 10v.01M14 10v.01M18 10v.01"></path></svg>')}
        </div>

        <!-- Storage & RAM Progress -->
        <div class="grid grid-2" style="margin-bottom: 16px;">
          <div class="card">
            <div class="card-header"><div class="card-title">Storage</div></div>
            <div class="card-body">
              ${latest.storage_total ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="font-size: 13px;">${UI.formatBytes(latest.storage_used || 0)} used</span>
                  <span style="font-size: 13px; color: var(--text-muted);">${UI.formatBytes(latest.storage_total - (latest.storage_used || 0))} free</span>
                </div>
                <div class="progress-bar" style="height: 10px;">
                  <div class="progress-fill warning" style="width: ${Math.round((latest.storage_used / latest.storage_total) * 100)}%"></div>
                </div>
              ` : '<div class="text-muted" style="font-size: 13px;">No storage data available</div>'}
            </div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Memory (RAM)</div></div>
            <div class="card-body">
              ${latest.ram_total ? `
                <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                  <span style="font-size: 13px;">${UI.formatBytes(latest.ram_used || 0)} used</span>
                  <span style="font-size: 13px; color: var(--text-muted);">${UI.formatBytes(latest.ram_total - (latest.ram_used || 0))} free</span>
                </div>
                <div class="progress-bar" style="height: 10px;">
                  <div class="progress-fill" style="width: ${Math.round((latest.ram_used / latest.ram_total) * 100)}%"></div>
                </div>
              ` : '<div class="text-muted" style="font-size: 13px;">No RAM data available</div>'}
            </div>
          </div>
        </div>

        <!-- Battery History Chart -->
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">Battery History</div>
            <div class="chart-toggle-group">
              <button class="chart-toggle-btn ${chartMode === '24h' ? 'active' : ''}" data-mode="24h">24 Hours</button>
              <button class="chart-toggle-btn ${chartMode === '7d' ? 'active' : ''}" data-mode="7d">7 Days</button>
            </div>
          </div>
          <div class="card-body">
            <div id="batteryHistoryChart" class="health-chart-container"></div>
          </div>
        </div>

        <!-- Device Info -->
        <div class="card">
          <div class="card-header"><div class="card-title">Device Information</div></div>
          <div class="card-body">
            <div class="device-info-grid">
              ${deviceInfoItem('Model', device.model || latest.device_model || '—')}
              ${deviceInfoItem('Manufacturer', device.manufacturer || latest.manufacturer || '—')}
              ${deviceInfoItem('Android Version', device.android_version || latest.android_version || '—')}
              ${deviceInfoItem('App Version', device.app_version || latest.app_version || '—')}
              ${deviceInfoItem('Device ID', device.id || device.device_id || '—', true)}
              ${deviceInfoItem('Last Seen', UI.formatDateString(device.last_seen || latest.timestamp))}
            </div>
          </div>
        </div>

        <!-- Display Info -->
        <div class="card" style="margin-top: 16px;">
          <div class="card-header"><div class="card-title">Display Information</div></div>
          <div class="card-body">
            ${renderDisplayInfo(device, latest)}
          </div>
        </div>
      `;

      // Bind chart toggle
      content.querySelectorAll('.chart-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          chartMode = btn.dataset.mode;
          loadHealth();
        });
      });

      // Render battery chart
      renderBatteryHistory(telemetry);

    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Failed to load telemetry', null, err.message));
    }
  }

  function telemetryItem(label, value, sub, sub2, color, icon) {
    return `
      <div class="telemetry-item">
        <div class="telemetry-icon" style="background: ${color}20; color: ${color};">${icon}</div>
        <div class="telemetry-info">
          <div class="telemetry-label">${label}</div>
          <div class="telemetry-value">${value}</div>
          ${sub ? `<div class="telemetry-sub">${sub}</div>` : ''}
          ${sub2 ? `<div class="telemetry-sub">${sub2}</div>` : ''}
        </div>
      </div>
    `;
  }

  function deviceInfoItem(label, value, mono) {
    return `
      <div class="device-info-item">
        <div class="device-info-label">${label}</div>
        <div class="device-info-value ${mono ? 'text-mono' : ''}" style="${mono ? 'font-size: 12px; word-break: break-all;' : ''}">${value}</div>
      </div>
    `;
  }

  /**
   * Render display information section.
   * Pulls from device (latest registration) or latest telemetry record.
   */
  function renderDisplayInfo(device, latest) {
    const d = device || {};
    const t = latest || {};

    // Prefer device-level data (from registration), fall back to telemetry
    const width = d.display_width != null ? d.display_width : t.display_width;
    const height = d.display_height != null ? d.display_height : t.display_height;
    const refreshRate = d.display_refresh_rate != null ? d.display_refresh_rate : t.display_refresh_rate;
    const currentMode = d.display_current_mode;
    const supportedRates = d.display_supported_rates;
    const density = d.display_density != null ? d.display_density : t.display_density;
    const orientation = d.display_orientation != null ? d.display_orientation : t.display_orientation;
    const displaySize = d.display_size;

    const hasData = width != null || refreshRate != null || density != null;

    if (!hasData) {
      return '<div class="text-muted" style="font-size: 13px;">Not reported yet</div>';
    }

    let supportedRatesText = '—';
    if (supportedRates) {
      try {
        const rates = typeof supportedRates === 'string' ? JSON.parse(supportedRates) : supportedRates;
        if (Array.isArray(rates) && rates.length > 0) {
          supportedRatesText = rates.map(r => Math.round(r) + ' Hz').join(', ');
        }
      } catch (e) {
        supportedRatesText = String(supportedRates);
      }
    }

    const orientationText = orientation === 1 ? 'Portrait' : orientation === 2 ? 'Landscape' : '—';

    return `
      <div class="device-info-grid">
        ${deviceInfoItem('Resolution', width != null ? width + ' × ' + (height || '—') : '—')}
        ${deviceInfoItem('Refresh Rate', refreshRate != null ? Math.round(refreshRate) + ' Hz' : '—')}
        ${deviceInfoItem('Current Mode', currentMode != null ? Math.round(currentMode) + ' Hz' : '—')}
        ${deviceInfoItem('Supported Modes', supportedRatesText)}
        ${deviceInfoItem('Density', density != null ? density + ' DPI' : '—')}
        ${deviceInfoItem('Orientation', orientationText)}
        ${deviceInfoItem('Display Size', displaySize != null ? displaySize.toFixed(1) + ' inches' : '—')}
      </div>
    `;
  }

  function renderBatteryHistory(telemetry) {
    const el = document.getElementById('batteryHistoryChart');
    if (!el || typeof echarts === 'undefined') return;
    const data = Array.isArray(telemetry) ? [...telemetry].reverse() : [];
    if (data.length === 0) {
      el.innerHTML = '<div class="empty-state"><div class="empty-state-title">No battery history</div><div class="empty-state-desc">Telemetry data will appear here once the device reports in.</div></div>';
      return;
    }
    const xData = data.map(t => {
      const d = new Date(t.timestamp || t.created_at || Date.now());
      return chartMode === '24h'
        ? d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
        : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + 'h';
    });
    const batteryData = data.map(t => t.battery_percent != null ? t.battery_percent : null);
    const tempData = data.map(t => t.battery_temp != null ? t.battery_temp : null);

    Charts.init(el, Charts.lineChart(xData, [
      { name: 'Battery %', data: batteryData, color: '#10b981', area: true },
      { name: 'Temp °C', data: tempData, color: '#f59e0b' }
    ], {
      yAxis: { type: 'value' },
      legend: { show: true, top: 0 }
    }));
  }

  const module = { init, refresh: loadHealth };
  App.registerPage('deviceHealth', module);
})();
