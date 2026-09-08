/**
 * pages/permissions.js — Permissions center page
 * Permission status grid with descriptions and grant instructions
 */
(function () {
  'use strict';

  const PERMISSION_DEFS = [
    {
      key: 'LOCATION', name: 'Location', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>',
      desc: 'Access device GPS and network location for tracking.',
      instructions: 'Settings → Apps → [App] → Permissions → Location → Allow all the time'
    },
    {
      key: 'CAMERA', name: 'Camera', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>',
      desc: 'Capture photos remotely using device camera.',
      instructions: 'Settings → Apps → [App] → Permissions → Camera → Allow'
    },
    {
      key: 'MICROPHONE', name: 'Microphone', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line><line x1="8" y1="23" x2="16" y2="23"></line></svg>',
      desc: 'Record audio for voice memos and ambient recording.',
      instructions: 'Settings → Apps → [App] → Permissions → Microphone → Allow'
    },
    {
      key: 'NOTIFICATIONS', name: 'Notifications', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
      desc: 'Post notifications and show alerts.',
      instructions: 'Settings → Apps → [App] → Notifications → Allow notifications'
    },
    {
      key: 'CONTACTS', name: 'Contacts', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></path></svg>',
      desc: 'Read and sync device contacts.',
      instructions: 'Settings → Apps → [App] → Permissions → Contacts → Allow'
    },
    {
      key: 'PHONE', name: 'Phone / Call Logs', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>',
      desc: 'Read call log and phone state.',
      instructions: 'Settings → Apps → [App] → Permissions → Phone → Allow'
    },
    {
      key: 'SMS', name: 'SMS', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>',
      desc: 'Read and send SMS messages. May require default SMS app.',
      instructions: 'Settings → Apps → [App] → Permissions → SMS → Allow. For full SMS access, set as default SMS app.'
    },
    {
      key: 'USAGE_ACCESS', name: 'Usage Access', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>',
      desc: 'Track app usage statistics via UsageStatsManager.',
      instructions: 'Settings → Apps → Special app access → Usage access → [App] → Allow'
    },
    {
      key: 'NOTIFICATION_ACCESS', name: 'Notification Access', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>',
      desc: 'Read notifications via NotificationListenerService.',
      instructions: 'Settings → Apps → Special app access → Notification access → [App] → Allow'
    },
    {
      key: 'SCREEN_CAPTURE', name: 'Screen Capture', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>',
      desc: 'Capture screen and record via MediaProjection API.',
      instructions: 'Granted per-session via Android system consent dialog. No permanent setting.'
    },
    {
      key: 'STORAGE', name: 'Storage / Media', icon: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>',
      desc: 'Access photos, videos, and files via MediaStore / SAF.',
      instructions: 'Settings → Apps → [App] → Permissions → Files and media → Allow access to media only'
    }
  ];

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Permissions</h1>
          <p class="page-subtitle">Device permission status and grant instructions</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary btn-sm" id="btnRefreshPerms">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
            Refresh
          </button>
        </div>
      </div>
      <div id="permissionsContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading permissions…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('permissionsContent').innerHTML = '';
      document.getElementById('permissionsContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view permissions.')
      );
      return;
    }

    document.getElementById('btnRefreshPerms').addEventListener('click', () => {
      API.commands.create(deviceId, 'REQUEST_PERMISSIONS', {}).then(() => {
        UI.showToast('Permission status request sent', 'info');
      }).catch(() => {});
      loadPermissions();
    });

    await loadPermissions();

    App.subscribeWS('PERMISSION_STATUS_CHANGED', () => loadPermissions());
  }

  async function loadPermissions() {
    const deviceId = App.currentDeviceId;
    const content = document.getElementById('permissionsContent');
    if (!content || !deviceId) return;

    try {
      const res = await API.devices.getPermissions(deviceId);
      const permData = res.permissions || res.data || res || {};
      // Normalize: could be array of {permission, status} or object {KEY: status}
      const statusMap = {};
      if (Array.isArray(permData)) {
        permData.forEach(p => { statusMap[p.permission || p.name] = p.status; });
      } else if (typeof permData === 'object') {
        Object.entries(permData).forEach(([k, v]) => {
          statusMap[k] = typeof v === 'string' ? v : (v.status || v);
        });
      }

      content.innerHTML = `<div class="permissions-grid" id="permGrid"></div>`;
      const grid = document.getElementById('permGrid');

      PERMISSION_DEFS.forEach(def => {
        const status = statusMap[def.key] || statusMap[def.key.toLowerCase()] || 'NOT_AVAILABLE';
        const card = document.createElement('div');
        card.className = 'permission-card';
        const statusColor = status === 'GRANTED' ? '#10b981' : status === 'DENIED' ? '#ef4444' : status === 'REQUIRES_USER_ACTION' ? '#f59e0b' : '#64748b';

        card.innerHTML = `
          <div class="permission-icon" style="background: ${statusColor}20; color: ${statusColor};">${def.icon}</div>
          <div class="permission-info">
            <div class="permission-name">
              ${def.name}
              <span class="badge badge-${status === 'GRANTED' ? 'success' : status === 'DENIED' ? 'danger' : status === 'REQUIRES_USER_ACTION' ? 'warning' : 'muted'}">${status}</span>
            </div>
            <div class="permission-desc">${def.desc}</div>
            <div class="permission-instructions">${def.instructions}</div>
          </div>
        `;
        grid.appendChild(card);
      });

    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Failed to load permissions', null, err.message));
    }
  }

  const module = { init, refresh: loadPermissions };
  App.registerPage('permissions', module);
})();
