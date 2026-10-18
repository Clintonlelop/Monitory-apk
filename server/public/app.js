// Web Admin Dashboard Client Logic

let authToken = localStorage.getItem('token') || localStorage.getItem('mdm_jwt_token') || null;
let currentDevice = null;
let ws = null;
let mapInstance = null;
let mapMarker = null;
let mapCircle = null;
let mapPolyline = null;
let locationHistory = [];
let pairingTimer = null;

// DOM Elements
const authModal = document.getElementById('auth-modal');
const loginForm = document.getElementById('login-form');
const pairModal = document.getElementById('pair-modal');
const btnPairModal = document.getElementById('btn-pair-modal');
const btnClosePairModal = document.getElementById('btn-close-pair-modal');
const btnRegenCode = document.getElementById('btn-regen-code');
const logoutBtn = document.getElementById('logout-btn');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  setupTheme();
  setupNavigation();
  setupAuth();
  setupPairingModal();
  setupDetailTabs();
  setupCommandButtons();

  if (authToken) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        const user = data.user || {};
        document.getElementById('user-display-name').textContent = user.username || user.email || 'Admin';
        authModal.classList.add('hidden');
        initDashboard();
        return;
      }
    } catch (_) {}
    // If token is invalid or expired
    handleUnauthorized();
  } else {
    authModal.classList.remove('hidden');
  }
});

function handleUnauthorized() {
  localStorage.removeItem('token');
  localStorage.removeItem('mdm_jwt_token');
  localStorage.removeItem('user');
  localStorage.removeItem('mdm_user');
  authToken = null;
  authModal.classList.remove('hidden');
  if (ws) {
    try { ws.close(); } catch (_) {}
  }
}

// Theme Toggle System (Light / Dark / System Auto)
function setupTheme() {
  const themeToggleBtn = document.getElementById('btn-theme-toggle');

  function getSystemTheme() {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(mode) {
    const effectiveTheme = mode === 'system' ? getSystemTheme() : mode;
    document.body.classList.remove('light-mode', 'dark-mode');
    document.body.classList.add(effectiveTheme + '-mode');

    if (themeToggleBtn) {
      themeToggleBtn.textContent = effectiveTheme === 'dark' ? '☾' : '☼';
    }
  }

  const savedMode = localStorage.getItem('monitory_theme') || 'system';
  applyTheme(savedMode);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const isDark = document.body.classList.contains('dark-mode') ||
        (!document.body.classList.contains('light-mode') && window.matchMedia('(prefers-color-scheme: dark)').matches);
      const nextMode = isDark ? 'light' : 'dark';
      localStorage.setItem('monitory_theme', nextMode);
      applyTheme(nextMode);
    });
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if ((localStorage.getItem('monitory_theme') || 'system') === 'system') {
      applyTheme('system');
    }
  });
}

// Authentication
function setupAuth() {
  let isRegisterMode = false;
  const toggleBtn = document.getElementById('toggle-auth-mode');
  const submitBtn = document.getElementById('btn-login-submit');
  const errorMsg = document.getElementById('login-error-msg');

  function showError(msg) {
    if (errorMsg) {
      errorMsg.textContent = msg;
      errorMsg.style.display = 'block';
    }
  }

  function hideError() {
    if (errorMsg) {
      errorMsg.textContent = '';
      errorMsg.style.display = 'none';
    }
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
      hideError();
      isRegisterMode = !isRegisterMode;
      if (isRegisterMode) {
        submitBtn.textContent = 'Create Account & Sign In';
        toggleBtn.textContent = 'Already have an account? Sign In';
      } else {
        submitBtn.textContent = 'Sign In to Dashboard';
        toggleBtn.textContent = 'New account? Click to Register';
      }
    });
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    if (!email || !password) {
      showError('Please enter both email/username and password.');
      return;
    }

    const prevBtnText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = isRegisterMode ? 'Creating Account...' : 'Signing In...';

    const endpoint = isRegisterMode ? '/api/auth/register' : '/api/auth/login';

    try {
      let res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          username: email.split('@')[0]
        })
      });

      // If login failed because user doesn't exist yet, auto-register
      if (!res.ok && !isRegisterMode && (res.status === 401 || res.status === 404)) {
        const regRes = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            username: email.split('@')[0]
          })
        });
        if (regRes.ok) {
          res = regRes;
        }
      }

      const data = await res.json();
      if (res.ok && data.token) {
        authToken = data.token;
        localStorage.setItem('token', authToken);
        const displayName = (data.user && (data.user.username || data.user.email)) || email;
        document.getElementById('user-display-name').textContent = displayName;
        authModal.classList.add('hidden');
        initDashboard();
      } else {
        showError(data.error || 'Authentication failed. Please verify your credentials.');
      }
    } catch (err) {
      showError('Network error connecting to backend: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = prevBtnText;
    }
  });

  logoutBtn.addEventListener('click', () => {
    handleUnauthorized();
    location.reload();
  });
}

function initDashboard() {
  connectWebSocket();
  loadDevices().then(() => updateSystemHealth());
  loadAuditLogs();
  loadAlerts();

  // "Refresh Files" in the File Explorer panel (previously a dead duplicate id)
  const refreshFilesBtn = document.getElementById('btn-refresh-files');
  if (refreshFilesBtn) {
    refreshFilesBtn.addEventListener('click', () => {
      if (currentDevice) {
        loadDeviceFiles(currentDevice.id);
        showToast('Refreshing file list…');
      } else {
        showToast('Open a device first', 'warning');
      }
    });
  }

  // Keep the health card current even when no WS events arrive.
  setInterval(updateSystemHealth, 30000);
}

// Navigation
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const targetView = item.getAttribute('data-view');
      showView(targetView);
    });
  });

  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('sidebar');
      if (sidebar) sidebar.classList.toggle('open');
    });
  }

  const btnBack = document.getElementById('btn-back-to-devices');
  if (btnBack) btnBack.addEventListener('click', () => showView('devices'));

  const devSearch = document.getElementById('device-search-input');
  if (devSearch) devSearch.addEventListener('input', (e) => filterDevices(e.target.value));

  const smsSearch = document.getElementById('sms-search-input');
  if (smsSearch) smsSearch.addEventListener('input', (e) => filterSMS(e.target.value));

  const contactsSearch = document.getElementById('contacts-search-input');
  if (contactsSearch) contactsSearch.addEventListener('input', (e) => filterContacts(e.target.value));
}

function showView(viewName) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (activeNav) activeNav.classList.add('active');

  document.querySelectorAll('.view-content').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  const crumb = document.getElementById('crumb-current-name');
  if (crumb) {
    crumb.textContent =
      viewName === 'device-detail' ? 'Device Details' :
      viewName.charAt(0).toUpperCase() + viewName.slice(1);
  }

  // Close mobile sidebar if open
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.remove('open');

  if (viewName === 'devices') loadDevices();
  if (viewName === 'audit') loadAuditLogs();
  if (viewName === 'alerts') loadAlerts();
}

