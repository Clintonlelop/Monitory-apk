/**
 * pages/appsUsage.js — App usage statistics page
 * Usage bar chart, pie chart, daily trend, app list table
 */
(function () {
  'use strict';

  let usagePeriod = 'today'; // 'today' or '7d'

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Apps &amp; Usage</h1>
          <p class="page-subtitle">Application usage statistics and rankings</p>
        </div>
        <div class="page-actions">
          <div class="chart-toggle-group">
            <button class="chart-toggle-btn ${usagePeriod === 'today' ? 'active' : ''}" data-period="today">Today</button>
            <button class="chart-toggle-btn ${usagePeriod === '7d' ? 'active' : ''}" data-period="7d">7 Days</button>
          </div>
        </div>
      </div>
      <div id="usageContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading usage data…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('usageContent').innerHTML = '';
      document.getElementById('usageContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view app usage.')
      );
      return;
    }

    container.querySelectorAll('.chart-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        usagePeriod = btn.dataset.period;
        container.querySelectorAll('.chart-toggle-btn').forEach(b => b.classList.toggle('active', b === btn));
        loadUsage();
      });
    });

    await loadUsage();

    App.subscribeWS('USAGE_UPDATED', () => loadUsage());
  }

  async function loadUsage() {
    const deviceId = App.currentDeviceId;
    const content = document.getElementById('usageContent');
    if (!content || !deviceId) return;

    try {
      const res = await API.usage.list(deviceId, { period: usagePeriod, limit: 100 });
      const usageData = res.data || res || [];
      const apps = Array.isArray(usageData) ? usageData : (usageData.apps || []);

      if (apps.length === 0) {
        content.innerHTML = '';
        content.appendChild(UI.emptyState(
          'No usage data available',
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>',
          'App usage data requires Usage Access permission on the device. Data will appear here once available.'
        ));
        return;
      }

      // Sort by usage duration descending
      const sorted = [...apps].sort((a, b) => (b.total_time_in_foreground || b.usage_time || 0) - (a.total_time_in_foreground || a.usage_time || 0));
      const top10 = sorted.slice(0, 10);

      content.innerHTML = `
        <div class="grid grid-2" style="margin-bottom: 16px;">
          <div class="card">
            <div class="card-header"><div class="card-title">Top 10 Apps by Usage</div></div>
            <div class="card-body"><div id="usageBarChart" class="usage-chart-container"></div></div>
          </div>
          <div class="card">
            <div class="card-header"><div class="card-title">Usage Distribution</div></div>
            <div class="card-body"><div id="usagePieChart" class="usage-pie-container"></div></div>
          </div>
        </div>
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header"><div class="card-title">Daily Usage Trend</div></div>
          <div class="card-body"><div id="usageTrendChart" style="height: 240px;"></div></div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">All Applications</div>
            <span class="text-muted" style="font-size: 12px;">${sorted.length} apps</span>
          </div>
          <div class="card-body no-padding">
            <div style="overflow-x: auto;">
              ${renderAppTable(sorted)}
            </div>
          </div>
        </div>
      `;

      // Render charts
      renderBarChart(top10);
      renderPieChart(top10);
      renderTrendChart(apps);

    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Failed to load usage data', null, err.message));
    }
  }

  function renderBarChart(apps) {
    const el = document.getElementById('usageBarChart');
    if (!el || typeof echarts === 'undefined') return;
    const categories = apps.map(a => a.app_name || a.package_name || a.package || 'Unknown');
    const values = apps.map(a => Math.round((a.total_time_in_foreground || a.usage_time || 0) / 60000)); // ms to min
    Charts.init(el, Charts.horizontalBarChart(categories.reverse(), values.reverse(), {
      labelFormatter: (p) => p.value + ' min'
    }));
  }

  function renderPieChart(apps) {
    const el = document.getElementById('usagePieChart');
    if (!el || typeof echarts === 'undefined') return;
    const total = apps.reduce((sum, a) => sum + (a.total_time_in_foreground || a.usage_time || 0), 0);
    const data = apps.slice(0, 8).map(a => ({
      name: a.app_name || a.package_name || 'Unknown',
      value: Math.round((a.total_time_in_foreground || a.usage_time || 0) / 60000)
    }));
    if (apps.length > 8) {
      const otherTime = apps.slice(8).reduce((sum, a) => sum + (a.total_time_in_foreground || a.usage_time || 0), 0);
      data.push({ name: 'Others', value: Math.round(otherTime / 60000) });
    }
    Charts.init(el, Charts.pieChart(data));
  }

  function renderTrendChart(apps) {
    const el = document.getElementById('usageTrendChart');
    if (!el || typeof echarts === 'undefined') return;
    // Build daily trend from daily_breakdown if available, otherwise show top 5 apps
    const top5 = apps.slice(0, 5);
    const days = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      days.push((d.getMonth() + 1) + '/' + d.getDate());
    }
    const series = top5.map((a, i) => ({
      name: a.app_name || a.package_name || 'App ' + (i + 1),
      data: days.map(() => a.daily_breakdown ? (a.daily_breakdown[days.length - 1 - i] || 0) : Math.round((a.total_time_in_foreground || 0) / 60000 / 7)),
      color: ['#3b82f6', '#10b981', '#f59e0b', '#06b6d4', '#8b5cf6'][i]
    }));
    Charts.init(el, Charts.lineChart(days, series, {
      yAxis: { type: 'value', name: 'min' },
      legend: { show: true, top: 0 }
    }));
  }

  function renderAppTable(apps) {
    const headers = [
      { label: 'Rank', key: 'rank' },
      { label: 'App Name', key: 'app_name' },
      { label: 'Package', key: 'package', className: 'mono' },
      { label: 'Usage Time', key: 'usage_time' },
      { label: 'Last Used', key: 'last_time_used' }
    ];
    const rows = apps.map((a, i) => ({
      rank: i + 1,
      app_name: a.app_name || 'Unknown',
      package: a.package_name || a.package || '—',
      usage_time: UI.formatDuration(Math.round((a.total_time_in_foreground || a.usage_time || 0) / 1000)),
      last_time_used: UI.formatDateString(a.last_time_used || a.last_used)
    }));
    return UI.createTable(headers, rows).outerHTML;
  }

  const module = { init, refresh: loadUsage };
  App.registerPage('appsUsage', module);
})();
