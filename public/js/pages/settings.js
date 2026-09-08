/**
 * pages/settings.js — Settings page
 * User profile, server info, JWT token display, dashboard preferences, logout
 */
(function () {
  'use strict';

  async function init(container) {
    const user = Auth.getUser() || {};
    const token = Auth.getToken();

    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Account, server, and dashboard preferences</p>
        </div>
      </div>

      <div class="grid grid-2">
        <!-- User Profile -->
        <div class="card">
          <div class="card-header"><div class="card-title">User Profile</div></div>
          <div class="card-body">
            <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 20px;">
              <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--accent-primary); display: flex; align-items: center; justify-content: center; font-size: 22px; font-weight: 700; color: white;">
                ${(user.username || 'U').charAt(0).toUpperCase()}
              </div>
              <div>
                <div style="font-size: 18px; font-weight: 600;">${UI.escapeHtml(user.username || 'User')}</div>
                <div style="font-size: 12px; color: var(--text-muted);">Administrator</div>
              </div>
            </div>
            <div class="settings-section">
              <div class="settings-row">
                <div>
                  <div class="settings-row-label">Username</div>
                  <div class="settings-row-desc">Your account username</div>
                </div>
                <span class="text-mono" style="font-size: 13px;">${UI.escapeHtml(user.username || '—')}</span>
              </div>
              <div class="settings-row">
                <div>
                  <div class="settings-row-label">Change Password</div>
                  <div class="settings-row-desc">Update your account password</div>
                </div>
                <button class="btn btn-secondary btn-sm" id="btnChangePassword">Change</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Server Info -->
        <div class="card">
          <div class="card-header"><div class="card-title">Server Information</div></div>
          <div class="card-body">
            <div class="settings-row">
              <div>
                <div class="settings-row-label">API Base URL</div>
                <div class="settings-row-desc">Backend API endpoint</div>
              </div>
              <span class="text-mono" style="font-size: 12px;">${window.location.origin}/api</span>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-row-label">WebSocket URL</div>
                <div class="settings-row-desc">Real-time connection endpoint</div>
              </div>
              <span class="text-mono" style="font-size: 12px;">${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws</span>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-row-label">Server Version</div>
                <div class="settings-row-desc">Backend software version</div>
              </div>
              <span id="serverVersion" class="text-mono" style="font-size: 12px;">Loading…</span>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-row-label">Uptime</div>
                <div class="settings-row-desc">Server process uptime</div>
              </div>
              <span id="serverUptime" class="text-mono" style="font-size: 12px;">—</span>
            </div>
          </div>
        </div>

        <!-- JWT Token -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">JWT Token</div>
            <button class="btn btn-secondary btn-sm" id="btnCopyToken">Copy</button>
          </div>
          <div class="card-body">
            <div class="form-hint" style="margin-bottom: 8px;">For debugging purposes. Do not share this token.</div>
            <div class="token-display" id="jwtTokenDisplay">${UI.escapeHtml(token || 'No token')}</div>
            <div style="margin-top: 12px; font-size: 11px; color: var(--text-muted);">
              Token expires: ${getTokenExpiry(token)}
            </div>
          </div>
        </div>

        <!-- Dashboard Preferences -->
        <div class="card">
          <div class="card-header"><div class="card-title">Dashboard Preferences</div></div>
          <div class="card-body">
            <div class="settings-row">
              <div>
                <div class="settings-row-label">Theme</div>
                <div class="settings-row-desc">Interface appearance (dark only for now)</div>
              </div>
              <span class="badge badge-muted">Dark</span>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-row-label">Auto-refresh</div>
                <div class="settings-row-desc">Automatically refresh page data every 30 seconds</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="toggleAutoRefresh" checked>
                <span class="toggle-slider"></span>
              </label>
            </div>
            <div class="settings-row">
              <div>
                <div class="settings-row-label">Sidebar collapsed</div>
                <div class="settings-row-desc">Start with sidebar in collapsed state</div>
              </div>
              <label class="toggle-switch">
                <input type="checkbox" id="toggleSidebarCollapsed" ${localStorage.getItem('mdm_sidebar_collapsed') === '1' ? 'checked' : ''}>
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="card mt-4" style="border-color: var(--danger);">
        <div class="card-header" style="border-bottom-color: var(--danger);">
          <div class="card-title" style="color: var(--danger);">Danger Zone</div>
        </div>
        <div class="card-body">
          <div class="settings-row">
            <div>
              <div class="settings-row-label">Logout</div>
              <div class="settings-row-desc">Sign out of this dashboard session</div>
            </div>
            <button class="btn btn-danger btn-sm" id="btnLogout">Logout</button>
          </div>
        </div>
      </div>
    `;

    // Bind actions
    document.getElementById('btnLogout')?.addEventListener('click', () => Auth.logout());
    document.getElementById('btnCopyToken')?.addEventListener('click', () => {
      navigator.clipboard.writeText(token || '').then(() => {
        UI.showToast('Token copied to clipboard', 'success');
      }).catch(() => {
        UI.showToast('Failed to copy token', 'error');
      });
    });
    document.getElementById('btnChangePassword')?.addEventListener('click', showChangePasswordModal);
    document.getElementById('toggleAutoRefresh')?.addEventListener('change', (e) => {
      App.state.autoRefresh = e.target.checked;
      if (e.target.checked) {
        // Restart auto refresh via app state
        UI.showToast('Auto-refresh enabled', 'info');
      } else {
        UI.showToast('Auto-refresh disabled', 'info');
      }
    });
    document.getElementById('toggleSidebarCollapsed')?.addEventListener('change', (e) => {
      localStorage.setItem('mdm_sidebar_collapsed', e.target.checked ? '1' : '0');
      const layout = document.getElementById('appLayout');
      if (layout) {
        layout.classList.toggle('sidebar-collapsed', e.target.checked);
      }
    });

    // Try to fetch server info
    try {
      const res = await fetch('/api/health', { headers: { 'Authorization': 'Bearer ' + token } });
      if (res.ok) {
        const data = await res.json();
        const verEl = document.getElementById('serverVersion');
        const upEl = document.getElementById('serverUptime');
        if (verEl) verEl.textContent = data.version || '1.0.0';
        if (upEl && data.uptime) upEl.textContent = UI.formatDuration(data.uptime);
      }
    } catch {
      // Health endpoint may not exist
    }
  }

  function getTokenExpiry(token) {
    if (!token) return '—';
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp) {
        return new Date(payload.exp * 1000).toLocaleString();
      }
    } catch {}
    return 'Unknown';
  }

  async function showChangePasswordModal() {
    const formHtml = `
      <div class="form-group">
        <label class="form-label">Current Password</label>
        <input class="form-input" type="password" id="currentPassword">
      </div>
      <div class="form-group">
        <label class="form-label">New Password</label>
        <input class="form-input" type="password" id="newPassword" minlength="6">
      </div>
      <div class="form-group">
        <label class="form-label">Confirm New Password</label>
        <input class="form-input" type="password" id="confirmPassword">
      </div>
    `;
    const result = await UI.showModal('Change Password', formHtml, {
      buttons: [
        { text: 'Cancel', class: 'btn-secondary', value: null },
        { text: 'Update Password', class: 'btn-primary', value: 'update' }
      ]
    });
    if (result !== 'update') return;

    const current = document.getElementById('currentPassword')?.value;
    const newPass = document.getElementById('newPassword')?.value;
    const confirm = document.getElementById('confirmPassword')?.value;

    if (newPass !== confirm) {
      UI.showToast('New passwords do not match', 'error');
      return;
    }
    if (newPass.length < 6) {
      UI.showToast('Password must be at least 6 characters', 'error');
      return;
    }

    try {
      await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + Auth.getToken() },
        body: JSON.stringify({ current_password: current, new_password: newPass })
      });
      UI.showToast('Password updated successfully', 'success');
    } catch (err) {
      UI.showToast('Failed to update password: ' + err.message, 'error');
    }
  }

  const module = { init };
  App.registerPage('settings', module);
})();