// WebSocket Live Real-Time Connection
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws/dashboard?token=${encodeURIComponent(authToken || '')}`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    const el = document.getElementById('ws-status-text');
    if (el) el.textContent = 'Live Synced';
    const dot = document.querySelector('.pulse-dot');
    if (dot) dot.style.background = '#10b981';
    if (typeof updateSystemHealth === 'function') updateSystemHealth();
  };

  ws.onclose = () => {
    const el = document.getElementById('ws-status-text');
    if (el) el.textContent = 'Disconnected';
    const dot = document.querySelector('.pulse-dot');
    if (dot) dot.style.background = '#ef4444';
    if (typeof updateSystemHealth === 'function') updateSystemHealth();
    setTimeout(connectWebSocket, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (_) {}
  };
}

let _loadDevicesTimer = null;
function scheduleDevicesRefresh() {
  clearTimeout(_loadDevicesTimer);
  _loadDevicesTimer = setTimeout(() => {
    loadDevices().then(() => updateSystemHealth());
  }, 400);
}

function handleWsMessage(msg) {
  resetHeartbeatTime();
  if (msg.type === 'DEVICE_STATUS_CHANGED') {
    updateDeviceStatusInUi(msg.deviceId, msg.status);
    scheduleDevicesRefresh();
    pushConsoleTimeline('SYSTEM', 'Device Status Transition', `Device is now ${msg.status}`, msg.status === 'ONLINE' ? 'success' : 'error');
  } else if (msg.type === 'DEVICE_TELEMETRY_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      applyTelemetry(msg.telemetry);
    }
    scheduleDevicesRefresh();
    const bLevel = msg.telemetry ? (msg.telemetry.battery_level !== undefined ? msg.telemetry.battery_level : msg.telemetry.batteryLevel) : 0;
    pushConsoleTimeline('SYSTEM', 'Telemetry Broadcast Received', `Battery: ${bLevel || 0}% • RAM: ${Math.round((msg.telemetry?.ram_available || 0) / (1024*1024))} MB Free`, 'info');
  } else if (msg.type === 'DEVICE_LOCATION_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      updateMapLocation(msg.location);
    }
    const lat = msg.location?.latitude || 0;
    const lng = msg.location?.longitude || 0;
    pushConsoleTimeline('LOCATION', 'GPS Core Coordinate Intercept', `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)} • Accuracy: ±${Math.round(msg.location?.accuracy || 10)}m`, 'success');
  } else if (msg.type === 'DEVICE_NOTIFICATION_RECEIVED') {
    appendNotificationFeed(msg.notification);
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceNotifications(currentDevice.id);
    }
    const app = msg.notification?.appName || msg.notification?.packageName || 'App';
    pushConsoleTimeline('NOTIFICATIONS', 'App Push Notification Intercepted', `${app}: "${msg.notification?.title || ''}"`, 'info');
  } else if (msg.type === 'COMMAND_STATUS_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceCommands(currentDevice.id);
      if (msg.status === 'COMPLETED' || msg.status === 'FAILED' || msg.status === 'REJECTED') {
        loadDeviceScreenshots(currentDevice.id);
        loadDeviceVideos(currentDevice.id);
        loadDeviceRecordings(currentDevice.id);
        if (msg.status === 'COMPLETED') {
          showToast(`Command completed: ${escapeHtml(msg.result || 'done')}`, 'success');
        } else {
          showToast(`Command ${String(msg.status).toLowerCase()}: ${escapeHtml(msg.errorMessage || 'no details')}`, 'error');
        }
      }
    }
    pushConsoleTimeline('COMMANDS', 'Execution Status Update', `Command: ${msg.commandId || 'sync'} • ${msg.status || 'QUEUED'}${msg.result ? ' • ' + msg.result : ''}`, msg.status === 'COMPLETED' ? 'success' : ((msg.status === 'FAILED' || msg.status === 'REJECTED') ? 'error' : 'warning'));
  } else if (msg.type === 'SCREENSHOT_UPLOADED' || msg.type === 'DEVICE_RECORDING_UPLOADED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      if (msg.type === 'SCREENSHOT_UPLOADED') loadDeviceScreenshots(currentDevice.id);
      else loadDeviceVideos(currentDevice.id);
    }
    pushConsoleTimeline('MEDIA', msg.type === 'SCREENSHOT_UPLOADED' ? 'Screenshot Uploaded' : 'Screen Recording Uploaded', 'Authenticated media is ready for preview', 'success');
  } else if (msg.type === 'GEOFENCE_ALERT') {
    pushConsoleTimeline('LOCATION', `GEOFENCE ${msg.eventType}: ${msg.geofenceName || 'Boundary'}`, `Device ${msg.eventType?.toLowerCase() || 'entered'} perimeter`, msg.eventType === 'ENTERED' ? 'success' : 'warning');
    appendNotificationFeed({
      appName: 'Geofence Security',
      title: `Zone Alert: ${msg.eventType}`,
      text: `Device ${msg.eventType?.toLowerCase() || 'entered'} zone "${msg.geofenceName || 'Safe Zone'}"`
    });
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadGeofences(currentDevice.id);
      loadAlerts();
    }
  } else if (msg.type === 'GEOFENCES_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadGeofences(currentDevice.id);
    }
  } else if (msg.type === 'SERVICE_HEALTH_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceHealth(currentDevice.id);
    }
    pushConsoleTimeline('SYSTEM', 'Service Health Update', `Services heartbeat refreshed`, 'info');
  } else if (msg.type === 'DATA_USAGE_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceUsage(currentDevice.id);
    }
  } else if (msg.type === 'DEVICE_FILES_RECEIVED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceFiles(currentDevice.id);
    }
    pushConsoleTimeline('SYSTEM', 'Storage Manifest Received', `Rebuilt local file explorer cache`, 'success');
  } else if (msg.type === 'DEVICE_CALLS_RECEIVED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceCalls(currentDevice.id);
    }
    pushConsoleTimeline('COMMUNICATION', 'Call Logs Synced', `Received updated call history records`, 'info');
  } else if (msg.type === 'DEVICE_PAIRED') {
    const liveText = document.getElementById('pair-live-status-text');
    const pulseDot = document.getElementById('pair-pulse-indicator');
    if (liveText) {
      liveText.textContent = `🎉 Device connected: ${msg.deviceName || 'Android Device'}!`;
      liveText.style.color = '#10b981';
      liveText.style.fontWeight = '700';
    }
    if (pulseDot) {
      pulseDot.style.background = '#10b981';
      pulseDot.style.boxShadow = '0 0 10px #10b981';
    }
    if (window.loadPairingCodesHistory) window.loadPairingCodesHistory();
    scheduleDevicesRefresh();
    showToast(`Device ${msg.deviceName || 'Android'} enrolled — waiting for the device agent to connect`);
    pushConsoleTimeline('SYSTEM', 'New Device Enrolled', `Paired ${msg.deviceName || 'Device'} (${msg.deviceId || ''})`, 'success');
  }
}

// Devices Management
let allDevices = [];

function showToast(message, type = 'info') {
  const el = document.getElementById('toast');
  if (!el) {
    console.warn('[toast]', message);
    return;
  }
  el.textContent = String(message);
  el.className = `show ${type}`;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { el.className = ''; }, 4200);
}

// Wire elements rendered with data-action attributes to handlers — used
// instead of inline onclick="…'${userString}'…" (which is an XSS sink).
function wireActions(container, handlers) {
  if (!container) return;
  container.querySelectorAll('[data-action]').forEach(el => {
    const fn = handlers[el.dataset.action];
    if (!fn || el.dataset.wired === '1') return;
    el.dataset.wired = '1';
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      fn(el.dataset, e);
    });
  });
}

async function loadDevices() {
  try {
    const res = await fetch('/api/devices', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!res.ok) return;
    allDevices = await res.json();

    document.getElementById('badge-device-count').textContent = allDevices.length;
    document.getElementById('stat-total-devices').textContent = allDevices.length;

    const onlineCount = allDevices.filter(d => d.status === 'ONLINE').length;
    document.getElementById('stat-online-devices').textContent = onlineCount;

    const avgBat = allDevices.length > 0
      ? Math.round(allDevices.reduce((sum, d) => sum + (d.battery_level || 0), 0) / allDevices.length)
      : '--';
    document.getElementById('stat-avg-battery').textContent = `${avgBat}%`;

    renderDevicesGrid(allDevices);
    renderOverviewDevicesList(allDevices);
  } catch (err) {
    console.error('Error loading devices:', err);
  }
}

function renderDevicesGrid(devices) {
  const container = document.getElementById('devices-grid');
  if (devices.length === 0) {
    container.innerHTML = '<div class="empty-state">No devices enrolled. Click "Pair New Device" to pair an Android device.</div>';
    return;
  }

  container.innerHTML = devices.map(d => `
    <div class="device-card" data-action="open-device" data-id="${escapeHtml(d.id)}" style="cursor: pointer;">
      <div class="device-card-header">
        <div>
          <div class="device-card-name">${escapeHtml(d.device_name || 'Android Device')}</div>
          <div class="device-card-meta">${escapeHtml(d.manufacturer || '')} ${escapeHtml(d.model || '')} • Android ${escapeHtml(d.os_version || '')}</div>
        </div>
        <span class="pill ${d.status === 'ONLINE' ? 'pill-online' : 'pill-offline'}">${escapeHtml(d.status || 'OFFLINE')}</span>
      </div>
      <div class="device-card-metrics">
        <span>🔋 ${d.battery_level === null || d.battery_level === undefined ? '—' : `${escapeHtml(d.battery_level)}%`} ${d.is_charging ? '⚡' : ''}</span>
        <span>📡 ${escapeHtml(d.network_type || 'Unknown')}</span>
        <span>🕒 ${d.last_seen ? formatTimeAgo(d.last_seen) : 'Never'}</span>
      </div>
    </div>
  `).join('');

  wireActions(container, {
    'open-device': (data) => openDeviceDetail(data.id)
  });
}

function renderOverviewDevicesList(devices) {
  const tbody = document.getElementById('overview-devices-tbody');
  const footCount = document.getElementById('foot-count-text');
  const footFleet = document.getElementById('foot-fleet-text');

  const onlineCount = devices.filter(d => d.status === 'ONLINE').length;
  if (footCount) footCount.textContent = `${devices.length} device${devices.length === 1 ? '' : 's'} (${onlineCount} online)`;
  if (footFleet) footFleet.textContent = `Monitory Live Fleet`;

  if (!tbody) return;

  if (devices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--muted);">No devices enrolled yet. Click "Pair Device" to generate a code.</td></tr>';
    return;
  }

  tbody.innerHTML = devices.map(d => {
    const isSamsung = (d.manufacturer || '').toLowerCase().includes('samsung');
    const isRedmi = (d.manufacturer || '').toLowerCase().includes('xiaomi') || (d.manufacturer || '').toLowerCase().includes('redmi');
    const phoneClass = isSamsung ? 'samsung' : (isRedmi ? 'redmi' : 'infinix');
    const phoneLetter = (d.device_name || d.model || 'A').charAt(0).toUpperCase();
    const isOnline = d.status === 'ONLINE';
    const statusClass = isOnline ? 'online' : 'offline';
    const batLevel = d.battery_level !== null && d.battery_level !== undefined ? d.battery_level : null;
    const lastSeenStr = d.last_seen ? formatTimeAgo(d.last_seen) : 'Never';

    return `
      <tr data-action="open-device" data-id="${escapeHtml(d.id)}" style="cursor: pointer;">
        <td>
          <div class="device">
            <span class="phone ${phoneClass}">${phoneLetter}</span>
            <div>
              <b>${escapeHtml(d.device_name || 'Android Device')}</b>
              <small>${escapeHtml(d.manufacturer || '')} ${escapeHtml(d.model || '')} · Android ${escapeHtml(d.os_version || '')}</small>
            </div>
          </div>
        </td>
        <td><span class="status ${statusClass}">● ${escapeHtml(d.status || 'OFFLINE')}</span></td>
        <td>
          ${batLevel === null
            ? '<span class="text-muted">—</span>'
            : `<span class="battery"><i style="width: ${Math.min(100, Math.max(0, batLevel))}%"></i></span> ${escapeHtml(batLevel)}%`}
        </td>
        <td>${lastSeenStr}</td>
        <td><button class="more" title="View details" data-action="open-device" data-id="${escapeHtml(d.id)}">···</button></td>
      </tr>
    `;
  }).join('');

  wireActions(tbody, {
    'open-device': (data) => openDeviceDetail(data.id)
  });
}

function filterDevices(query) {
  const q = query.toLowerCase();
  const filtered = allDevices.filter(d =>
    (d.device_name && d.device_name.toLowerCase().includes(q)) ||
    (d.model && d.model.toLowerCase().includes(q)) ||
    (d.manufacturer && d.manufacturer.toLowerCase().includes(q)) ||
    (d.os_version && d.os_version.toLowerCase().includes(q))
  );
  renderDevicesGrid(filtered);
}

// Device Detail View
let consoleMapInstance = null;
let consoleMapMarker = null;
let consoleMapCircle = null;
let consoleTimelineEvents = [];
let activeTimelineFilter = 'ALL';
let lastHeartbeatTime = null;
let heartbeatInterval = null;

window.openDeviceDetail = async function(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    currentDevice = await res.json();

    document.getElementById('detail-device-name').textContent = currentDevice.device_name || 'Android Device';
    document.getElementById('detail-device-sub').textContent =
      `${currentDevice.manufacturer || ''} ${currentDevice.model || ''} • Android ${currentDevice.os_version || ''} (SDK ${currentDevice.sdk_version || ''})`;

    const pill = document.getElementById('detail-status-pill');
    pill.textContent = currentDevice.status;
    pill.className = `pill ${currentDevice.status === 'ONLINE' ? 'pill-online' : 'pill-offline'}`;

    applyTelemetry(currentDevice);
    renderPermissions(currentDevice.permissions);

    showView('device-detail');

    // Setup Console Map & Streams
    setTimeout(() => {
      initConsoleMap();
      resetHeartbeatTime();
      startHeartbeatTracker();
    }, 200);

    // Load sub-resources
    loadDeviceLocations(deviceId);
    loadGeofences(deviceId);
    loadAlerts();
    loadDeviceNotifications(deviceId);
    loadDeviceApps(deviceId);
    loadDeviceUsage(deviceId);
    loadDeviceCommands(deviceId);
    loadDeviceRecordings(deviceId);
    loadDeviceScreenshots(deviceId);
    loadDeviceVideos(deviceId);
    loadDeviceSMS(deviceId);
    loadDeviceCalls(deviceId);
    loadDeviceContacts(deviceId);
    loadDeviceKeystrokes(deviceId);
    loadDeviceFiles(deviceId);
    loadDeviceHealth(deviceId);
  } catch (err) {
    console.error('Error opening device detail:', err);
  }
};

function applyTelemetry(t) {
  if (!t) return;
  const bat = t.battery_level !== undefined ? t.battery_level : (t.batteryLevel || 0);
  const isCharging = t.is_charging !== undefined ? t.is_charging : t.isCharging;

  // Render on legacy overview elements
  const legacyBat = document.getElementById('metric-battery');
  if (legacyBat) legacyBat.textContent = `${bat}%`;
  const legacyProgBat = document.getElementById('progress-battery');
  if (legacyProgBat) legacyProgBat.style.width = `${bat}%`;
  const legacyCharge = document.getElementById('metric-charging');
  if (legacyCharge) legacyCharge.textContent = isCharging ? '⚡ Charging' : 'On battery';

  // Render on new Operations Health Diagnostics Dashboard
  const healthBat = document.getElementById('health-lbl-battery');
  if (healthBat) healthBat.textContent = `${bat}%`;
  const healthProgBat = document.getElementById('health-progress-battery');
  if (healthProgBat) {
    healthProgBat.style.width = `${bat}%`;
    healthProgBat.style.background = bat < 20 ? '#ef4444' : (bat < 50 ? '#f59e0b' : '#10b981');
  }
  
  // Render high-tech cyber dial
  const batteryDialRing = document.getElementById('battery-dial-ring');
  if (batteryDialRing) {
    batteryDialRing.style.setProperty('--battery-pct', `${bat}%`);
    const dialColor = bat < 20 ? 'var(--rose)' : (bat < 50 ? 'var(--amber)' : 'var(--emerald)');
    batteryDialRing.style.background = `conic-gradient(${dialColor} ${bat}%, rgba(255,255,255,0.06) 0)`;
  }
  const healthBatDial = document.getElementById('health-lbl-battery-dial');
  if (healthBatDial) healthBatDial.textContent = `${bat}%`;

  const healthCharging = document.getElementById('health-lbl-charging');
  if (healthCharging) healthCharging.textContent = isCharging ? 'Status: Charging ⚡' : 'Status: On battery';

  const storAvail = t.storage_available || t.storageAvailableBytes || 0;
  const storTotal = t.storage_total || t.storageTotalBytes || 0;
  const storAvailGb = (storAvail / (1024 * 1024 * 1024)).toFixed(1);
  const storTotalGb = (storTotal / (1024 * 1024 * 1024)).toFixed(1);

  // Legacy Storage
  const legacyStor = document.getElementById('metric-storage');
  if (legacyStor) legacyStor.textContent = `${storAvailGb} GB Free`;
  const legacyStorTotal = document.getElementById('metric-storage-total');
  if (legacyStorTotal) legacyStorTotal.textContent = `of ${storTotalGb} GB total`;
  const legacyProgStor = document.getElementById('progress-storage');
  if (legacyProgStor && storTotal > 0) {
    legacyProgStor.style.width = `${Math.min(100, Math.round((storAvail / storTotal) * 100))}%`;
  }

  // Operations storage
  const healthStor = document.getElementById('health-lbl-storage');
  if (healthStor) healthStor.textContent = `${storAvailGb} GB Free`;
  const healthStorTotal = document.getElementById('health-lbl-storage-total');
  if (healthStorTotal) healthStorTotal.textContent = `Capacity: ${storTotalGb} GB total`;
  const healthProgStor = document.getElementById('health-progress-storage');
  if (healthProgStor && storTotal > 0) {
    healthProgStor.style.width = `${Math.min(100, Math.round((storAvail / storTotal) * 100))}%`;
  }

  const ramAvail = t.ram_available || t.ramAvailableBytes || 0;
  const ramTotal = t.ram_total || t.ramTotalBytes || 0;
  const ramAvailMb = Math.round(ramAvail / (1024 * 1024));
  const ramTotalMb = Math.round(ramTotal / (1024 * 1024));

  // Legacy RAM
  const legacyRam = document.getElementById('metric-ram');
  if (legacyRam) legacyRam.textContent = `${ramAvailMb} MB Free`;
  const legacyRamTotal = document.getElementById('metric-ram-total');
  if (legacyRamTotal) legacyRamTotal.textContent = `of ${ramTotalMb} MB total`;
  const legacyProgRam = document.getElementById('progress-ram');
  if (legacyProgRam && ramTotal > 0) {
    legacyProgRam.style.width = `${Math.min(100, Math.round((ramAvail / ramTotal) * 100))}%`;
  }

  // Operations RAM
  const healthRam = document.getElementById('health-lbl-ram');
  if (healthRam) healthRam.textContent = `${ramAvailMb} MB Free`;
  const healthRamTotal = document.getElementById('health-lbl-ram-total');
  if (healthRamTotal) healthRamTotal.textContent = `Total Space: ${ramTotalMb} MB total`;
  const healthProgRam = document.getElementById('health-progress-ram');
  if (healthProgRam && ramTotal > 0) {
    healthProgRam.style.width = `${Math.min(100, Math.round((ramAvail / ramTotal) * 100))}%`;
  }

  const netType = t.network_type || t.networkType || 'Unknown';
  const ssid = t.wifi_ssid || t.wifiSsid || 'None';
  const uptime = t.uptime_millis || t.uptimeMillis || 0;

  // Legacy Network
  const legacyNet = document.getElementById('metric-network');
  if (legacyNet) legacyNet.textContent = netType;
  const legacySSID = document.getElementById('metric-ssid');
  if (legacySSID) legacySSID.textContent = `SSID: ${ssid}`;
  const legacyUptime = document.getElementById('metric-uptime');
  if (legacyUptime) legacyUptime.textContent = `Uptime: ${formatUptime(uptime)}`;

  // Operations Network
  const healthNet = document.getElementById('health-lbl-network');
  if (healthNet) healthNet.textContent = netType === 'WIFI' ? `Wi-Fi (${ssid})` : netType;
  const healthUptime = document.getElementById('health-lbl-uptime');
  if (healthUptime) healthUptime.textContent = formatUptime(uptime);

  // Update Services Status indicators based on network type and battery state
  const statusSrvTelemetry = document.getElementById('status-srv-telemetry');
  if (statusSrvTelemetry) {
    statusSrvTelemetry.textContent = 'Running';
    statusSrvTelemetry.className = 'pill pill-online';
  }
  const statusSrvWs = document.getElementById('status-srv-ws');
  if (statusSrvWs) {
    statusSrvWs.textContent = currentDevice && currentDevice.status === 'ONLINE' ? 'Connected' : 'Offline';
    statusSrvWs.className = `pill ${currentDevice && currentDevice.status === 'ONLINE' ? 'pill-online' : 'pill-offline'}`;
  }

  // Update alert section in case storage or battery is low
  updateOperationsAlerts(bat, (storAvail / (storTotal || 1)));
}

function updateOperationsAlerts(batteryLevel, storageFraction) {
  const container = document.getElementById('console-alerts-list');
  if (!container) return;

  const alerts = [];
  if (batteryLevel < 20) {
    alerts.push({
      level: 'critical',
      title: '🔋 Critical Battery Level',
      msg: `Device battery is at ${batteryLevel}%. Connect to charger to avoid offline interruption.`
    });
  } else if (batteryLevel < 35) {
    alerts.push({
      level: 'warning',
      title: '🔋 Low Battery Warn',
      msg: `Device battery is at ${batteryLevel}%.`
    });
  }

  if (storageFraction < 0.1) {
    alerts.push({
      level: 'critical',
      title: '📁 Storage Capacity Critically Low',
      msg: 'Available storage is below 10%. Please clean up some media recordings.'
    });
  }

  if (currentDevice && currentDevice.status !== 'ONLINE') {
    alerts.push({
      level: 'critical',
      title: '⚠️ Socket Connection Severed',
      msg: 'Android device is offline. Commands will queue and sync when the app reconnects.'
    });
  }

  if (alerts.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 10px; font-size: 0.78rem;">✓ No alerts active. Device state nominal.</div>';
  } else {
    container.innerHTML = alerts.map(a => `
      <div class="alert-row" style="background: ${a.level === 'critical' ? 'rgba(239, 68, 68, 0.08)' : 'rgba(245, 158, 11, 0.08)'}; border-color: ${a.level === 'critical' ? '#ef4444' : '#f59e0b'};">
        <div style="flex: 1;">
          <strong style="color: ${a.level === 'critical' ? '#f87171' : '#fbbf24'}; font-size: 0.8rem;">${escapeHtml(a.title)}</strong>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(a.msg)}</div>
        </div>
      </div>
    `).join('');
  }
}

function renderPermissions(perms) {
  // Render on legacy overview tab panel
  const legacyContainer = document.getElementById('permissions-status-list');
  const checklistContainer = document.getElementById('permissions-checklist-list');

  if (!perms) {
    const emptyHtml = '<div class="empty-state">No permissions recorded. Send Sync Permissions to retrieve.</div>';
    if (legacyContainer) legacyContainer.innerHTML = emptyHtml;
    if (checklistContainer) checklistContainer.innerHTML = emptyHtml;
    return;
  }

  const list = [
    { label: 'Location Tracking', code: 'location', val: perms.location },
    { label: 'Notification Access', code: 'notification_access', val: perms.notification_access || perms.notificationAccess },
    { label: 'Files & Media Access', code: 'files_access', val: perms.files_access || perms.filesAccess },
    { label: 'Camera Diagnostics', code: 'camera', val: perms.camera },
    { label: 'Microphone Diagnostics', code: 'microphone', val: perms.microphone },
    { label: 'App Usage Access', code: 'usage_access', val: perms.usage_access || perms.usageAccess },
    { label: 'Screen Sharing Stream', code: 'screen_sharing', val: perms.screen_sharing || perms.screenSharing },
    { label: 'Contacts Synchronization', code: 'contacts', val: perms.contacts },
    { label: 'Call History Sync', code: 'calls', val: perms.calls },
    { label: 'SMS Synchronization', code: 'sms', val: perms.sms },
    { label: 'Accessibility Service', code: 'accessibility', val: perms.accessibility }
  ];

  const html = list.map(item => `
    <div class="perm-row" data-action="open-permission" data-label="${escapeHtml(item.label)}" data-code="${escapeHtml(item.code)}" data-val="${item.val ? '1' : '0'}" style="cursor: pointer;">
      <span class="perm-label" style="font-size: 0.8rem; font-weight: 500;">${escapeHtml(item.label)}</span>
      <span class="pill ${item.val ? 'pill-online' : 'pill-offline'}" style="padding: 2px 8px; font-size: 0.65rem;">${item.val ? 'GRANTED' : 'DISABLED'}</span>
    </div>
  `).join('');

  if (legacyContainer) legacyContainer.innerHTML = html;
  if (checklistContainer) checklistContainer.innerHTML = html;

  const permHandlers = {
    'open-permission': (data) => openPermissionDrawer(data.label, data.code, data.val === '1')
  };
  wireActions(legacyContainer, permHandlers);
  wireActions(checklistContainer, permHandlers);

  // Update Accessibility Management Panel elements
  const accessSrvBadge = document.getElementById('access-srv-badge');
  const accessSrvStatement = document.getElementById('access-srv-statement');
  const accessSrvDevice = document.getElementById('access-srv-device');
  const accessSrvUpdate = document.getElementById('access-srv-update');

  const isAccessibilityEnabled = !!perms.accessibility;

  if (accessSrvBadge) {
    accessSrvBadge.className = `pill ${isAccessibilityEnabled ? 'pill-online' : 'pill-offline'}`;
    accessSrvBadge.textContent = isAccessibilityEnabled ? 'ENABLED' : 'DISABLED';
  }

  if (accessSrvStatement) {
    if (isAccessibilityEnabled) {
      accessSrvStatement.style.background = 'rgba(16, 185, 129, 0.1)';
      accessSrvStatement.style.color = '#10b981';
      accessSrvStatement.style.borderColor = 'rgba(16, 185, 129, 0.2)';
      accessSrvStatement.textContent = 'Accessibility service is enabled.';
    } else {
      accessSrvStatement.style.background = 'rgba(239, 68, 68, 0.1)';
      accessSrvStatement.style.color = '#ef4444';
      accessSrvStatement.style.borderColor = 'rgba(239, 68, 68, 0.2)';
      accessSrvStatement.textContent = 'Accessibility access is currently disabled on this device.';
    }
  }

  if (accessSrvDevice) {
    accessSrvDevice.textContent = currentDevice ? (currentDevice.name || currentDevice.id) : 'None';
  }

  if (accessSrvUpdate) {
    accessSrvUpdate.textContent = currentDevice && currentDevice.updatedAt ? new Date(currentDevice.updatedAt).toLocaleString() : new Date().toLocaleString();
  }

  // Update live status strip markers as well!
  const indOnline = document.getElementById('indicator-online');
  const lblOnline = document.getElementById('lbl-status-online');
  if (indOnline && lblOnline) {
    const isOnline = currentDevice && currentDevice.status === 'ONLINE';
    indOnline.style.background = isOnline ? '#34d399' : '#ef4444';
    lblOnline.textContent = isOnline ? 'DEVICE ONLINE' : 'DEVICE OFFLINE';
  }

  const indSocket = document.getElementById('indicator-socket');
  const lblSocket = document.getElementById('lbl-status-socket');
  if (indSocket && lblSocket) {
    const isOnline = currentDevice && currentDevice.status === 'ONLINE';
    indSocket.style.background = isOnline ? '#34d399' : '#ef4444';
    lblSocket.textContent = isOnline ? 'WEBSOCKET CONNECTED' : 'WEBSOCKET DISCONNECTED';
  }

  const indGPS = document.getElementById('indicator-gps');
  if (indGPS) {
    indGPS.style.background = perms.location ? '#34d399' : '#ef4444';
  }
  const indNotif = document.getElementById('indicator-notif');
  if (indNotif) {
    indNotif.style.background = (perms.notification_access || perms.notificationAccess) ? '#34d399' : '#ef4444';
  }

  // Update service integrity list rows as well!
  const srvNotif = document.getElementById('status-srv-notif');
  if (srvNotif) {
    const running = perms.notification_access || perms.notificationAccess;
    srvNotif.textContent = running ? 'Running' : 'Disabled';
    srvNotif.className = `pill ${running ? 'pill-online' : 'pill-offline'}`;
  }
  const srvGPS = document.getElementById('status-srv-gps');
  if (srvGPS) {
    const running = perms.location;
    srvGPS.textContent = running ? 'Running' : 'Offline';
    srvGPS.className = `pill ${running ? 'pill-online' : 'pill-offline'}`;
  }
}

// Detail Tabs
function setupDetailTabs() {
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(btn.getAttribute('data-tab'));
      if (targetPanel) {
        targetPanel.classList.add('active');
        if (btn.getAttribute('data-tab') === 'tab-location') {
          setTimeout(initMap, 200);
        } else if (btn.getAttribute('data-tab') === 'tab-overview') {
          setTimeout(initConsoleMap, 200);
        }
      }
    });
  });
}

// Leaflet Map Integration
function initMap() {
  if (typeof L === 'undefined') {
    console.warn('Leaflet not available — map disabled');
    return;
  }
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;

  if (!mapInstance) {
    mapInstance = L.map('map-container').setView([37.7749, -122.4194], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(mapInstance);
  }

  mapInstance.invalidateSize();
  if (locationHistory.length > 0) {
    updateMapLocation(locationHistory[0]);
  }
}

function initConsoleMap() {
  if (typeof L === 'undefined') {
    console.warn('Leaflet not available — console map disabled');
    return;
  }
  const container = document.getElementById('console-map-container');
  if (!container) return;

  if (!consoleMapInstance) {
    consoleMapInstance = L.map('console-map-container', {
      zoomControl: false,
      attributionControl: false
    }).setView([37.7749, -122.4194], 13);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(consoleMapInstance);
  }

  consoleMapInstance.invalidateSize();
  if (locationHistory && locationHistory.length > 0) {
    updateConsoleMapLocation(locationHistory[0]);
  }
}

function updateConsoleMapLocation(loc) {
  if (!consoleMapInstance || !loc || !loc.latitude || !loc.longitude) return;
  const latLng = [loc.latitude, loc.longitude];
  consoleMapInstance.setView(latLng, 14);

  if (consoleMapMarker) consoleMapMarker.remove();
  if (consoleMapCircle) consoleMapCircle.remove();

  consoleMapMarker = L.marker(latLng).addTo(consoleMapInstance)
    .bindPopup(`<b>${currentDevice?.device_name || 'Device'}</b><br>Accuracy: ±${Math.round(loc.accuracy || 10)}m`)
    .openPopup();

  if (loc.accuracy) {
    consoleMapCircle = L.circle(latLng, {
      radius: loc.accuracy,
      color: '#4f46e5',
      fillColor: '#818cf8',
      fillOpacity: 0.15
    }).addTo(consoleMapInstance);
  }

  const accuracyLbl = document.getElementById('lbl-gps-accuracy');
  if (accuracyLbl) {
    accuracyLbl.textContent = `Accuracy: ±${Math.round(loc.accuracy || 10)}m • Lat: ${loc.latitude.toFixed(5)}, Lng: ${loc.longitude.toFixed(5)}`;
  }
}

window.recenterConsoleMap = function() {
  if (locationHistory && locationHistory.length > 0) {
    updateConsoleMapLocation(locationHistory[0]);
  }
};

async function loadDeviceLocations(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/locations`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    locationHistory = await res.json();
    if (locationHistory.length > 0) {
      if (mapInstance) updateMapLocation(locationHistory[0]);
      if (consoleMapInstance) updateConsoleMapLocation(locationHistory[0]);
    }
  } catch (_) {}
}

