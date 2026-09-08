/**
 * pages/performance.js — Device Performance Monitoring
 * CPU, memory, storage, battery, uptime, network, thermal, service health
 */
(function () {
  'use strict';

  let cpuChart = null;
  let memChart = null;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Performance</h1>
          <p class="page-subtitle">Real-time device performance metrics and history</p>
        </div>
        <div class="page-actions">
          <span class="connection-status" id="perfLiveIndicator" style="display:none;">
            <span class="status-dot online pulse"></span>
            <span class="status-text">Live</span>
          </span>
          <button class="btn btn-secondary btn-sm" id="btnRefreshPerf">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            Refresh
          </button>
        </div>
      </div>
      <div id="perfContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading performance data…</span></div>
      </div>
    `;

    document.getElementById('btnRefreshPerf').addEventListener('click', () => loadPerformance());

    if (!deviceId) {
      document.getElementById('perfContent').innerHTML = '';
      document.getElementById('perfContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view performance metrics.')
      );
      return;
    }

    await loadPerformance();

    App.subscribeWS('TELEMETRY_UPDATED', () => {
      document.getElementById('perfLiveIndicator')?.style.setProperty('display', 'flex');
      loadPerformance();
      setTimeout(() => { document.getElementById('perfLiveIndicator')?.style.setProperty('display', 'none'); }, 3000);
    });
  }

  async function loadPerformance() {
    const deviceId = App.currentDeviceId;
    const content = document.getElementById('perfContent');
    if (!content || !deviceId) return;

    try {
      const data = await API.performance.history(deviceId, { hours: 24 });
      const latest = data.latest || {};
      const history = data.history || [];
      const device = App.getCurrentDevice() || {};

      content.innerHTML = `
        <!-- Overview Cards -->
        <div class="perf-cards-grid">
          ${gaugeCard('CPU Usage', latest.cpu_usage, '%', '#3b82f6', 'cpu')}
          ${gaugeCard('Memory', latest.app_memory_mb, 'MB', '#8b5cf6', 'memory')}
          ${storageCard(device)}
          ${batteryCard(device, latest)}
        </div>

        <!-- Uptime & Info Row -->
        <div class="perf-info-row">
          <div class="perf-info-card">
            <div class="perf-info-label">Device Uptime</div>
            <div class="perf-info-value">${formatUptime(latest.uptime_seconds)}</div>
          </div>
          <div class="perf-info-card">
            <div class="perf-info-label">CPU Frequency</div>
            <div class="perf-info-value">${latest.cpu_freq_mhz ? latest.cpu_freq_mhz + ' MHz' : '—'}</div>
          </div>
          <div class="perf-info-card">
            <div class="perf-info-label">Refresh Rate</div>
            <div class="perf-info-value">${latest.display_refresh_rate ? latest.display_refresh_rate + ' Hz' : '—'}</div>
          </div>
          <div class="perf-info-card">
            <div class="perf-info-label">Network</div>
            <div class="perf-info-value">${device.network_type || '—'}</div>
          </div>
          ${thermalCard(latest.thermal_status)}
        </div>

        <!-- Charts -->
        <div class="perf-charts-grid">
          <div class="section-card">
            <div class="section-header"><h3 class="section-title">CPU Usage (24h)</h3></div>
            <div id="cpuChart" style="height:280px;"></div>
          </div>
          <div class="section-card">
            <div class="section-header"><h3 class="section-title">Memory Usage (24h)</h3></div>
            <div id="memChart" style="height:280px;"></div>
          </div>
        </div>

        <!-- Service Health Panel -->
        <div class="section-card" style="margin-top:16px;">
          <div class="section-header"><h3 class="section-title">Service Health</h3></div>
          <div class="service-health-grid">
            ${serviceHealthItem('Foreground Service', latest.service_health?.foreground)}
            ${serviceHealthItem('Notification Listener', latest.service_health?.notification_listener)}
            ${serviceHealthItem('Accessibility', latest.service_health?.accessibility)}
            ${serviceHealthItem('WorkManager', true)}
          </div>
        </div>

        <!-- Performance Insights -->
        <div id="perfInsights"></div>
      `;

      // Render charts
      renderCpuChart(history);
      renderMemChart(history);

      // Generate insights
      renderInsights(latest, device);

    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Failed to load', null, err.message));
    }
  }

  function gaugeCard(title, value, unit, color, id) {
    const pct = value != null ? Math.min(100, Math.max(0, parseFloat(value))) : 0;
    return `
      <div class="perf-gauge-card">
        <div class="perf-gauge-title">${title}</div>
        <div class="perf-gauge-container">
          <svg class="perf-gauge-svg" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" stroke-width="10"/>
            <circle cx="60" cy="60" r="50" fill="none" stroke="${color}" stroke-width="10"
              stroke-dasharray="${pct * 3.14} 314" stroke-linecap="round"
              transform="rotate(-90 60 60)"/>
          </svg>
          <div class="perf-gauge-value">
            <span class="perf-gauge-number">${value != null ? (typeof value === 'number' ? value.toFixed(1) : value) : '—'}</span>
            <span class="perf-gauge-unit">${unit}</span>
          </div>
        </div>
      </div>
    `;
  }

  function storageCard(device) {
    const total = device.storage_total || 0;
    const used = device.storage_used || 0;
    const pct = total > 0 ? Math.round((used / total) * 100) : 0;
    return `
      <div class="perf-gauge-card">
        <div class="perf-gauge-title">Storage</div>
        <div class="perf-storage-display">
          <div class="perf-storage-big">${pct}%</div>
          <div class="perf-storage-sub">${UI.formatBytes(used)} / ${UI.formatBytes(total)}</div>
          <div class="perf-progress-bar">
            <div class="perf-progress-fill" style="width:${pct}%; background:#f59e0b;"></div>
          </div>
        </div>
      </div>
    `;
  }

  function batteryCard(device, latest) {
    const level = device.battery != null ? device.battery : '—';
    const temp = device.battery_temp != null ? device.battery_temp + '°C' : '—';
    const health = latest.battery_health || '—';
    const charging = device.charging ? 'Charging' : 'Discharging';
    return `
      <div class="perf-gauge-card">
        <div class="perf-gauge-title">Battery</div>
        <div class="perf-battery-display">
          <div class="perf-battery-level">${level}${typeof level === 'number' ? '%' : ''}</div>
          <div class="perf-battery-sub">${charging} · ${temp}</div>
          <div class="perf-battery-health">Health: ${health}</div>
        </div>
      </div>
    `;
  }

  function thermalCard(status) {
    if (!status) return '';
    const colors = {
      'NONE': '#10b981', 'LIGHT': '#84cc16', 'MODERATE': '#f59e0b',
      'SEVERE': '#f97316', 'CRITICAL': '#ef4444', 'SHUTDOWN': '#dc2626'
    };
    const color = colors[status] || '#6b7280';
    return `
      <div class="perf-info-card">
        <div class="perf-info-label">Thermal Status</div>
        <div class="perf-info-value" style="color:${color};">● ${status}</div>
      </div>
    `;
  }

  function serviceHealthItem(name, running) {
    const ok = running === true || running === 1;
    return `
      <div class="service-health-item ${ok ? 'healthy' : 'unhealthy'}">
        <div class="service-health-indicator">${ok ? '●' : '○'}</div>
        <div class="service-health-name">${name}</div>
        <div class="service-health-status">${ok ? 'Running' : 'Stopped'}</div>
      </div>
    `;
  }

  function renderCpuChart(history) {
    const el = document.getElementById('cpuChart');
    if (!el || typeof echarts === 'undefined') return;
    if (cpuChart) cpuChart.dispose();
    cpuChart = echarts.init(el);

    const times = history.map(h => formatChartTime(h.created_at));
    const cpuData = history.map(h => h.cpu_usage != null ? parseFloat(h.cpu_usage) : null);

    cpuChart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 50, right: 20, top: 20, bottom: 30 },
      xAxis: { type: 'category', data: times, axisLabel: { fontSize: 10 } },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [{
        name: 'CPU %',
        type: 'line',
        data: cpuData,
        smooth: true,
        lineStyle: { color: '#3b82f6', width: 2 },
        areaStyle: { color: 'rgba(59,130,246,0.1)' },
        showSymbol: false
      }]
    });
  }

  function renderMemChart(history) {
    const el = document.getElementById('memChart');
    if (!el || typeof echarts === 'undefined') return;
    if (memChart) memChart.dispose();
    memChart = echarts.init(el);

    const times = history.map(h => formatChartTime(h.created_at));
    const memData = history.map(h => h.app_memory_mb != null ? parseFloat(h.app_memory_mb) : null);
    const ramUsedData = history.map(h => {
      if (h.ram_total && h.ram_used) return Math.round((h.ram_used / h.ram_total) * 100);
      return null;
    });

    memChart.setOption({
      tooltip: { trigger: 'axis' },
      legend: { data: ['App Memory (MB)', 'RAM Used (%)'], bottom: 0 },
      grid: { left: 50, right: 20, top: 20, bottom: 40 },
      xAxis: { type: 'category', data: times, axisLabel: { fontSize: 10 } },
      yAxis: [
        { type: 'value', name: 'MB', position: 'left' },
        { type: 'value', name: '%', position: 'right', max: 100 }
      ],
      series: [
        {
          name: 'App Memory (MB)', type: 'line', data: memData, smooth: true,
          lineStyle: { color: '#8b5cf6', width: 2 }, showSymbol: false, yAxisIndex: 0
        },
        {
          name: 'RAM Used (%)', type: 'line', data: ramUsedData, smooth: true,
          lineStyle: { color: '#f59e0b', width: 2 }, showSymbol: false, yAxisIndex: 1
        }
      ]
    });
  }

  function renderInsights(latest, device) {
    const el = document.getElementById('perfInsights');
    if (!el) return;
    const insights = [];

    if (latest.cpu_usage != null && parseFloat(latest.cpu_usage) > 70) {
      insights.push({ type: 'warning', text: 'CPU usage is high — may affect remote streaming quality and battery life.' });
    }
    if (device.battery_temp != null && parseFloat(device.battery_temp) > 40) {
      insights.push({ type: 'warning', text: 'Battery temperature elevated — consider reducing screen brightness or closing background apps.' });
    }
    if (latest.thermal_status && ['SEVERE', 'CRITICAL', 'SHUTDOWN'].includes(latest.thermal_status)) {
      insights.push({ type: 'danger', text: `Thermal status is ${latest.thermal_status} — device may throttle performance.` });
    }
    if (device.storage_total && device.storage_used) {
      const pct = (device.storage_used / device.storage_total) * 100;
      if (pct > 85) {
        insights.push({ type: 'warning', text: `Storage is ${pct.toFixed(0)}% full — low storage can impact app performance.` });
      }
    }
    if (latest.service_health) {
      if (!latest.service_health.foreground) {
        insights.push({ type: 'danger', text: 'Foreground service is not running — real-time monitoring may be interrupted.' });
      }
      if (!latest.service_health.notification_listener) {
        insights.push({ type: 'info', text: 'Notification listener is disconnected — notification monitoring will not work.' });
      }
    }

    if (insights.length === 0) {
      insights.push({ type: 'success', text: 'All performance metrics within normal ranges.' });
    }

    el.innerHTML = `
      <div class="section-card" style="margin-top:16px;">
        <div class="section-header"><h3 class="section-title">Performance Insights</h3></div>
        <div class="perf-insights-list">
          ${insights.map(i => `
            <div class="perf-insight perf-insight-${i.type}">
              <span class="perf-insight-icon">${i.type === 'success' ? '✓' : i.type === 'warning' ? '⚠' : i.type === 'danger' ? '✕' : 'ℹ'}</span>
              <span>${i.text}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function formatUptime(seconds) {
    if (!seconds) return '—';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(days + 'd');
    if (hours > 0) parts.push(hours + 'h');
    parts.push(mins + 'm');
    return parts.join(' ');
  }

  function formatChartTime(ts) {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    } catch (_) { return ''; }
  }

  function refresh() {
    loadPerformance();
  }

  App.registerPage('performance', { init, refresh });
})();
