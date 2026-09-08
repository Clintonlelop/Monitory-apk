/**
 * pages/diagnostics.js — Advanced Diagnostics
 * Server-side and device-side diagnostic checks
 */
(function () {
  'use strict';

  let currentResults = null;
  let history = [];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Diagnostics</h1>
          <p class="page-subtitle">Comprehensive system health checks for server and device</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary btn-sm" id="btnRunDeviceDiag" ${!deviceId ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
            Run Device Diagnostics
          </button>
          <button class="btn btn-primary btn-sm" id="btnRunDiag">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
            Run Diagnostics
          </button>
        </div>
      </div>
      <div id="diagContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading diagnostics…</span></div>
      </div>
    `;

    document.getElementById('btnRunDiag').addEventListener('click', () => runDiagnostics(false));
    document.getElementById('btnRunDeviceDiag').addEventListener('click', () => runDiagnostics(true));

    await loadHistory();
  }

  async function runDiagnostics(includeDevice) {
    const deviceId = App.currentDeviceId;
    const content = document.getElementById('diagContent');
    content.innerHTML = '<div class="loading-container"><div class="loading-spinner"></div><span>Running diagnostics…</span></div>';

    try {
      const data = await API.diagnostics.run({ device_id: deviceId || null });
      currentResults = data;

      // If device diagnostics requested, send command to device
      if (includeDevice && deviceId) {
        API.commands.create(deviceId, 'RUN_DIAGNOSTICS', {})
          .then(() => UI.showToast('Device diagnostics command sent', 'info'))
          .catch(() => {});
      }

      renderResults(data);
      loadHistory();
    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Diagnostics failed', null, err.message));
    }
  }

  async function loadHistory() {
    try {
      const data = await API.diagnostics.history({ limit: 20 });
      history = Array.isArray(data) ? data : (data.history || []);
      if (!currentResults && history.length > 0) {
        renderResults(history[0]);
      } else if (!currentResults) {
        document.getElementById('diagContent').innerHTML = '';
        document.getElementById('diagContent').appendChild(
          UI.emptyState('No diagnostics run yet', null, 'Click "Run Diagnostics" to check system health.')
        );
      }
      renderHistory();
    } catch (err) {
      // History may not be available yet
    }
  }

  function renderResults(data) {
    const content = document.getElementById('diagContent');
    if (!content) return;

    const results = data.results || [];
    const overall = data.overall_status || 'PASS';
    const passCount = results.filter(r => r.status === 'PASS').length;
    const warnCount = results.filter(r => r.status === 'WARNING').length;
    const failCount = results.filter(r => r.status === 'FAIL').length;

    const bannerClass = overall === 'PASS' ? 'diag-banner-pass' :
                        overall === 'WARNING' ? 'diag-banner-warning' : 'diag-banner-fail';
    const bannerText = overall === 'PASS' ? 'ALL SYSTEMS GO' :
                       overall === 'WARNING' ? 'WARNINGS DETECTED' : 'CRITICAL ISSUES';

    content.innerHTML = `
      <div class="diag-banner ${bannerClass}">
        <div class="diag-banner-icon">
          ${overall === 'PASS' ? '✓' : overall === 'WARNING' ? '⚠' : '✕'}
        </div>
        <div>
          <div class="diag-banner-title">${bannerText}</div>
          <div class="diag-banner-sub">${passCount} passed, ${warnCount} warnings, ${failCount} failures</div>
        </div>
      </div>

      <div class="section-card" style="margin-top:16px;">
        <div class="section-header">
          <h3 class="section-title">Check Results</h3>
        </div>
        <div class="diag-list">
          ${results.map((r, i) => diagItem(r, i)).join('')}
        </div>
      </div>

      <div id="diagHistory"></div>
    `;

    // Add expand/collapse
    results.forEach((_, i) => {
      const header = document.getElementById('diag-item-' + i);
      const detail = document.getElementById('diag-detail-' + i);
      if (header && detail) {
        header.addEventListener('click', () => {
          detail.classList.toggle('open');
          const arrow = header.querySelector('.diag-arrow');
          if (arrow) arrow.textContent = detail.classList.contains('open') ? '▼' : '▶';
        });
      }
    });

    renderHistory();
  }

  function diagItem(r, index) {
    const statusClass = r.status === 'PASS' ? 'diag-pass' : (r.status === 'WARNING' ? 'diag-warning' : 'diag-fail');
    const dots = '.'.repeat(Math.max(2, 20 - r.name.length));

    return `
      <div class="diag-item">
        <div class="diag-item-header" id="diag-item-${index}">
          <span class="diag-arrow">▶</span>
          <span class="diag-name mono">${r.name}</span>
          <span class="diag-dots">${dots}</span>
          <span class="diag-status ${statusClass}">${r.status}</span>
          <span class="diag-duration">${r.duration_ms}ms</span>
        </div>
        <div class="diag-item-detail" id="diag-detail-${index}">
          <div class="diag-message">${r.message || ''}</div>
          ${r.details ? `
            <div class="diag-details">
              ${Object.entries(r.details).map(([k, v]) => `
                <div class="diag-detail-row">
                  <span class="diag-detail-key">${k.replace(/_/g, ' ')}</span>
                  <span class="diag-detail-value mono">${typeof v === 'object' ? JSON.stringify(v) : v}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
          ${suggestFix(r)}
        </div>
      </div>
    `;
  }

  function suggestFix(r) {
    if (r.status === 'PASS') return '';
    let fix = '';
    switch (r.name) {
      case 'NETWORK': fix = 'Check network connection and firewall settings.'; break;
      case 'DATABASE': fix = 'Verify database file permissions and disk space.'; break;
      case 'UPLOAD': fix = 'Ensure storage directory is writable and has sufficient space.'; break;
      case 'WEBSOCKET': fix = 'Check WS server status and port configuration.'; break;
      case 'RATE_LIMIT': fix = 'Verify express-rate-limit middleware is configured.'; break;
      default: fix = 'Review the details above for more information.';
    }
    return `<div class="diag-suggestion"><strong>Suggested fix:</strong> ${fix}</div>`;
  }

  function renderHistory() {
    const el = document.getElementById('diagHistory');
    if (!el || history.length === 0) return;

    el.innerHTML = `
      <div class="section-card" style="margin-top:16px;">
        <div class="section-header">
          <h3 class="section-title">History</h3>
        </div>
        <div class="diag-history-list">
          ${history.map(h => `
            <div class="diag-history-item" data-id="${h.id}">
              <span class="diag-history-time">${formatTime(h.created_at)}</span>
              <span class="status-pill ${h.overall_status === 'PASS' ? 'pass' : h.overall_status === 'WARNING' ? 'warning' : 'fail'}">${h.overall_status}</span>
              <span class="text-muted">${(h.results || []).length} checks</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function formatTime(ts) {
    if (!ts) return '—';
    try { return new Date(ts).toLocaleString(); } catch (_) { return ts; }
  }

  function refresh() {
    loadHistory();
  }

  App.registerPage('diagnostics', { init, refresh });
})();