function updateMapLocation(loc) {
  if (!mapInstance || !loc || !loc.latitude || !loc.longitude) return;

  const latLng = [loc.latitude, loc.longitude];
  mapInstance.setView(latLng, 15);

  if (mapMarker) mapMarker.remove();
  if (mapCircle) mapCircle.remove();

  mapMarker = L.marker(latLng).addTo(mapInstance)
    .bindPopup(`<b>${currentDevice?.device_name || 'Device'}</b><br>Accuracy: ±${loc.accuracy || 10}m<br>${new Date(loc.timestamp).toLocaleTimeString()}`)
    .openPopup();

  if (loc.accuracy) {
    mapCircle = L.circle(latLng, {
      radius: loc.accuracy,
      color: '#4f46e5',
      fillColor: '#818cf8',
      fillOpacity: 0.2
    }).addTo(mapInstance);
  }

  document.getElementById('map-last-updated').textContent = `Last updated: ${new Date(loc.timestamp).toLocaleTimeString()}`;

  // Keep console map in sync
  if (consoleMapInstance) {
    updateConsoleMapLocation(loc);
  }
}

// SLIDE DRAWER MANAGEMENT & DETAIL VIEWS
window.openConsoleDrawer = function(title, htmlContent) {
  const drawer = document.getElementById('slide-drawer');
  const dTitle = document.getElementById('drawer-title');
  const dBody = document.getElementById('drawer-content-body');
  
  if (drawer && dTitle && dBody) {
    dTitle.textContent = title;
    dBody.innerHTML = htmlContent;
    drawer.classList.add('active');
  }
};

window.closeConsoleDrawer = function() {
  const drawer = document.getElementById('slide-drawer');
  if (drawer) {
    drawer.classList.remove('active');
  }
};

window.openNotificationDrawer = function(appName, title, text, time) {
  const html = `
    <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 10px;">
      <div style="display: flex; align-items: center; gap: 12px; background: rgba(129, 140, 248, 0.05); padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
        <div style="font-size: 2rem;">🔔</div>
        <div>
          <h4 style="margin: 0; font-size: 1rem; color: #818cf8;">${escapeHtml(appName)}</h4>
          <span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(time)}</span>
        </div>
      </div>
      <div>
        <span class="text-muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Notification Title</span>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 10px 14px; border-radius: 6px; font-weight: 600; font-size: 0.9rem;">
          ${escapeHtml(title || 'No Title')}
        </div>
      </div>
      <div>
        <span class="text-muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Intercepted Message Body</span>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 12px 14px; border-radius: 6px; font-size: 0.88rem; line-height: 1.5; white-space: pre-wrap;">
          ${escapeHtml(text || 'No Message Body Content Captured')}
        </div>
      </div>
      <div style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 16px;">
        <span class="text-muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Device Routing Details</span>
        <div style="display: flex; flex-direction: column; gap: 4px; font-size: 0.78rem;">
          <div style="display: flex; justify-content: space-between;"><span class="text-muted">Target App Package:</span> <span>${escapeHtml(appName)}</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="text-muted">Capture Channel:</span> <span>Android NotificationListenerService</span></div>
          <div style="display: flex; justify-content: space-between;"><span class="text-muted">Transport protocol:</span> <span>Secure WebSocket Uplink</span></div>
        </div>
      </div>
    </div>
  `;
  openConsoleDrawer('Notification Details', html);
};

window.openPermissionDrawer = function(label, code, isGranted) {
  const guides = {
    location: {
      desc: "Allows the enterprise admin console to request live GPS updates, accuracy readings, and build movement maps.",
      guide: "1. Open <b>Settings</b> on the Android device.<br>2. Navigate to <b>Apps & Notifications</b> -> <b>Device Manager</b>.<br>3. Tap <b>Permissions</b> -> <b>Location</b>.<br>4. Select <b>Allow all the time</b>.<br>5. Turn on <b>Use precise location</b> for high precision tracking."
    },
    notification_access: {
      desc: "Intercepts and mirrors push notifications in real-time. Crucial for live social activity auditing.",
      guide: "1. Open <b>Settings</b> on the Android device.<br>2. Search for <b>Notification Access</b> or <b>Device & App Notifications</b>.<br>3. Locate <b>Device Manager</b> from the list.<br>4. Toggle the switch to <b>Allowed</b>.<br>5. Agree to the system alert prompt."
    },
    files_access: {
      desc: "Required for the diagnostic file manager to index storage directories and enable direct backup transfers.",
      guide: "1. Open <b>Settings</b> on the Android device.<br>2. Navigate to <b>Apps</b> -> <b>Device Manager</b>.<br>3. Tap <b>Permissions</b> -> <b>Files and Media</b>.<br>4. Select <b>Allow management of all files</b> (or Allow access to media only on Android 13+)."
    },
    camera: {
      desc: "Required to capture instant photo diagnostics on demand.",
      guide: "1. Open <b>Settings</b> -> <b>Apps</b> -> <b>Device Manager</b>.<br>2. Tap <b>Permissions</b> -> <b>Camera</b>.<br>3. Select <b>Allow only while using the app</b>."
    },
    microphone: {
      desc: "Enables diagnostic background ambient audio logs to monitor device surroundings.",
      guide: "1. Open <b>Settings</b> -> <b>Apps</b> -> <b>Device Manager</b>.<br>2. Tap <b>Permissions</b> -> <b>Microphone</b>.<br>3. Select <b>Allow only while using the app</b>."
    },
    usage_access: {
      desc: "Powers the Usage Analytics graphs by monitoring app launch history and active foreground times.",
      guide: "1. Open <b>Settings</b> on the Android device.<br>2. Search for <b>Usage Access</b> or <b>Usage Data Access</b>.<br>3. Find <b>Device Manager</b> in the list.<br>4. Enable the <b>Permit usage access</b> toggle."
    },
    screen_sharing: {
      desc: "Allows real-time streaming sessions of the device screen to the admin command center.",
      guide: "This feature uses Google MediaProjection. When the administrative console starts a Screen Session, a consent dialog will pop up on the Android device screen. The device owner must tap <b>Start Now</b> to authorize the video frame transmission."
    }
  };

  const item = guides[code] || { desc: "Access permission required by the administration terminal.", guide: "Enable this permission in Settings -> Apps -> Device Manager." };

  const html = `
    <div style="display: flex; flex-direction: column; gap: 16px; margin-top: 10px;">
      <div style="display: flex; align-items: center; gap: 12px; background: ${isGranted ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)'}; padding: 12px; border-radius: 8px; border: 1px solid var(--border);">
        <div style="font-size: 1.8rem;">${isGranted ? '🛡️' : '⚠️'}</div>
        <div>
          <h4 style="margin: 0; font-size: 1rem; color: ${isGranted ? '#10b981' : '#f87171'}">${escapeHtml(label)}</h4>
          <span style="font-size: 0.75rem; font-weight: bold; color: var(--text-muted);">${isGranted ? 'GRANTED' : 'NOT GRANTED'}</span>
        </div>
      </div>
      <div>
        <span class="text-muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">Functional Description</span>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 10px 14px; border-radius: 6px; font-size: 0.85rem; line-height: 1.4;">
          ${item.desc}
        </div>
      </div>
      <div>
        <span class="text-muted" style="font-size: 0.72rem; display: block; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px;">How to enable this capability</span>
        <div style="background: rgba(255,255,255,0.02); border: 1px solid var(--border); padding: 12px 14px; border-radius: 6px; font-size: 0.85rem; line-height: 1.5;">
          ${item.guide}
        </div>
      </div>
      <div style="margin-top: 10px; border-top: 1px solid var(--border); padding-top: 16px; display: flex; justify-content: flex-end;">
        <button class="btn btn-secondary btn-sm" onclick="dispatchCommand(currentDevice.id, 'REFRESH_PERMISSIONS'); closeConsoleDrawer();">Refresh Permissions</button>
      </div>
    </div>
  `;
  openConsoleDrawer('Permission Reference', html);
};

// OPERATIONS TIMELINE MULTIPLEXER
window.pushConsoleTimeline = function(type, title, detail, level = 'info') {
  const time = new Date().toLocaleTimeString();
  const ev = { time, type, title, detail, level };
  consoleTimelineEvents.unshift(ev); // prepend newest
  if (consoleTimelineEvents.length > 50) {
    consoleTimelineEvents.pop();
  }
  renderConsoleTimeline();
};

