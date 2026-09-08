/**
 * pages/notifications.js — Notification monitoring feed
 * Live notification feed with filtering and search
 */
(function () {
  'use strict';

  let notifications = [];
  let filterPackage = '';
  let searchQuery = '';

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Notifications</h1>
          <p class="page-subtitle">Live notification feed from the device</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary btn-sm" id="btnClearNotifications">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Clear
          </button>
        </div>
      </div>
      <div class="filter-bar">
        <input type="text" class="search-input form-input" id="notifSearch" placeholder="Search notifications…">
        <select class="filter-select form-select" id="notifPackageFilter">
          <option value="">All apps</option>
        </select>
      </div>
      <div class="card">
        <div class="card-body no-padding">
          <div id="notifFeed" class="notification-feed">
            <div class="loading-container"><div class="loading-spinner"></div><span>Loading notifications…</span></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('notifFeed').innerHTML = '';
      document.getElementById('notifFeed').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view notifications.')
      );
      return;
    }

    document.getElementById('notifSearch').addEventListener('input', (e) => {
      searchQuery = e.target.value.toLowerCase();
      renderFeed();
    });

    document.getElementById('notifPackageFilter').addEventListener('change', (e) => {
      filterPackage = e.target.value;
      renderFeed();
    });

    document.getElementById('btnClearNotifications').addEventListener('click', async () => {
      const confirmed = await UI.confirmDialog('Clear all displayed notifications? This only clears the dashboard view.');
      if (confirmed) {
        notifications = [];
        renderFeed();
        UI.showToast('Notifications cleared', 'info');
      }
    });

    await loadNotifications();

    // Live updates
    App.subscribeWS('NOTIFICATION_RECEIVED', (data) => {
      const notif = data.notification || data;
      if (notif) {
        notifications.unshift(notif);
        updatePackageFilter();
        renderFeed();
      }
    });
  }

  async function loadNotifications() {
    const deviceId = App.currentDeviceId;
    if (!deviceId) return;
    try {
      const res = await API.notifications.list(deviceId, { limit: 200 });
      notifications = res.data || res || [];
      updatePackageFilter();
      renderFeed();
    } catch (err) {
      document.getElementById('notifFeed').innerHTML = '';
      document.getElementById('notifFeed').appendChild(
        UI.emptyState('Failed to load notifications', null, err.message)
      );
    }
  }

  function updatePackageFilter() {
    const select = document.getElementById('notifPackageFilter');
    if (!select) return;
    const packages = [...new Set(notifications.map(n => n.package_name || n.package).filter(Boolean))];
    const current = select.value;
    select.innerHTML = '<option value="">All apps</option>';
    packages.forEach(pkg => {
      const opt = document.createElement('option');
      opt.value = pkg;
      opt.textContent = pkg;
      select.appendChild(opt);
    });
    select.value = current;
  }

  function renderFeed() {
    const feed = document.getElementById('notifFeed');
    if (!feed) return;

    let filtered = notifications;
    if (filterPackage) {
      filtered = filtered.filter(n => (n.package_name || n.package) === filterPackage);
    }
    if (searchQuery) {
      filtered = filtered.filter(n =>
        (n.title || '').toLowerCase().includes(searchQuery) ||
        (n.text || '').toLowerCase().includes(searchQuery) ||
        (n.app_name || '').toLowerCase().includes(searchQuery)
      );
    }

    if (filtered.length === 0) {
      feed.innerHTML = '';
      feed.appendChild(UI.emptyState(
        notifications.length === 0 ? 'No notifications received yet' : 'No matching notifications',
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
        notifications.length === 0
          ? 'Notifications from the device will appear here in real-time. Ensure notification access is granted.'
          : 'Try adjusting your search or filter.'
      ));
      return;
    }

    feed.innerHTML = '';
    filtered.forEach(notif => {
      const item = document.createElement('div');
      item.className = 'notification-item';
      const appName = notif.app_name || notif.package_name || notif.package || 'Unknown';
      const color = stringToColor(appName);
      const initial = appName.charAt(0).toUpperCase();

      item.innerHTML = `
        <div class="notification-app-icon" style="background: ${color};">${initial}</div>
        <div class="notification-content">
          <div class="notification-header">
            <span class="notification-app-name">${UI.escapeHtml(appName)}</span>
            ${notif.category ? `<span class="notification-category">${UI.escapeHtml(notif.category)}</span>` : ''}
          </div>
          ${notif.title ? `<div class="notification-title">${UI.escapeHtml(notif.title)}</div>` : ''}
          ${notif.text ? `<div class="notification-text">${UI.escapeHtml(notif.text)}</div>` : ''}
        </div>
        <div class="notification-time">${UI.formatDateString(notif.timestamp || notif.created_at)}</div>
      `;
      feed.appendChild(item);
    });
  }

  function stringToColor(str) {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
    let hash = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
  }

  const module = { init, refresh: loadNotifications };
  App.registerPage('notifications', module);
})();