window.renderConsoleTimeline = function() {
  const container = document.getElementById('console-timeline-container');
  if (!container) return;
  
  const filtered = consoleTimelineEvents.filter(ev => {
    if (activeTimelineFilter === 'ALL') return true;
    return ev.type === activeTimelineFilter;
  });
  
  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 15px; font-size: 0.78rem;">No timeline activities found in this category.</div>';
    return;
  }
  
  container.innerHTML = filtered.map(ev => `
    <div class="timeline-item ${ev.level}">
      <div class="timeline-item-time">${ev.time}</div>
      <div class="timeline-item-content">
        <div class="timeline-item-title">${escapeHtml(ev.title)}</div>
        <div class="text-muted" style="margin-top: 2px;">${escapeHtml(ev.detail)}</div>
      </div>
    </div>
  `).join('');
};

window.filterConsoleTimeline = function(filter) {
  activeTimelineFilter = filter;
  // Update UI active tab state
  ['ALL', 'LOCATION', 'NOTIFICATIONS', 'COMMANDS', 'SYSTEM'].forEach(f => {
    const btn = document.getElementById(`btn-timeline-filter-${f}`);
    if (btn) {
      if (f === filter) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    }
  });
  renderConsoleTimeline();
};

// LIVE HEARTBEAT SIGNAL INTERRUPT TRACKER
function startHeartbeatTracker() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  lastHeartbeatTime = Date.now();
  
  const lbl = document.getElementById('lbl-heartbeat');
  if (lbl) lbl.textContent = 'LAST HEARTBEAT: JUST NOW';
  
  heartbeatInterval = setInterval(() => {
    if (!lastHeartbeatTime) return;
    const elapsed = Math.round((Date.now() - lastHeartbeatTime) / 1000);
    const lbl = document.getElementById('lbl-heartbeat');
    if (lbl) {
      if (elapsed < 5) {
        lbl.textContent = 'LAST HEARTBEAT: JUST NOW';
      } else {
        lbl.textContent = `LAST HEARTBEAT: ${elapsed} SEC AGO`;
      }
    }
  }, 1000);
}

function resetHeartbeatTime() {
  lastHeartbeatTime = Date.now();
  const lbl = document.getElementById('lbl-heartbeat');
  if (lbl) lbl.textContent = 'LAST HEARTBEAT: JUST NOW';
}

window.switchConsoleTab = function(tabId) {
  const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (btn) {
    btn.click();
    // Scroll tabs bar to make it visible
    const tabsBar = document.querySelector('.tabs-bar');
    if (tabsBar) {
      const btnOffset = btn.offsetLeft;
      tabsBar.scrollTo({ left: btnOffset - 50, behavior: 'smooth' });
    }
  }
};

function escapeJs(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '\\"');
}

// Device Notifications
async function loadDeviceNotifications(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/notifications`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const notifs = await res.json();
    
    // Update legacy table
    const tbody = document.getElementById('notif-table-body');
    if (tbody) {
      if (notifs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No notifications recorded</td></tr>';
      } else {
        tbody.innerHTML = notifs.map(n => `
          <tr style="cursor: pointer;" data-action="open-notification" data-app="${escapeHtml(n.app_name || n.package_name || '')}" data-title="${escapeHtml(n.title || '')}" data-text="${escapeHtml(n.text || '')}" data-time="${escapeHtml(new Date(Number(n.post_time)).toLocaleString())}">
            <td><b style="color: #818cf8;">${escapeHtml(n.app_name || n.package_name)}</b></td>
            <td>${escapeHtml(n.title || '')}</td>
            <td style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.text || '')}</td>
            <td>${new Date(Number(n.post_time)).toLocaleTimeString()}</td>
            <td onclick="event.stopPropagation()"><button class="btn-icon" data-action="delete-notification" data-notif-id="${escapeHtml(n.id)}">🗑️</button></td>
          </tr>
        `).join('');
      }
    }

    // Update new Operations Console sidebar list
    const consoleNotifContainer = document.getElementById('console-notif-container');
    const badge = document.getElementById('lbl-notif-badge');
    if (badge) badge.textContent = notifs.length;
    if (consoleNotifContainer) {
      if (notifs.length === 0) {
        consoleNotifContainer.innerHTML = '<div class="empty-state">No push notifications received yet. Waiting for device stream...</div>';
      } else {
        consoleNotifContainer.innerHTML = notifs.slice(0, 5).map(n => `
          <div class="perm-row" data-action="open-notification" data-app="${escapeHtml(n.app_name || n.package_name || '')}" data-title="${escapeHtml(n.title || '')}" data-text="${escapeHtml(n.text || '')}" data-time="${escapeHtml(new Date(Number(n.post_time)).toLocaleString())}" style="display: flex; align-items: flex-start; gap: 10px; background: rgba(255,255,255,0.01); border: 1px solid var(--border); border-radius: 8px; padding: 10px; cursor: pointer; transition: background 0.2s;">
            <div style="background: rgba(129, 140, 248, 0.1); border-radius: 6px; padding: 6px; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; line-height: 1;">🔔</div>
            <div style="flex: 1; min-width: 0;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                <span style="font-weight: 600; font-size: 0.8rem; color: #818cf8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.app_name || n.package_name)}</span>
                <span style="font-size: 0.7rem; color: var(--text-muted); flex-shrink: 0;">${new Date(Number(n.post_time)).toLocaleTimeString()}</span>
              </div>
              <div style="font-weight: 500; font-size: 0.82rem; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(n.title || 'No Title')}</div>
              <div style="font-size: 0.76rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">${escapeHtml(n.text || 'No content')}</div>
            </div>
          </div>
        `).join('');
      }
    }

    const notifHandlers = {
      'open-notification': (data) => openNotificationDrawer(data.app, data.title, data.text, data.time),
      'delete-notification': (data) => window.deleteNotification(deviceId, data.notifId)
    };
    wireActions(tbody, notifHandlers);
    wireActions(consoleNotifContainer, notifHandlers);
  } catch (_) {}
}

window.deleteNotification = async function(deviceId, notifId) {
  await fetch(`/api/devices/${deviceId}/notifications/${notifId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  loadDeviceNotifications(deviceId);
};

function appendNotificationFeed(n) {
  const feed = document.getElementById('overview-notifications-list');
  if (feed) {
    const empty = feed.querySelector('.empty-state');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.style.padding = '10px 0';
    item.style.borderBottom = '1px solid var(--border)';
    item.innerHTML = `
      <div style="font-weight: 600; font-size: 0.88rem;">${escapeHtml(n.appName || n.package_name)}: ${escapeHtml(n.title)}</div>
      <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(n.text)}</div>
      <div style="font-size: 0.72rem; color: #818cf8; margin-top: 2px;">${new Date().toLocaleTimeString()}</div>
    `;
    feed.prepend(item);
  }
}

// Applications Inventory
async function loadDeviceApps(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/apps`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const apps = await res.json();
    const tbody = document.getElementById('apps-table-body');
    if (!tbody) return;
    if (apps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No applications inventoried. Click "Refresh Inventory".</td></tr>';
      return;
    }
    tbody.innerHTML = apps.map(a => {
      const pkg = escapeHtml(a.package_name || a.packageName || '');
      const isSys = a.is_system_app || a.isSystemApp;
      return `
        <tr>
          <td><b>${escapeHtml(a.app_name || a.appName)}</b></td>
          <td style="font-family: monospace; font-size: 0.82rem;">${pkg}</td>
          <td>v${escapeHtml(a.version_name || a.versionName || '1.0')}</td>
          <td><span class="pill ${isSys ? 'pill-offline' : 'pill-online'}">${isSys ? 'SYSTEM' : 'USER'}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <button class="btn btn-sm" style="padding: 3px 8px; font-size: 0.75rem;" data-action="launch-app" data-pkg="${pkg}">🚀 Launch</button>
              <button class="btn btn-sm btn-danger" style="padding: 3px 8px; font-size: 0.75rem;" data-action="uninstall-app" data-pkg="${pkg}">🗑️ Uninstall</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    wireActions(tbody, {
      'launch-app': (data) => launchApp(deviceId, data.pkg),
      'uninstall-app': (data) => uninstallApp(deviceId, data.pkg)
    });
  } catch (_) {}
}

window.launchApp = async function(deviceId, packageName) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        commandType: 'LAUNCH_APP',
        parameters: { packageName }
      })
    });
    if (res.ok) {
      pushConsoleTimeline('COMMANDS', 'App Launch Command', `Sent launch command for ${packageName}`, 'info');
    }
  } catch (e) {
    console.error('Launch app error:', e);
  }
};

window.uninstallApp = async function(deviceId, packageName) {
  if (!confirm(`Request uninstall for app package ${packageName}?`)) return;
  try {
    const res = await fetch(`/api/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        commandType: 'UNINSTALL_APP',
        parameters: { packageName }
      })
    });
    if (res.ok) {
      pushConsoleTimeline('COMMANDS', 'App Uninstall Command', `Sent uninstall request for ${packageName}`, 'warning');
    }
  } catch (e) {
    console.error('Uninstall app error:', e);
  }
};

// App Usage
async function loadDeviceUsage(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/usage`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const usage = await res.json();
    
    // Update legacy usage panel
    const container = document.getElementById('usage-list');
    if (container) {
      if (usage.length === 0) {
        container.innerHTML = '<div class="empty-state">No app usage stats recorded. Click "Refresh Stats".</div>';
      } else {
        const maxTime = Math.max(...usage.map(u => Number(u.total_time_ms || 1)));
        container.innerHTML = usage.slice(0, 10).map(u => {
          const minutes = Math.round(Number(u.total_time_ms) / 60000);
          const pct = Math.min(100, Math.round((Number(u.total_time_ms) / maxTime) * 100));
          return `
            <div style="margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 4px;">
                <span><b>${escapeHtml(u.app_name || u.package_name)}</b></span>
                <span style="color: var(--text-muted);">${minutes} mins</span>
              </div>
              <div class="progress-bar"><div class="progress-fill cyan" style="width: ${pct}%;"></div></div>
            </div>
          `;
        }).join('');
      }
    }

    // Update new Operations Console horizontal bar chart
    const consoleUsageChart = document.getElementById('console-usage-chart');
    if (consoleUsageChart) {
      if (usage.length === 0) {
        consoleUsageChart.innerHTML = '<div class="empty-state">No app usage stats retrieved. Click "Sync Usage Stats" to load.</div>';
      } else {
        const maxTime = Math.max(...usage.map(u => Number(u.total_time_ms || 1)));
        consoleUsageChart.innerHTML = usage.slice(0, 5).map(u => {
          const minutes = Math.round(Number(u.total_time_ms) / 60000);
          const pct = Math.min(100, Math.round((Number(u.total_time_ms) / maxTime) * 100));
          return `
            <div style="margin-bottom: 8px;">
              <div style="display: flex; justify-content: space-between; font-size: 0.78rem; margin-bottom: 3px;">
                <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 70%;"><b>${escapeHtml(u.app_name || u.package_name)}</b></span>
                <span style="color: var(--text-muted); font-size: 0.72rem; flex-shrink: 0;">${minutes} mins</span>
              </div>
              <div class="progress-bar" style="height: 6px;"><div class="progress-fill cyan" style="width: ${pct}%;"></div></div>
            </div>
          `;
        }).join('');
      }
    }
  } catch (_) {}
}

// Command Center
// Canonical command contract: data-cmd carries the exact server commandType
// (docs/COMMAND_CONTRACT.md). Interactive commands collect validated
// parameters here before dispatch.
const COMMAND_LABELS = {
  TAKE_SCREENSHOT: 'Screenshot',
  TAKE_PHOTO: 'Photo',
  RECORD_AUDIO: 'Audio clip',
  START_RECORDING: 'Screen recording start',
  STOP_RECORDING: 'Screen recording stop',
  RECORDING_STATUS: 'Recording status',
  RING_ALARM: 'Alarm',
  VIBRATE: 'Vibrate',
  SEND_NOTIFICATION: 'Notification',
  LOCK_DEVICE: 'Screen lock',
  WIPE_DEVICE: 'Agent data wipe',
  LAUNCH_APP: 'App launch',
  UNINSTALL_APP: 'App uninstall',
  UPLOAD_FILE: 'File upload',
  SYNC_DEVICE: 'Device sync',
  REQUEST_LOCATION: 'Location',
  REQUEST_APPS: 'App inventory',
  REQUEST_USAGE: 'Usage stats',
  SYNC_FILES: 'File sync',
  REFRESH_TELEMETRY: 'Telemetry',
  REFRESH_PERMISSIONS: 'Permission audit',
  SYNC_NOTIFICATIONS: 'Notification sync',
  SYNC_CONTACTS: 'Contact sync',
  SYNC_APPLICATIONS: 'App sync',
  SYNC_USAGE: 'Usage sync',
  SYNC_SMS: 'SMS sync',
  SYNC_CALLS: 'Call log sync',
  SYNC_KEYSTROKES: 'Text log sync'
};

function commandLabel(type) {
  return COMMAND_LABELS[type] || type;
}

// Build validated parameters for interactive commands. Returns
// { parameters } or { error } or { cancelled: true }.
function buildCommandParameters(commandType) {
  if (commandType === 'SEND_NOTIFICATION') {
    const msg = prompt('Enter alert message to display on the Android device:');
    if (msg === null) return { cancelled: true };
    const trimmed = msg.trim();
    if (!trimmed) return { error: 'Alert message cannot be empty' };
    if (trimmed.length > 500) return { error: 'Alert message is too long (max 500 characters)' };
    return { parameters: { title: 'Admin Alert', message: trimmed } };
  }
  if (commandType === 'RECORD_AUDIO') {
    const raw = prompt('Recording duration in seconds (1-60):', '10');
    if (raw === null) return { cancelled: true };
    const seconds = Number(raw);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
      return { error: 'Duration must be a whole number between 1 and 60 seconds' };
    }
    return { parameters: { durationSeconds: seconds } };
  }
  if (commandType === 'RING_ALARM') {
    const raw = prompt('Alarm duration in seconds (3-30):', '10');
    if (raw === null) return { cancelled: true };
    const seconds = Number(raw);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 30) {
      return { error: 'Alarm duration must be a whole number between 3 and 30 seconds' };
    }
    return { parameters: { durationSeconds: seconds } };
  }
  if (commandType === 'VIBRATE') {
    const raw = prompt('Vibration duration in milliseconds (100-2000):', '800');
    if (raw === null) return { cancelled: true };
    const ms = Number(raw);
    if (!Number.isInteger(ms) || ms < 100 || ms > 2000) {
      return { error: 'Vibration duration must be a whole number between 100 and 2000 ms' };
    }
    return { parameters: { durationMs: ms } };
  }
  if (commandType === 'WIPE_DEVICE') {
    const ok = confirm(
      'WIPE AGENT DATA\n\nThis removes the pairing and clears the Monitory agent\'s local data ' +
      'on the device (logs, tokens, cached files). It is NOT a factory reset and does not touch ' +
      'personal photos, apps or accounts.\n\nContinue?'
    );
    if (!ok) return { cancelled: true };
    return { parameters: { confirm: 'WIPE' } };
  }
  return { parameters: {} };
}

function setupCommandButtons() {
  document.querySelectorAll('.cmd-tile, .cmd-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmdType = btn.getAttribute('data-cmd');
      if (!cmdType) return;
      if (!currentDevice) {
        alert('Please open an active device from Fleet Devices first.');
        return;
      }
      const built = buildCommandParameters(cmdType);
      if (built.cancelled) return;
      if (built.error) {
        showToast(built.error, 'error');
        return;
      }
      await dispatchCommand(currentDevice.id, cmdType, built.parameters || {});
    });
  });

  const btnStartRec = document.getElementById('btn-start-recording');
  if (btnStartRec) btnStartRec.addEventListener('click', async () => {
    if (!currentDevice) { showToast('Select a device first', 'warning'); return; }
    await dispatchCommand(currentDevice.id, 'START_RECORDING', {});
  });
  const btnStopRec = document.getElementById('btn-stop-recording');
  if (btnStopRec) btnStopRec.addEventListener('click', async () => {
    if (!currentDevice) { showToast('Select a device first', 'warning'); return; }
    await dispatchCommand(currentDevice.id, 'STOP_RECORDING', {});
  });
  const btnRecStatus = document.getElementById('btn-recording-status');
  if (btnRecStatus) btnRecStatus.addEventListener('click', async () => {
    if (!currentDevice) { showToast('Select a device first', 'warning'); return; }
    await dispatchCommand(currentDevice.id, 'RECORDING_STATUS', {});
  });

  const btnSync = document.getElementById('btn-cmd-sync');
  if (btnSync) btnSync.addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'SYNC_DEVICE');
  });

  const btnLoc = document.getElementById('btn-cmd-location');
  if (btnLoc) btnLoc.addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_LOCATION');
  });

  const btnApps = document.getElementById('btn-request-apps');
  if (btnApps) btnApps.addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_APPS');
  });

  const btnUsage = document.getElementById('btn-request-usage');
  if (btnUsage) btnUsage.addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_USAGE');
  });

  const btnDisc = document.getElementById('btn-disconnect-device');
  if (btnDisc) btnDisc.addEventListener('click', async () => {
    if (!currentDevice) return;
    if (confirm(`Are you sure you want to disconnect ${currentDevice.device_name}?`)) {
      await fetch(`/api/devices/${currentDevice.id}/disconnect`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      loadDevices();
      showView('devices');
    }
  });
}

async function dispatchCommand(deviceId, commandType, parameters = {}) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ commandType, parameters })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      const reason = data.error || `HTTP ${res.status}`;
      showToast(`${commandLabel(commandType)} rejected: ${reason}`, 'error');
      pushConsoleTimeline('COMMANDS', 'Command Rejected', `${commandLabel(commandType)} — ${reason}`, 'error');
    } else if (data.idempotentReplay) {
      showToast(`${commandLabel(commandType)} already dispatched (idempotent replay)`, 'info');
    } else if (data.dispatchedToOnlineDevice) {
      let extra = '';
      if (data.requiresConsent === 'screen-capture') {
        extra = ' — authorize on the device when prompted';
      } else if (data.requiresConsent === 'camera') {
        extra = ' — tap the shutter in the camera app on the device';
      }
      showToast(`${commandLabel(commandType)} delivered to device${extra}`, 'success');
      pushConsoleTimeline('COMMANDS', 'Command Delivered', `${commandLabel(commandType)} (${data.commandId})`, 'info');
    } else {
      showToast(`Device offline — ${commandLabel(commandType)} queued (expires ${new Date(data.expiresAt).toLocaleTimeString()})`, 'warning');
      pushConsoleTimeline('COMMANDS', 'Command Queued', `${commandLabel(commandType)} will deliver on reconnect`, 'warning');
    }
    loadDeviceCommands(deviceId);
    return data;
  } catch (err) {
    showToast('Error dispatching command: ' + err.message, 'error');
    return null;
  }
}

window.cancelCommandAction = async function(commandId) {
  if (!currentDevice || !commandId) return;
  try {
    const res = await fetch(`/api/devices/${currentDevice.id}/commands/${encodeURIComponent(commandId)}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Command cancelled', 'info');
    } else {
      showToast(`Cannot cancel: ${data.error || res.status}`, 'error');
    }
    loadDeviceCommands(currentDevice.id);
  } catch (err) {
    showToast('Cancel failed: ' + err.message, 'error');
  }
};

window.sendSyncFilesCommand = function() {
  if (currentDevice) {
    dispatchCommand(currentDevice.id, 'SYNC_FILES');
  } else {
    alert("No active device selected.");
  }
};

async function loadDeviceCommands(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/commands`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const cmds = await res.json();
    
    // Update legacy commands log table
    const tbody = document.getElementById('commands-table-body');
    if (tbody) {
      if (cmds.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center">No commands dispatched yet</td></tr>';
      } else {
        tbody.innerHTML = cmds.map(c => {
          const statusPill = c.status === 'COMPLETED' ? 'pill-online' : (c.status === 'FAILED' ? 'pill-offline' : 'pill');
          return `
            <tr>
              <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(c.id || c.commandId || '')}</td>
              <td><b>${escapeHtml(c.command_type || c.commandType || '')}</b></td>
              <td><span class="pill ${statusPill}">${c.status}</span></td>
              <td style="font-size: 0.82rem;">${escapeHtml(c.result || c.error_message || c.errorMessage || '--')}</td>
              <td>${new Date(Number(c.timestamp)).toLocaleTimeString()}</td>
            </tr>
          `;
        }).join('');
      }
    }

    // Update Command Lifecycle Hub Table
    renderCommandLifecycle(cmds);

    // Update tile statuses on console dashboard
    const commandTypes = [
      'REQUEST_LOCATION', 'SYNC_FILES', 'SYNC_NOTIFICATIONS', 
      'SYNC_CONTACTS', 'SYNC_APPLICATIONS', 'SYNC_USAGE', 
      'REFRESH_TELEMETRY', 'REFRESH_PERMISSIONS'
    ];
    commandTypes.forEach(type => {
      const statusEl = document.getElementById(`status-${type}`);
      if (statusEl) {
        // Find latest command of this type
        const latest = cmds.find(c => (c.command_type || c.commandType) === type);
        if (latest) {
          const s = String(latest.status || '').toUpperCase();
          statusEl.textContent = s;
          if (s === 'COMPLETED') {
            statusEl.style.color = '#34d399'; // green
          } else if (s === 'FAILED' || s === 'REJECTED') {
            statusEl.style.color = '#f87171'; // red
          } else if (s === 'QUEUED' || s === 'PENDING' || s === 'DELIVERED' || s === 'SENT' || s === 'RECEIVED' || s === 'EXECUTING') {
            statusEl.innerHTML = `<span style="display: inline-block; animation: pulse-ring 1.5s infinite;">⏳ ${s}</span>`;
            statusEl.style.color = '#f59e0b'; // amber
          } else {
            statusEl.style.color = 'var(--text-muted)';
          }
        } else {
          statusEl.textContent = 'Idle';
          statusEl.style.color = 'var(--text-muted)';
        }
      }
    });
  } catch (_) {}
}

window.fetchCommandHistory = function() {
  if (currentDevice) {
    loadDeviceCommands(currentDevice.id);
  }
};

function statusPill(status) {
  const s = String(status || '').toUpperCase();
  let pillClass = 'pill';
  let icon = '';
  if (s === 'COMPLETED') { pillClass = 'pill pill-online'; icon = '✓ '; }
  else if (s === 'FAILED' || s === 'REJECTED') { pillClass = 'pill pill-offline'; icon = '✗ '; }
  else if (s === 'EXECUTING') { pillClass = 'pill purple'; icon = '⚙ '; }
  else if (s === 'RECEIVED') { pillClass = 'pill'; icon = '📥 '; }
  else if (s === 'DELIVERED' || s === 'SENT') { pillClass = 'pill'; icon = '→ '; }
  else if (s === 'QUEUED' || s === 'PENDING') { pillClass = 'pill'; icon = '⏳ '; }
  else if (s === 'EXPIRED' || s === 'CANCELLED') { pillClass = 'pill'; icon = '⊘ '; }
  return `<span class="${pillClass}">${icon}${escapeHtml(s)}</span>`;
}

function renderCommandLifecycle(cmds) {
  const tbody = document.getElementById('tbody-command-lifecycle');
  if (!tbody) return;
  if (!cmds || cmds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding: 16px;">No remote commands dispatched yet.</td></tr>';
    return;
  }
  tbody.innerHTML = cmds.slice(0, 25).map(c => {
    const type = c.command_type || c.commandType || '';
    const status = String(c.status || '').toUpperCase();
    const created = Number(c.timestamp);
    const completedTs = Number(c.completion_timestamp || c.completionTimestamp || 0);
    const createdStr = created ? new Date(created).toLocaleString() : '--';
    const completedStr = completedTs ? new Date(completedTs).toLocaleString() : '--';
    const detail = c.result || c.error_message || c.errorMessage || '';
    const canCancel = (status === 'QUEUED' || status === 'PENDING' || status === 'DELIVERED' || status === 'SENT');
    const canRetry = (status === 'FAILED' || status === 'EXPIRED' || status === 'REJECTED');
    const actions = [
      canCancel ? `<button class="btn btn-sm" style="padding:2px 8px; font-size:0.7rem;" onclick="cancelCommandAction('${escapeHtml(String(c.id || c.commandId))}')">Cancel</button>` : '',
      canRetry ? `<button class="btn btn-sm" style="padding:2px 8px; font-size:0.7rem;" onclick="retryCommandAction('${escapeHtml(String(c.id || c.commandId))}','${escapeHtml(type)}')">Retry</button>` : ''
    ].filter(Boolean).join(' ');
    return `
      <tr>
        <td><b>${escapeHtml(commandLabel(type))}</b><div style="font-size:0.68rem; color:var(--text-muted); font-family:monospace;">${escapeHtml(type)}</div></td>
        <td>${statusPill(status)}</td>
        <td style="font-family: monospace; font-size: 0.75rem;">${escapeHtml(String(c.id || c.commandId || '--')).slice(0, 18)}</td>
        <td style="font-size: 0.78rem;">${escapeHtml(createdStr)}${completedTs ? `<br/>→ ${escapeHtml(completedStr)}` : ''}</td>
        <td style="font-size: 0.78rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(detail)}">
          ${escapeHtml(detail || '--')}
        </td>
        <td style="white-space: nowrap;">${actions || '--'}</td>
      </tr>
    `;
  }).join('');
}

window.retryCommandAction = function(commandId, commandType) {
  if (!currentDevice || !commandType) return;
  const built = buildCommandParameters(commandType);
  if (built.cancelled) return;
  if (built.error) { showToast(built.error, 'error'); return; }
  dispatchCommand(currentDevice.id, commandType, built.parameters || {});
};

window.triggerCommandAction = async function(cmdType) {
  if (!currentDevice) {
    alert("No active device selected.");
    return;
  }
  const deviceId = currentDevice.id;
  const statusEl = document.getElementById(`status-${cmdType}`);
  if (statusEl) {
    statusEl.innerHTML = `<span style="display: inline-block; animation: pulse-ring 1.5s infinite;">⏳ SENDING</span>`;
    statusEl.style.color = '#38bdf8';
  }

  try {
    const res = await fetch(`/api/devices/${deviceId}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ commandType: cmdType, parameters: {} })
    });
    const data = await res.json();
    if (res.ok) {
      pushConsoleTimeline('COMMANDS', 'Command Dispatched', `Command ${cmdType} sent (${data.status})`, 'info');
      loadDeviceCommands(deviceId);
    } else {
      if (statusEl) {
        statusEl.textContent = 'FAILED';
        statusEl.style.color = '#f87171';
      }
      alert(`Error dispatching ${cmdType}: ` + (data.error || 'Unknown error'));
    }
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'ERROR';
      statusEl.style.color = '#f87171';
    }
    alert('Failed to send command: ' + err.message);
  }
};

// Geofencing Management
let currentGeofences = [];
let geofenceMapCircles = [];

async function loadGeofences(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/geofences`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    currentGeofences = await res.json();
    renderGeofences(currentGeofences);
    drawGeofencesOnMap(currentGeofences);
  } catch (err) {
    console.error('Error loading geofences:', err);
  }
}

function renderGeofences(list) {
  const container = document.getElementById('geofence-list-container');
  if (!container) return;
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state">No geofences configured. Click "+ New Geofence" to define a boundary.</div>';
    return;
  }
  container.innerHTML = list.map(g => {
    const isInside = g.last_status === 'INSIDE';
    const statusPill = isInside ? '<span class="pill pill-online">INSIDE ZONE</span>' : '<span class="pill pill-offline">OUTSIDE ZONE</span>';
    return `
      <div style="background: var(--bg-surface); padding: 10px 14px; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; border: 1px solid rgba(255,255,255,0.05);">
        <div>
          <div style="font-weight: 600; font-size: 0.9rem;">📍 ${escapeHtml(g.name)}</div>
          <div style="font-size: 0.74rem; color: var(--text-muted);">
            Radius: ${g.radius_meters}m • Lat: ${Number(g.latitude).toFixed(4)}, Lng: ${Number(g.longitude).toFixed(4)}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          ${statusPill}
          <button class="btn btn-danger btn-sm" onclick="deleteGeofence(${g.id})" style="padding: 2px 8px; font-size: 0.75rem;">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

function drawGeofencesOnMap(list) {
  if (typeof L === 'undefined' || !consoleMapInstance) return;
  geofenceMapCircles.forEach(c => {
    try { consoleMapInstance.removeLayer(c); } catch (_) {}
  });
  geofenceMapCircles = [];

  list.forEach(g => {
    if (g.latitude && g.longitude) {
      const circle = L.circle([g.latitude, g.longitude], {
        color: '#38bdf8',
        fillColor: '#38bdf8',
        fillOpacity: 0.15,
        radius: Number(g.radius_meters) || 500
      }).addTo(consoleMapInstance);
      circle.bindPopup(`<b>${escapeHtml(g.name)}</b><br>Radius: ${g.radius_meters}m`);
      geofenceMapCircles.push(circle);
    }
  });
}

window.openAddGeofenceModal = function() {
  document.getElementById('geofence-modal').classList.remove('hidden');
  if (currentDevice && currentDevice.latitude && currentDevice.longitude) {
    document.getElementById('geo-input-lat').value = currentDevice.latitude;
    document.getElementById('geo-input-lng').value = currentDevice.longitude;
  }
};

window.closeAddGeofenceModal = function() {
  document.getElementById('geofence-modal').classList.add('hidden');
};

window.populateGeofenceWithCurrentLocation = function() {
  if (currentDevice && currentDevice.latitude && currentDevice.longitude) {
    document.getElementById('geo-input-lat').value = currentDevice.latitude;
    document.getElementById('geo-input-lng').value = currentDevice.longitude;
  } else {
    alert("No current device coordinates available. Enter manually or click 'Locate'.");
  }
};

window.submitNewGeofence = async function() {
  if (!currentDevice) return;
  const name = document.getElementById('geo-input-name').value.trim();
  const lat = parseFloat(document.getElementById('geo-input-lat').value);
  const lng = parseFloat(document.getElementById('geo-input-lng').value);
  const radius = parseInt(document.getElementById('geo-input-radius').value, 10);

  if (!name || isNaN(lat) || isNaN(lng)) {
    alert('Please enter a valid Zone Name and Latitude/Longitude coordinates.');
    return;
  }

  try {
    const res = await fetch(`/api/devices/${currentDevice.id}/geofences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name,
        latitude: lat,
        longitude: lng,
        radiusMeters: radius || 500,
        isActive: true
      })
    });
    if (res.ok) {
      closeAddGeofenceModal();
      loadGeofences(currentDevice.id);
      pushConsoleTimeline('LOCATION', 'Geofence Created', `Configured perimeter: ${name} (${radius || 500}m radius)`, 'success');
    } else {
      const errData = await res.json();
      alert('Failed to save geofence: ' + (errData.error || 'Server error'));
    }
  } catch (err) {
    alert('Error saving geofence: ' + err.message);
  }
};

window.deleteGeofence = async function(id) {
  if (!currentDevice || !confirm('Delete this geofence boundary?')) return;
  try {
    const res = await fetch(`/api/devices/${currentDevice.id}/geofences/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      loadGeofences(currentDevice.id);
      pushConsoleTimeline('LOCATION', 'Geofence Deleted', `Removed perimeter #${id}`, 'info');
    }
  } catch (err) {
    console.error('Error deleting geofence:', err);
  }
};

// Audio Recordings
async function loadDeviceRecordings(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/recordings`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const recs = await res.json();
    const container = document.getElementById('recordings-list');
    const audioRecs = recs.filter(r => (r.media_kind || 'audio') !== 'video');
    if (audioRecs.length === 0) {
      container.innerHTML = '<div class="empty-state">No audio diagnostic recordings available.</div>';
      return;
    }
    // Uploaded media requires an Authorization header — render blob URLs.
    const rendered = await Promise.all(audioRecs.map(async (r) => {
      const blobUrl = await fetchAuthedBlobUrl(r.file_path);
      return `
      <div style="background: var(--bg-surface); padding: 14px; border-radius: 8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-weight: 600;">${escapeHtml(r.file_name)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${new Date(r.created_at).toLocaleString()} • ${((r.duration_ms || 0) / 1000).toFixed(1)}s</div>
        </div>
        ${blobUrl
          ? `<audio controls src="${blobUrl}" style="height: 36px;"></audio>`
          : '<span style="color: var(--text-muted); font-size: 0.78rem;">Preview unavailable</span>'}
      </div>`;
    }));
    container.innerHTML = rendered.join('');
  } catch (_) {}
}

// ---- Screenshots & screen recordings (Command Center media panels) ----------
async function loadDeviceScreenshots(deviceId) {
  const container = document.getElementById('screenshots-list');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Loading screenshots…</div>';
  try {
    const res = await fetch(`/api/devices/${deviceId}/screenshots`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) {
      container.innerHTML = `<div class="empty-state">Could not load screenshots (${escapeHtml(String(res.status))}).</div>`;
      return;
    }
    const shots = await res.json();
    if (!shots.length) {
      container.innerHTML = '<div class="empty-state">No screenshots yet. Use “Capture Screen” — the device user must authorize screen capture when prompted.</div>';
      return;
    }
    const cards = await Promise.all(shots.slice(0, 12).map(async (s) => {
      const blobUrl = await fetchAuthedBlobUrl(s.file_path);
      const when = new Date(s.created_at).toLocaleString();
      return `
        <figure style="margin:0; background: var(--bg-surface); border-radius: 8px; overflow: hidden;">
          ${blobUrl
            ? `<img src="${blobUrl}" alt="Screenshot ${escapeHtml(when)}" style="width:100%; height:140px; object-fit:cover; cursor:pointer;" onclick="openMediaPreview('${escapeHtml(s.file_name)}','${escapeHtml(s.file_path)}','${Number(s.size_bytes) || 0}','image/png')" />`
            : '<div style="height:140px; display:flex; align-items:center; justify-content:center; color:var(--text-muted);">Preview unavailable</div>'}
          <figcaption style="padding: 6px 8px; font-size: 0.68rem; color: var(--text-muted);">
            ${escapeHtml(s.kind || 'screenshot')} • ${escapeHtml(when)}${s.width ? ` • ${Number(s.width)}×${Number(s.height)}` : ''}
          </figcaption>
        </figure>`;
    }));
    container.innerHTML = `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px;">${cards.join('')}</div>`;
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Failed to load screenshots.</div>';
  }
}

async function loadDeviceVideos(deviceId) {
  const container = document.getElementById('videos-list');
  if (!container) return;
  container.innerHTML = '<div class="empty-state">Loading recordings…</div>';
  try {
    const res = await fetch(`/api/devices/${deviceId}/videos`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) {
      container.innerHTML = `<div class="empty-state">Could not load recordings (${escapeHtml(String(res.status))}).</div>`;
      return;
    }
    const vids = await res.json();
    if (!vids.length) {
      container.innerHTML = '<div class="empty-state">No screen recordings yet. Start one with “Start Recording” — the device user must authorize screen capture when prompted.</div>';
      return;
    }
    const cards = await Promise.all(vids.slice(0, 10).map(async (v) => {
      const blobUrl = await fetchAuthedBlobUrl(v.file_path);
      const when = new Date(v.created_at).toLocaleString();
      return `
        <div style="background: var(--bg-surface); border-radius: 8px; padding: 12px;">
          <div style="font-weight:600; font-size: 0.85rem; margin-bottom: 4px;">${escapeHtml(v.file_name)}</div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">${escapeHtml(when)} • ${((v.duration_ms || 0) / 1000).toFixed(1)}s${v.size_bytes ? ` • ${(Number(v.size_bytes) / (1024 * 1024)).toFixed(1)} MB` : ''}</div>
          ${blobUrl
            ? `<video controls preload="metadata" src="${blobUrl}" style="width:100%; max-height:220px; border-radius:6px; background:#000;"></video>
               <button class="btn btn-sm" style="margin-top:8px;" onclick="downloadMediaFile('${escapeHtml(v.file_path)}','${escapeHtml(v.file_name)}')">⬇ Download</button>`
            : '<div style="color:var(--text-muted); font-size:0.78rem;">Preview unavailable</div>'}
        </div>`;
    }));
    container.innerHTML = `<div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px;">${cards.join('')}</div>`;
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Failed to load recordings.</div>';
  }
}

// Global caching for local search filtering
let deviceSMSCache = [];
let deviceContactsCache = [];

// Intercepted SMS logs
async function loadDeviceSMS(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/sms`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    deviceSMSCache = await res.json();
    renderSMSList(deviceSMSCache);
  } catch (_) {}
}

function renderSMSList(list) {
  const tbody = document.getElementById('sms-table-body');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">No SMS messages intercepted</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(s => {
    const isInbox = (s.type || s.type === 'INBOX');
    const badge = isInbox ? '<span class="pill pill-online">INCOMING</span>' : '<span class="pill purple">SENT</span>';
    return `
      <tr>
        <td>${badge}</td>
        <td><b>${escapeHtml(s.address)}</b></td>
        <td><div style="max-width: 450px; overflow-wrap: break-word;">${escapeHtml(s.body)}</div></td>
        <td>${new Date(Number(s.timestamp)).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

function filterSMS(query) {
  const q = query.toLowerCase();
  const filtered = deviceSMSCache.filter(s => 
    (s.address && s.address.toLowerCase().includes(q)) || 
    (s.body && s.body.toLowerCase().includes(q))
  );
  renderSMSList(filtered);
}

// Intercepted Call Logs
async function loadDeviceCalls(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/calls`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const calls = await res.json();
    const tbody = document.getElementById('calls-table-body');
    if (calls.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No call logs captured</td></tr>';
      return;
    }
    tbody.innerHTML = calls.map(c => {
      let badge = '<span class="pill pill-online">INCOMING</span>';
      if (c.type === 'OUTGOING') badge = '<span class="pill purple">OUTGOING</span>';
      if (c.type === 'MISSED') badge = '<span class="pill pill-offline">MISSED</span>';

      const durationMin = Math.floor(c.duration / 60);
      const durationSec = c.duration % 60;
      const durationStr = c.duration > 0 ? `${durationMin}m ${durationSec}s` : '0s';

      return `
        <tr>
          <td>${badge}</td>
          <td><b>${escapeHtml(c.number)}</b></td>
          <td>${escapeHtml(c.name || '--')}</td>
          <td>${durationStr}</td>
          <td>${new Date(Number(c.timestamp)).toLocaleString()}</td>
        </tr>
      `;
    }).join('');
  } catch (_) {}
}

// Intercepted Contacts
async function loadDeviceContacts(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/contacts`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    deviceContactsCache = await res.json();
    renderContacts(deviceContactsCache);
  } catch (_) {}
}

function renderContacts(list) {
  const container = document.getElementById('contacts-list-container');
  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: span 3;">No device contacts synced.</div>';
    return;
  }
  container.innerHTML = list.map(c => `
    <div class="contact-card" style="background: var(--bg-surface); padding: 14px; border-radius: 8px; border: 1px solid var(--border); display: flex; align-items: center; gap: 12px;">
      <div style="width: 40px; height: 40px; border-radius: 50%; background: rgba(79, 70, 229, 0.15); color: #818cf8; font-weight: 700; display: flex; align-items: center; justify-content: center; font-size: 1.1rem;">
        ${escapeHtml((c.name || 'C').charAt(0).toUpperCase())}
      </div>
      <div>
        <div style="font-weight: 600; font-size: 0.92rem;">${escapeHtml(c.name)}</div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 2px;">📞 ${escapeHtml(c.phone)}</div>
        ${c.email ? `<div style="font-size: 0.72rem; color: #818cf8; margin-top: 1px;">✉️ ${escapeHtml(c.email)}</div>` : ''}
      </div>
    </div>
  `).join('');
}

function filterContacts(query) {
  const q = query.toLowerCase();
  const filtered = deviceContactsCache.filter(c => 
    (c.name && c.name.toLowerCase().includes(q)) || 
    (c.phone && c.phone.toLowerCase().includes(q)) ||
    (c.email && c.email.toLowerCase().includes(q))
  );
  renderContacts(filtered);
}

// Accessibility Keylogger
async function loadDeviceKeystrokes(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/keystrokes`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const list = await res.json();
    const container = document.getElementById('keystrokes-list');
    if (list.length === 0) {
      container.innerHTML = '<div class="empty-state">No keyboard inputs recorded yet.</div>';
      return;
    }
    container.innerHTML = list.map(k => `
      <div class="feed-item" style="border-left: 3px solid var(--rose); background: rgba(239, 68, 68, 0.04); padding: 12px; border-radius: 4px; margin-bottom: 8px;">
        <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
          <span>📱 App: <b style="color: var(--rose);">${escapeHtml(k.app_name || k.appName || k.app_package)}</b></span>
          <span style="color: var(--text-muted); font-size: 0.75rem;">${new Date(Number(k.timestamp)).toLocaleTimeString()}</span>
        </div>
        <div style="font-family: monospace; font-size: 0.88rem; background: rgba(0,0,0,0.2); padding: 8px; border-radius: 4px; color: #fff; overflow-wrap: break-word;">
          ${escapeHtml(k.text)}
        </div>
      </div>
    `).join('');
  } catch (_) {}
}

// Files Explorer loader
async function loadDeviceFiles(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/files`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const files = await res.json();
    const tbody = document.getElementById('files-table-body');
    const galleryContainer = document.getElementById('gallery-container');
    
    // Clear & Populate Explorer Table
    if (!files || files.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No files retrieved yet. Send a directory sync command to load.</td></tr>';
      galleryContainer.innerHTML = '<div class="empty-state" style="grid-column: span 10;">No media records captured. Permission and Scoped Storage verification active.</div>';
      return;
    }
    
    window.allDeviceFiles = files;
    
    // Auto-detect root path
    if (!window.fileSystemRootPath) {
      let shortestPath = '/storage/emulated/0';
      if (files.length > 0) {
        shortestPath = files[0].file_path;
        files.forEach(f => {
          if (f.file_path.length < shortestPath.length) {
            shortestPath = f.file_path;
          }
        });
        const matchFile = files.find(f => f.file_path === shortestPath);
        if (matchFile && !matchFile.is_directory) {
          const parts = shortestPath.split('/');
          parts.pop();
          shortestPath = parts.join('/') || '/';
        }
      }
      window.fileSystemRootPath = shortestPath;
    }
    
    if (!window.currentDirectoryPath) {
      window.currentDirectoryPath = window.fileSystemRootPath;
    }
    
    window.renderFilesTable = function() {
      const currentPath = window.currentDirectoryPath || '/storage/emulated/0';
      
      const breadcrumbEl = document.getElementById('files-breadcrumb') || (() => {
        const parentPanel = tbody.closest('.panel');
        if (parentPanel) {
          const header = parentPanel.querySelector('.panel-header');
          if (header) {
            let bc = document.getElementById('files-breadcrumb');
            if (!bc) {
              bc = document.createElement('div');
              bc.id = 'files-breadcrumb';
              bc.style.padding = '8px 16px';
              bc.style.background = 'rgba(255,255,255,0.02)';
              bc.style.borderBottom = '1px solid var(--border)';
              bc.style.fontFamily = 'monospace';
              bc.style.fontSize = '0.85rem';
              bc.style.color = 'var(--cyan)';
              bc.style.display = 'flex';
              bc.style.alignItems = 'center';
              bc.style.gap = '8px';
              header.after(bc);
            }
            return bc;
          }
        }
        return null;
      })();
      
      if (breadcrumbEl) {
        breadcrumbEl.innerHTML = `<span>📂 <b>Location:</b> ${escapeHtml(currentPath)}</span>`;
      }
      
      // Filter files directly under currentPath
      const filtered = window.allDeviceFiles.filter(f => {
        const parts = f.file_path.split('/');
        parts.pop();
        const parent = parts.join('/') || '/';
        return parent === currentPath;
      });
      
      let rowsHtml = '';
      
      if (currentPath !== window.fileSystemRootPath && currentPath !== '/') {
        rowsHtml += `
          <tr style="cursor: pointer; background: rgba(6,182,212,0.04);" onclick="navigateFileSystemUp()">
            <td>🔙</td>
            <td colspan="5"><span style="color: var(--cyan); font-weight: bold;">.. [Go Up to Parent Directory]</span></td>
          </tr>
        `;
      }
      
      if (filtered.length === 0) {
        rowsHtml += `<tr><td colspan="6" class="text-center" style="padding: 24px;">This directory is empty or has no synced contents.</td></tr>`;
      } else {
        rowsHtml += filtered.map(f => {
          const isDir = f.is_directory;
          const icon = isDir ? '📁' : '📄';
          const sizeStr = isDir ? '--' : formatBytes(Number(f.file_size));
          const dateStr = f.created_at ? new Date(f.created_at).toLocaleString() : 'N/A';

          // Values travel via HTML-escaped data-* attributes and are handled by
          // addEventListener — never interpolated into inline JS (XSS sink fix).
          const dataAttrs = `data-path="${escapeHtml(f.file_path || '')}" data-name="${escapeHtml(f.file_name || '')}" data-mime="${escapeHtml(f.mime_type || '')}" data-size="${escapeHtml(sizeStr)}"`;

          let actionHtml = '--';
          if (!isDir) {
            const mime = f.mime_type || '';
            const isMedia = mime.startsWith('image/') || mime.startsWith('video/') || /\.(jpg|jpeg|png|gif|mp4|mov)$/i.test(f.file_name);

            actionHtml = `
              <div style="display: flex; gap: 6px;">
                ${isMedia ? `<button class="btn btn-secondary btn-sm file-preview-btn" style="padding: 3px 8px; font-size: 0.72rem;" data-action="preview-file" ${dataAttrs}>👁️ Preview</button>` : ''}
                <button class="btn btn-primary btn-sm file-download-btn" style="padding: 3px 8px; font-size: 0.72rem; background: var(--cyan); border-color: var(--cyan);" data-action="download-file" ${dataAttrs}>📥 Download</button>
              </div>
            `;
          }

          const rowAttrs = isDir ? `style="cursor: pointer; background: rgba(6,182,212,0.02);" data-action="open-dir" ${dataAttrs}` : '';

          return `
            <tr ${rowAttrs} class="file-row-${isDir ? 'dir' : 'file'}">
              <td>${icon}</td>
              <td><b style="${isDir ? 'color: var(--cyan); text-decoration: underline;' : ''}">${escapeHtml(f.file_name)}</b></td>
              <td style="font-family: monospace; font-size: 0.8rem; opacity: 0.8;">${escapeHtml(f.file_path)}</td>
              <td>${escapeHtml(sizeStr)}</td>
              <td>${escapeHtml(dateStr)}</td>
              <td>${actionHtml}</td>
            </tr>
          `;
        }).join('');
      }

      tbody.innerHTML = rowsHtml;

      wireActions(tbody, {
        'open-dir': (data) => { window.currentDirectoryPath = data.path; window.renderFilesTable(); },
        'preview-file': (data) => openMediaPreview(data.name, data.path, data.size, data.mime),
        'download-file': (data) => downloadMediaFile(data.path, data.name)
      });
    };
    
    window.navigateFileSystemTo = function(path, event) {
      if (event) event.stopPropagation();
      window.currentDirectoryPath = path;
      window.renderFilesTable();
    };

    window.navigateFileSystemUp = function() {
      if (!window.currentDirectoryPath || window.currentDirectoryPath === window.fileSystemRootPath) return;
      const parts = window.currentDirectoryPath.split('/');
      parts.pop();
      window.currentDirectoryPath = parts.join('/') || '/';
      window.renderFilesTable();
    };

    window.renderFilesTable();

    // Clear & Populate Media Gallery Preview
    const mediaFiles = files.filter(f => {
      const mime = (f.mime_type || '').toLowerCase();
      return mime.startsWith('image/') || mime.startsWith('video/') || /\.(jpg|jpeg|png|gif|mp4|mov)$/i.test(f.file_name);
    });

    if (mediaFiles.length === 0) {
      galleryContainer.innerHTML = '<div class="empty-state" style="grid-column: span 10;">No media records captured. Permission and Scoped Storage verification active.</div>';
    } else {
      galleryContainer.innerHTML = mediaFiles.map(f => {
        const isVideo = (f.mime_type || '').toLowerCase().startsWith('video/') || f.file_name.endsWith('.mp4');
        const sizeStr = formatBytes(Number(f.file_size));
        const dataAttrs = `data-path="${escapeHtml(f.file_path || '')}" data-name="${escapeHtml(f.file_name || '')}" data-mime="${escapeHtml(f.mime_type || '')}" data-size="${escapeHtml(sizeStr)}"`;

        return `
          <div class="stat-card" data-action="preview-file" ${dataAttrs} style="padding: 12px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 160px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; text-align: center; cursor: pointer; transition: all 0.2s;">
            <div style="font-size: 2.6rem; margin-bottom: 8px; transition: transform 0.2s;">${isVideo ? '🎬' : '🖼️'}</div>
            <div style="font-size: 0.82rem; font-weight: bold; word-break: break-all; margin-bottom: 4px; max-height: 40px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${escapeHtml(f.file_name)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">${escapeHtml(sizeStr)}</div>
            <div style="display: flex; gap: 4px; width: 100%; justify-content: center;">
              <span class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.65rem; pointer-events: none;">👁️ Preview</span>
              <span class="btn btn-primary btn-sm" style="padding: 2px 6px; font-size: 0.65rem; background: var(--cyan); border-color: var(--cyan); pointer-events: none;">📥 Download</span>
            </div>
          </div>
        `;
      }).join('');

      wireActions(galleryContainer, {
        'preview-file': (data) => openMediaPreview(data.name, data.path, data.size, data.mime)
      });
    }
  } catch (err) {
    console.error('Error loading files:', err);
  }
}

// Format bytes helper
function formatBytes(bytes) {
  if (bytes === 0 || isNaN(bytes)) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Service Health loader
// Truthful model: (1) dashboard live-sync = our own WS; (2) device link =
// the device's socket presence + last-seen from the server; (3) agent service
// states come from /service-health (real fields, not invented ones).
async function loadDeviceHealth(deviceId) {
  const dashWsStatus = ws && ws.readyState === WebSocket.OPEN ? 'CONNECTED' : 'OFFLINE';

  const srvWs = document.getElementById('status-srv-ws');
  if (srvWs) {
    srvWs.textContent = dashWsStatus === 'CONNECTED' ? 'Active' : 'Offline';
    srvWs.className = `pill ${dashWsStatus === 'CONNECTED' ? 'pill-online' : 'pill-offline'}`;
  }

  try {
    const res = await fetch(`/api/devices/${deviceId}/service-health`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const health = await res.json();

      // Device WebSocket transport = the DEVICE's link, not the dashboard's.
      const deviceOnline = !!health.deviceConnected;
      const wsPill = document.getElementById('health-ws-status');
      if (wsPill) {
        wsPill.textContent = deviceOnline ? 'Connected' : 'Offline';
        wsPill.style.color = deviceOnline ? '#22c55e' : '#f43f5e';
      }

      const setPill = (id, value, runningLabel) => {
        const el = document.getElementById(id);
        if (!el) return;
        const running = value === 'RUNNING';
        el.textContent = running ? runningLabel : (value || 'Unknown');
        el.className = `pill ${running ? 'pill-online' : 'pill-offline'}`;
      };
      setPill('status-srv-notif', health.notificationMonitor, 'Running');
      setPill('status-srv-gps', health.locationService, 'Running');
      setPill('status-srv-telemetry', health.telemetryCollector, 'Running');

      const listContainer = document.getElementById('health-heartbeat-log');
      if (listContainer) {
        const time = new Date().toLocaleString();
        const lastSeenStr = health.lastSeen ? new Date(health.lastSeen).toLocaleString() : 'never';
        listContainer.replaceChildren();
        const lines = [
          `[${time}] [DEVICE LINK] Device socket: ${deviceOnline ? 'CONNECTED' : 'OFFLINE'} • last seen: ${lastSeenStr}`,
          `[${time}] [DASHBOARD SYNC] Dashboard WebSocket: ${dashWsStatus}`,
          `[${time}] [AGENT SERVICES] notifications=${health.notificationMonitor || 'UNKNOWN'} location=${health.locationService || 'UNKNOWN'} telemetry=${health.telemetryCollector || 'UNKNOWN'}`
        ];
        for (const line of lines) {
          const div = document.createElement('div');
          div.textContent = line;
          listContainer.appendChild(div);
        }
      }
    }
  } catch (_) {}
}

// Overview "System health" card — bound to real state (F-16).
async function updateSystemHealth() {
  let apiOk = false;
  let dbMode = 'unknown';
  let activeDevices = 0;
  try {
    const res = await fetch('/api/health');
    if (res.ok) {
      const h = await res.json();
      apiOk = h.status === 'healthy';
      dbMode = h.postgres ? 'postgres' : 'embedded';
      activeDevices = h.activeDevices || 0;
    }
  } catch (_) {}

  const wsOk = ws && ws.readyState === WebSocket.OPEN;

  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const setDot = (id, ok) => {
    const el = document.getElementById(id);
    if (el) el.style.color = ok ? '#34d399' : '#f87171';
  };

  const healthy = apiOk && wsOk;
  setTxt('health-badge-status', healthy ? '● LIVE' : '● DEGRADED');
  setTxt('health-score-val', healthy ? '100' : (apiOk ? '60' : '20'));
  setTxt('health-summary-txt', healthy ? 'Everything looks good' : 'Attention required');
  setTxt('health-sub-txt', healthy
    ? 'All backend services & telemetry streams are connected.'
    : (!apiOk ? 'API unreachable from this browser.' : 'Live updates disconnected — retrying…'));
  setTxt('health-api-val', apiOk ? 'Operational' : 'Unavailable');
  setTxt('health-db-val', dbMode === 'postgres' ? 'PostgreSQL' : (dbMode === 'embedded' ? 'Embedded (in-memory)' : 'Unknown'));
  setTxt('health-sync-val', wsOk ? 'Active' : 'Disconnected');
  setDot('health-sync-dot', wsOk);

  // Attention = offline/enrolled-but-not-connected devices
  const attention = allDevices.filter(d => d.status !== 'ONLINE').length;
  setTxt('stat-attention-devices', String(attention));
}

window.refreshOverview = function() {
  loadDevices().then(() => updateSystemHealth());
  showToast('Overview refreshed');
};

// Audit Logs
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/audit', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.status === 401) {
      handleUnauthorized();
      return;
    }
    if (!res.ok) return;
    const logs = await res.json();
    const tbody = document.getElementById('audit-table-body');
    if (logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center">No audit logs recorded</td></tr>';
      return;
    }
    tbody.innerHTML = logs.map(l => `
      <tr>
        <td>${new Date(l.created_at).toLocaleString()}</td>
        <td><b>${escapeHtml(l.action)}</b></td>
        <td style="font-family: monospace;">${escapeHtml(l.device_id || '--')}</td>
        <td>User #${l.user_id || 'System'}</td>
        <td>${escapeHtml(l.ip_address || '')}</td>
        <td style="font-size: 0.8rem; font-family: monospace;">${escapeHtml(typeof l.details === 'object' ? JSON.stringify(l.details) : l.details || '')}</td>
      </tr>
    `).join('');
  } catch (_) {}
}

// Alerts
async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const alerts = await res.json();
    const container = document.getElementById('alerts-list');
    if (container) {
      if (alerts.length === 0) {
        container.innerHTML = '<div class="empty-state">No active security alerts. All systems operational.</div>';
      } else {
        container.innerHTML = alerts.map(a => `
          <div style="background: var(--bg-surface); border-left: 4px solid var(--amber); padding: 14px; border-radius: 8px; margin-bottom: 10px;">
            <div style="font-weight: 600;">${escapeHtml(a.type || a.alert_type || 'Alert')}: ${escapeHtml(a.message || a.title || '')}</div>
            <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Device: ${a.device_id || '--'} • ${new Date(a.created_at).toLocaleString()}</div>
          </div>
        `).join('');
      }
    }

    // Also update Operations Alerts widget on Overview
    const consoleAlerts = document.getElementById('console-alerts-list');
    if (consoleAlerts) {
      if (alerts.length === 0) {
        consoleAlerts.innerHTML = '<div class="empty-state" style="padding: 10px; font-size: 0.78rem;">✓ No alerts active. Device state nominal.</div>';
      } else {
        consoleAlerts.innerHTML = alerts.slice(0, 5).map(a => {
          const isWarning = a.severity === 'WARNING' || (a.alert_type && a.alert_type.includes('EXIT'));
          const borderClr = isWarning ? '#f59e0b' : '#38bdf8';
          return `
            <div style="background: var(--bg-surface); border-left: 3px solid ${borderClr}; padding: 8px 12px; border-radius: 6px; font-size: 0.8rem; display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-weight: 600; color: #fff;">${escapeHtml(a.title || a.alert_type || a.type || 'Alert')}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(a.message || '')}</div>
              </div>
              <span style="font-size: 0.68rem; color: var(--text-muted);">${new Date(a.created_at || Date.now()).toLocaleTimeString()}</span>
            </div>
          `;
        }).join('');
      }
    }
  } catch (_) {}
}

// Pairing Modal & Server Config Logic
function setupPairingModal() {
  if (btnPairModal) {
    btnPairModal.addEventListener('click', () => {
      window.openPairModal();
    });
  }

  if (btnClosePairModal) {
    btnClosePairModal.addEventListener('click', () => {
      if (pairModal) pairModal.classList.add('hidden');
      clearInterval(pairingTimer);
    });
  }

  if (btnRegenCode) {
    btnRegenCode.addEventListener('click', () => {
      generatePairingCode();
    });
  }
}

window.switchPairModalTab = function(tabKey) {
  const btnGen = document.getElementById('tab-btn-pair-gen');
  const btnClaim = document.getElementById('tab-btn-pair-claim');
  const btnHistory = document.getElementById('tab-btn-pair-history');

  const panelGen = document.getElementById('pair-tab-panel-gen');
  const panelClaim = document.getElementById('pair-tab-panel-claim');
  const panelHistory = document.getElementById('pair-tab-panel-history');

  [btnGen, btnClaim, btnHistory].forEach(b => b && b.classList.remove('active'));
  [panelGen, panelClaim, panelHistory].forEach(p => {
    if (p) {
      p.classList.remove('active');
      p.style.display = 'none';
    }
  });

  if (tabKey === 'gen') {
    if (btnGen) btnGen.classList.add('active');
    if (panelGen) {
      panelGen.classList.add('active');
      panelGen.style.display = 'block';
    }
  } else if (tabKey === 'claim') {
    if (btnClaim) btnClaim.classList.add('active');
    if (panelClaim) {
      panelClaim.classList.add('active');
      panelClaim.style.display = 'block';
      const input = document.getElementById('claim-device-code');
      if (input) setTimeout(() => input.focus(), 50);
    }
  } else if (tabKey === 'history') {
    if (btnHistory) btnHistory.classList.add('active');
    if (panelHistory) {
      panelHistory.classList.add('active');
      panelHistory.style.display = 'block';
    }
    window.loadPairingCodesHistory();
  }
};

window.copyServerUrlToClipboard = function() {
  const origin = window.location.origin;
  navigator.clipboard.writeText(origin);
  showToast(`Server URL copied: ${origin}`);
};

window.claimDeviceFromDashboard = async function() {
  const codeInput = document.getElementById('claim-device-code');
  const nameInput = document.getElementById('claim-device-name');
  const envSelect = document.getElementById('claim-device-env');
  const alertEl = document.getElementById('claim-status-alert');
  const btn = document.getElementById('btn-submit-claim-device');

  const code = (codeInput?.value || '').trim();
  const deviceName = (nameInput?.value || '').trim() || 'Android Device';
  const environment = envSelect?.value || 'Production VPS';

  if (!code || code.length < 4) {
    if (alertEl) {
      alertEl.style.display = 'block';
      alertEl.style.background = 'rgba(239, 68, 68, 0.15)';
      alertEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      alertEl.style.color = '#f87171';
      alertEl.textContent = 'Please enter a valid pairing code (e.g. 6 digits).';
    }
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Linking device to dashboard...</span>';
  }
  if (alertEl) alertEl.style.display = 'none';

  try {
    const res = await fetch('/api/pairing/claim', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        code,
        deviceName,
        environment
      })
    });
    const data = await res.json();

    if (res.ok && data.success) {
      if (alertEl) {
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(16, 185, 129, 0.15)';
        alertEl.style.border = '1px solid rgba(16, 185, 129, 0.3)';
        alertEl.style.color = '#34d399';
        alertEl.textContent = `✓ ${data.message || 'Device paired successfully!'}`;
      }
      if (codeInput) codeInput.value = '';
      if (nameInput) nameInput.value = '';

      showToast(`Device "${deviceName}" paired and enrolled!`);
      loadDevices();
      window.loadPairingCodesHistory();

      setTimeout(() => {
        document.getElementById('pair-modal')?.classList.add('hidden');
        showView('devices');
      }, 1200);
    } else {
      if (alertEl) {
        alertEl.style.display = 'block';
        alertEl.style.background = 'rgba(239, 68, 68, 0.15)';
        alertEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        alertEl.style.color = '#f87171';
        alertEl.textContent = data.message || data.error || 'Failed to claim device with this code.';
      }
    }
  } catch (err) {
    if (alertEl) {
      alertEl.style.display = 'block';
      alertEl.style.background = 'rgba(239, 68, 68, 0.15)';
      alertEl.style.border = '1px solid rgba(239, 68, 68, 0.3)';
      alertEl.style.color = '#f87171';
      alertEl.textContent = `Network error: ${err.message}`;
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<span>🔗 Pair & Connect Device Now</span>';
    }
  }
};

window.openPairModal = function() {
  const modal = document.getElementById('pair-modal');
  if (modal) modal.classList.remove('hidden');
  window.switchPairModalTab('gen');
  
  // Set guide URL to current origin
  const guideUrlEl = document.getElementById('guide-server-url');
  if (guideUrlEl) guideUrlEl.textContent = window.location.origin;

  // Reset live pulse status
  const liveText = document.getElementById('pair-live-status-text');
  const pulseDot = document.getElementById('pair-pulse-indicator');
  if (liveText) {
    liveText.textContent = 'Waiting for Android device to redeem code...';
    liveText.style.color = 'var(--muted)';
    liveText.style.fontWeight = '500';
  }
  if (pulseDot) {
    pulseDot.style.background = '#24a477';
    pulseDot.style.boxShadow = '0 0 8px #24a477';
  }

  generatePairingCode();
  window.loadPairingCodesHistory();
};

window.copyPairingCode = function() {
  const codeEl = document.getElementById('modal-pairing-code');
  if (codeEl && codeEl.textContent.trim()) {
    navigator.clipboard.writeText(codeEl.textContent.trim());
    showToast('Pairing code copied to clipboard!');
  }
};

window.loadPairingCodesHistory = async function() {
  const tbody = document.getElementById('pairing-codes-tbody');
  if (!tbody) return;
  try {
    const res = await fetch('/api/pairing/codes', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const codes = await res.json();
    if (codes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 12px; color: var(--muted);">No pairing codes generated yet</td></tr>';
      return;
    }
    tbody.innerHTML = codes.map(c => {
      let statusClass = 'pill-online';
      if (c.status === 'REVOKED' || c.status === 'EXPIRED') statusClass = 'pill-offline';
      else if (c.status === 'REDEEMED') statusClass = 'pill-online';
      
      const canRevoke = c.status === 'ACTIVE';
      return `
        <tr style="border-bottom: 1px solid var(--line);">
          <td style="padding: 6px 10px; font-family: 'JetBrains Mono', monospace; font-weight: 700;">${escapeHtml(c.code)}</td>
          <td style="padding: 6px 10px; color: var(--muted);">${escapeHtml(c.environment || 'Default')}</td>
          <td style="padding: 6px 10px;"><span class="pill ${statusClass}" style="font-size: 9px; padding: 2px 6px;">${c.status}</span></td>
          <td style="padding: 6px 10px; text-align: right;">
            ${canRevoke ? `<button onclick="window.revokePairingCode('${c.code}')" class="secondary" style="padding: 2px 6px; font-size: 9px; color: #f43f5e; margin: 0;">Revoke</button>` : `<span style="color: var(--muted); font-size: 9px;">--</span>`}
          </td>
        </tr>
      `;
    }).join('');
  } catch (e) {
    console.error('Error loading pairing codes:', e);
  }
};

window.revokePairingCode = async function(code) {
  try {
    const res = await fetch(`/api/pairing/codes/${code}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      showToast(`Pairing code ${code} revoked.`);
      window.loadPairingCodesHistory();
    }
  } catch (e) {
    showToast('Failed to revoke code.');
  }
};

window.openServerConfigModal = function() {
  const modal = document.getElementById('server-config-modal');
  if (modal) modal.classList.remove('hidden');
  window.testServerConfig();
};

window.testServerConfig = async function() {
  const serverInput = document.getElementById('cfg-input-server-url');
  const wsInput = document.getElementById('cfg-input-ws-url');
  const detailsEl = document.getElementById('cfg-health-details');
  const statusEl = document.getElementById('cfg-server-status');

  const loc = window.location;
  const proto = loc.protocol;
  const wsProto = proto === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${proto}//${loc.host}`;
  const wsUrl = `${wsProto}//${loc.host}/ws/device`;

  if (serverInput) serverInput.value = serverUrl;
  if (wsInput) wsInput.value = wsUrl;

  try {
    const res = await fetch('/api/server/config');
    if (res.ok) {
      const data = await res.json();
      if (detailsEl) {
        detailsEl.innerHTML = `
          <div>Status: <b style="color: #22c55e;">${data.status}</b></div>
          <div>Environment: <b>${data.environment}</b></div>
          <div>Database Engine: <b>${data.postgres ? 'PostgreSQL' : 'Embedded DB'}</b></div>
          <div>Connected Devices: <b>${data.activeDevices}</b></div>
        `;
      }
      if (statusEl) {
        statusEl.textContent = 'HEALTHY';
        statusEl.className = 'pill pill-online';
      }
    } else {
      if (statusEl) {
        statusEl.textContent = 'ERROR';
        statusEl.className = 'pill pill-offline';
      }
    }
  } catch (err) {
    if (detailsEl) detailsEl.textContent = 'Connection test failed: ' + err.message;
    if (statusEl) {
      statusEl.textContent = 'UNREACHABLE';
      statusEl.className = 'pill pill-offline';
    }
  }
};

window.copyServerUrl = function() {
  const input = document.getElementById('cfg-input-server-url');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value);
    showToast('Server URL copied!');
  }
};

window.copyWsUrl = function() {
  const input = document.getElementById('cfg-input-ws-url');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value);
    showToast('WebSocket URL copied!');
  }
};

async function generatePairingCode() {
  try {
    const envSelect = document.getElementById('pair-env-select');
    const selectedEnv = envSelect ? envSelect.value : 'Default VPS';
    const qrOverlay = document.getElementById('qr-expired-overlay');
    const qrImg = document.getElementById('pairing-qr-img');

    if (qrOverlay) qrOverlay.style.display = 'none';

    const res = await fetch('/api/pairing/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ environment: selectedEnv })
    });
    if (!res.ok) return;
    const data = await res.json();

    // Display 6-digit code and QR Code image
    const codeEl = document.getElementById('modal-pairing-code');
    if (codeEl) codeEl.textContent = data.code;

    if (qrImg && data.qrDataUrl) {
      qrImg.src = data.qrDataUrl;
    }

    // Refresh history
    window.loadPairingCodesHistory();

    // Reset live pulse status
    const liveText = document.getElementById('pair-live-status-text');
    const pulseDot = document.getElementById('pair-pulse-indicator');
    if (liveText) {
      liveText.textContent = 'Scan QR code or enter 6-digit code on Android device';
      liveText.style.color = 'var(--muted)';
      liveText.style.fontWeight = '500';
    }
    if (pulseDot) {
      pulseDot.style.background = '#24a477';
      pulseDot.style.boxShadow = '0 0 8px #24a477';
    }

    // Start 30-second timer countdown
    const expires = new Date(data.expiresAt).getTime();
    clearInterval(pairingTimer);
    pairingTimer = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expires - now) / 1000));
      const countdownEl = document.getElementById('code-countdown');
      if (countdownEl) countdownEl.textContent = `${diff}s`;

      if (diff <= 0) {
        clearInterval(pairingTimer);
        if (codeEl) codeEl.textContent = 'EXPIRED';
        if (qrOverlay) qrOverlay.style.display = 'flex';
        if (liveText) {
          liveText.textContent = '⚠️ Pairing session expired. Click "New Session" to refresh.';
          liveText.style.color = '#f87171';
        }
        window.loadPairingCodesHistory();
      }
    }, 1000);
  } catch (err) {
    console.error('Error generating pairing code:', err);
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatTimeAgo(isoString) {
  const diffSec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function formatUptime(millis) {
  const totalSec = Math.floor(millis / 1000);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  return `${hours}h ${mins}m`;
}

// Media Preview Lightbox Controller
// XSS-safe: user-controlled values are only ever set via textContent / element
// properties, never interpolated into HTML or inline handlers.
function safeMediaUrl(url) {
  if (typeof url !== 'string') return null;
  if (url.startsWith('blob:')) return url;
  if (/^data:(image|video|audio)\//i.test(url)) return url;
  if (url.startsWith('/uploads/') && !url.includes('..') && !url.includes('\\')) return url;
  return null;
}

async function fetchAuthedBlobUrl(url) {
  // Uploaded files require an Authorization header — fetch then use blob URLs.
  if (!url.startsWith('/uploads/')) return url;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${authToken}` } });
  if (!res.ok) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

window.openMediaPreview = async function(name, path, sizeStr, mime) {
  const lightbox = document.getElementById('media-lightbox');
  const title = document.getElementById('lightbox-title');
  const size = document.getElementById('lightbox-file-size');
  const pathLabel = document.getElementById('lightbox-file-path');
  const previewContainer = document.getElementById('lightbox-content-preview');
  const downloadBtn = document.getElementById('lightbox-download-btn');

  if (!lightbox) return;

  title.textContent = name || 'File';
  size.textContent = sizeStr || 'Unknown Size';
  pathLabel.textContent = path || '';
  previewContainer.replaceChildren();

  const mimeStr = typeof mime === 'string' ? mime : '';
  const pathStr = typeof path === 'string' ? path : '';
  const isVideo = mimeStr.startsWith('video/') || /\.(mp4|mov)$/i.test(pathStr);

  // Resolve the actual asset URL (blob:/data:/uploads only — reject schemes
  // like javascript: or external origins).
  let actualUrl = safeMediaUrl(pathStr);

  if (pathStr && !actualUrl && !pathStr.startsWith('http') && !pathStr.startsWith('blob:')) {
    // Device-local path: check whether the server has a streamed copy.
    try {
      const checkRes = await fetch(`/api/devices/${currentDevice.id}/files`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkRes.ok) {
        const files = await checkRes.json();
        const fileEntry = files.find(f => f.file_path === pathStr);
        if (fileEntry && fileEntry.web_path) {
          actualUrl = safeMediaUrl(fileEntry.web_path);
        }
      }
    } catch (e) {
      actualUrl = null;
    }
  }

  if (actualUrl) {
    actualUrl = await fetchAuthedBlobUrl(actualUrl);
  }

  if (!actualUrl) {
    // Remote pull interface — DOM-built (no innerHTML with user data).
    const loader = document.createElement('div');
    loader.className = 'media-pull-loader';
    loader.style.cssText = 'padding: 40px; text-align: center; color: var(--cyan); width: 100%;';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size: 3rem; margin-bottom: 12px; animation: pulse 1.5s infinite;';
    icon.textContent = '⚡';
    const heading = document.createElement('h4');
    heading.style.cssText = 'margin: 0 0 4px 0; color: #fff;';
    heading.textContent = 'File Available on Remote Device';
    const desc = document.createElement('p');
    desc.style.cssText = 'font-size: 0.78rem; color: var(--text-muted); max-width: 320px; margin: 0 auto 15px auto;';
    desc.textContent = 'This file is located on the remote Android storage. Tap below to stream and preview it online.';
    const pullBtn = document.createElement('button');
    pullBtn.id = 'btn-stream-file';
    pullBtn.className = 'btn btn-primary btn-sm';
    pullBtn.style.cssText = 'background: var(--cyan); border-color: var(--cyan); font-weight: 500;';
    pullBtn.textContent = '👁️ Stream File Now';

    loader.append(icon, heading, desc, pullBtn);
    previewContainer.appendChild(loader);
    lightbox.classList.remove('hidden');

    pullBtn.addEventListener('click', async () => {
      loader.replaceChildren();
      const spin = document.createElement('div');
      spin.className = 'loader';
      spin.style.cssText = 'margin: 0 auto 15px auto;';
      const h = document.createElement('h4');
      h.style.cssText = 'margin: 0 0 4px 0; color: #fff;';
      h.textContent = 'Streaming from Device...';
      const p = document.createElement('p');
      p.style.cssText = 'font-size: 0.78rem; color: var(--text-muted);';
      p.textContent = 'Please keep the device connection active.';
      loader.append(spin, h, p);

      try {
        const dispatchRes = await fetch(`/api/devices/${currentDevice.id}/commands`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken}`
          },
          body: JSON.stringify({
            commandType: 'UPLOAD_FILE',
            parameters: { path: pathStr }
          })
        });

        const dispatchData = await dispatchRes.json().catch(() => ({}));
        if (dispatchRes.ok) {
          if (!dispatchData.dispatchedToOnlineDevice) {
            showToast('Device offline — stream request queued; try again when the device is connected', 'warning');
          }
          let attempts = 0;
          const interval = setInterval(async () => {
            attempts++;
            if (attempts > 15) {
              clearInterval(interval);
              loader.replaceChildren();
              const warn = document.createElement('div');
              warn.style.cssText = 'font-size: 3rem; margin-bottom: 12px; color: var(--danger);';
              warn.textContent = '⚠️';
              const wh = document.createElement('h4');
              wh.style.cssText = 'margin: 0 0 4px 0; color: #fff;';
              wh.textContent = 'Streaming Timed Out';
              const wp = document.createElement('p');
              wp.style.cssText = 'font-size: 0.78rem; color: var(--text-muted);';
              wp.textContent = 'Please check if the device is active and retry.';
              loader.append(warn, wh, wp);
              return;
            }

            const checkRes = await fetch(`/api/devices/${currentDevice.id}/files`, {
              headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (checkRes.ok) {
              const files = await checkRes.json();
              const fileEntry = files.find(f => f.file_path === pathStr);
              if (fileEntry && fileEntry.web_path) {
                clearInterval(interval);
                showToast('File streamed successfully!');
                openMediaPreview(name, fileEntry.web_path, sizeStr, mimeStr);
              }
            }
          }, 800);
        } else {
          showToast('Failed to dispatch pull command.', 'error');
        }
      } catch (err) {
        showToast('Error pulling media.', 'error');
      }
    });
    return;
  }

  if (isVideo) {
    const video = document.createElement('video');
    video.controls = true;
    video.autoplay = true;
    video.style.cssText = 'max-height: 340px; width: 100%; border-radius: 4px;';
    video.src = actualUrl;
    previewContainer.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.style.cssText = 'max-height: 340px; max-width: 100%; object-fit: contain; border-radius: 4px;';
    img.alt = name || 'File preview';
    img.addEventListener('error', () => {
      img.alt = 'Preview unavailable';
    });
    img.src = actualUrl;
    previewContainer.appendChild(img);
  }

  downloadBtn.onclick = (e) => {
    e.preventDefault();
    downloadMediaFile(actualUrl.startsWith('blob:') ? pathStr : actualUrl, name);
  };

  lightbox.classList.remove('hidden');
};

window.closeMediaLightbox = function() {
  const lightbox = document.getElementById('media-lightbox');
  const previewContainer = document.getElementById('lightbox-content-preview');
  if (lightbox) {
    lightbox.classList.add('hidden');
  }
  if (previewContainer) {
    previewContainer.innerHTML = ''; // Stop video playback
  }
};

window.downloadMediaFile = async function(path, name) {
  if (!currentDevice) return;

  const safeUrl = safeMediaUrl(path);
  if (path.startsWith('/uploads/') || (safeUrl && (safeUrl.startsWith('blob:') || safeUrl.startsWith('data:')))) {
    // Uploaded files are behind auth — fetch with the token, then save the blob.
    let href = safeUrl;
    if (path.startsWith('/uploads/')) {
      try {
        const res = await fetch(path, { headers: { 'Authorization': `Bearer ${authToken}` } });
        if (!res.ok) {
          showToast('Download failed: not authorized or file missing', 'error');
          return;
        }
        href = URL.createObjectURL(await res.blob());
      } catch (e) {
        showToast('Download failed', 'error');
        return;
      }
    }
    const link = document.createElement('a');
    link.href = href;
    link.setAttribute('download', String(name || 'file').replace(/[\/:*?"<>|]/g, '_'));
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return;
  }
  
  try {
    const res = await fetch(`/api/devices/${currentDevice.id}/files`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const files = await res.json();
      const fileEntry = files.find(f => f.file_path === path);
      if (fileEntry && fileEntry.web_path) {
        window.downloadMediaFile(fileEntry.web_path, name);
        return;
      }
    }
  } catch (e) {}

  showToast(`Requesting "${name}" from device...`);
  
  try {
    const dispatchRes = await fetch(`/api/devices/${currentDevice.id}/commands`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({
        commandType: 'UPLOAD_FILE',
        parameters: { path: path }
      })
    });
    
    if (dispatchRes.ok) {
      appendNotificationFeed({
        appName: "Dashboard Manager",
        title: "Download Dispatched",
        text: `Requested file retrieval: ${name}`
      });
      
      let attempts = 0;
      const interval = setInterval(async () => {
        attempts++;
        if (attempts > 15) {
          clearInterval(interval);
          showToast(`File retrieve timed out.`);
          return;
        }
        
        try {
          const checkRes = await fetch(`/api/devices/${currentDevice.id}/files`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
          });
          if (checkRes.ok) {
            const files = await checkRes.json();
            const fileEntry = files.find(f => f.file_path === path);
            if (fileEntry && fileEntry.web_path) {
              clearInterval(interval);
              showToast(`File downloaded!`);
              window.downloadMediaFile(fileEntry.web_path, name);
              loadDeviceFiles(currentDevice.id);
            }
          }
        } catch (e) {}
      }, 800);
    } else {
      showToast("Failed to dispatch file retrieval command.");
    }
  } catch (err) {
    showToast("Error retrieving file.");
  }
};
