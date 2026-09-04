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
let notificationOffset = 0;
let hasMoreNotifications = true;
const notificationPageSize = 30;
let currentMediaType = 'images';

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
  setupNotificationFilters();
  setupFilesAndMediaFilters();
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
  const wsUrl = `${protocol}//${location.host}/ws/dashboard?token=${encodeURIComponent(authToken || '')}`;

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
  if (msg.type === 'DEVICE_STATUS_CHANGED') {
    updateDeviceStatusInUi(msg.deviceId, msg.status);
    loadDevices();
  } else if (msg.type === 'DEVICE_TELEMETRY_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      applyTelemetry(msg.telemetry);
    }
    loadDevices();
  } else if (msg.type === 'DEVICE_LOCATION_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      updateMapLocation(msg.location);
    }
  } else if (msg.type === 'DEVICE_NOTIFICATION_RECEIVED') {
    appendNotificationFeed(msg.notification);
    if (currentDevice && currentDevice.id === msg.deviceId) {
      notificationOffset = 0;
      loadDeviceNotifications(currentDevice.id, true);
    }
  } else if (msg.type === 'COMMAND_STATUS_UPDATED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceCommands(currentDevice.id);
    }
  } else if (msg.type === 'DEVICE_FILES_SYNCED') {
    if (currentDevice && currentDevice.id === msg.deviceId) {
      loadDeviceFiles(currentDevice.id);
      loadDeviceMedia(currentDevice.id, currentMediaType);
    }
  } else if (msg.type === 'DEVICE_PAIRED') {
    loadDevices();
    showView('devices');
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

    // Load sub-resources
    loadDeviceLocations(deviceId);
    notificationOffset = 0;
    loadDeviceNotifications(deviceId, true);
    loadDeviceFiles(deviceId);
    loadDeviceMedia(deviceId, currentMediaType);
    loadDeviceApps(deviceId);
    loadDeviceUsage(deviceId);
    loadDeviceCommands(deviceId);
    loadDeviceRecordings(deviceId);
  } catch (err) {
    console.error('Error opening device detail:', err);
  }
};

function applyTelemetry(t) {
  if (!t) return;
  const bat = t.battery_level !== undefined ? t.battery_level : (t.batteryLevel || 0);
  const isCharging = t.is_charging !== undefined ? t.is_charging : t.isCharging;
  document.getElementById('metric-battery').textContent = `${bat}%`;
  document.getElementById('progress-battery').style.width = `${bat}%`;
  document.getElementById('metric-charging').textContent = isCharging ? '⚡ Charging' : 'On battery';

  const storAvail = t.storage_available || t.storageAvailableBytes || 0;
  const storTotal = t.storage_total || t.storageTotalBytes || 0;
  const storAvailGb = (storAvail / (1024 * 1024 * 1024)).toFixed(1);
  const storTotalGb = (storTotal / (1024 * 1024 * 1024)).toFixed(1);
  document.getElementById('metric-storage').textContent = `${storAvailGb} GB Free`;
  document.getElementById('metric-storage-total').textContent = `of ${storTotalGb} GB total`;
  if (storTotal > 0) {
    document.getElementById('progress-storage').style.width = `${Math.min(100, Math.round((storAvail / storTotal) * 100))}%`;
  }

  const ramAvail = t.ram_available || t.ramAvailableBytes || 0;
  const ramTotal = t.ram_total || t.ramTotalBytes || 0;
  const ramAvailMb = Math.round(ramAvail / (1024 * 1024));
  const ramTotalMb = Math.round(ramTotal / (1024 * 1024));
  document.getElementById('metric-ram').textContent = `${ramAvailMb} MB Free`;
  document.getElementById('metric-ram-total').textContent = `of ${ramTotalMb} MB total`;
  if (ramTotal > 0) {
    document.getElementById('progress-ram').style.width = `${Math.min(100, Math.round((ramAvail / ramTotal) * 100))}%`;
  }

  document.getElementById('metric-network').textContent = t.network_type || t.networkType || 'Unknown';
  document.getElementById('metric-ssid').textContent = `SSID: ${t.wifi_ssid || t.wifiSsid || 'None'}`;
  const uptime = t.uptime_millis || t.uptimeMillis || 0;
  document.getElementById('metric-uptime').textContent = `Uptime: ${formatUptime(uptime)}`;
}

function renderPermissions(perms) {
  const container = document.getElementById('permissions-status-list');
  if (!perms) {
    container.innerHTML = '<div class="empty-state">No permissions recorded</div>';
    return;
  }

  const list = [
    { label: 'Location Tracking', val: perms.location },
    { label: 'Notification Access', val: perms.notification_access || perms.notificationAccess },
    { label: 'Files & Media Access', val: perms.files_access || perms.filesAccess },
    { label: 'Camera Diagnostics', val: perms.camera },
    { label: 'Microphone Diagnostics', val: perms.microphone },
    { label: 'App Usage Access', val: perms.usage_access || perms.usageAccess },
    { label: 'Screen Sharing Stream', val: perms.screen_sharing || perms.screenSharing }
  ];

  container.innerHTML = list.map(item => `
    <div class="perm-row">
      <span class="perm-label">${item.label}</span>
      <span class="pill ${item.val ? 'pill-online' : 'pill-offline'}">${item.val ? 'GRANTED' : 'DISABLED'}</span>
    </div>
  `).join('');
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

async function loadDeviceLocations(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/locations`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    locationHistory = await res.json();
    if (locationHistory.length > 0 && mapInstance) {
      updateMapLocation(locationHistory[0]);
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
}

// Device Notifications
function setupNotificationFilters() {
  const searchInput = document.getElementById('notif-filter-input');
  const packageInput = document.getElementById('notif-app-filter-input');
  const dateFromInput = document.getElementById('notif-date-from-input');
  const dateToInput = document.getElementById('notif-date-to-input');
  const loadMoreBtn = document.getElementById('notif-load-more-btn');

  [searchInput, packageInput, dateFromInput, dateToInput].forEach((element) => {
    if (!element) return;
    element.addEventListener('input', () => {
      if (!currentDevice) return;
      notificationOffset = 0;
      loadDeviceNotifications(currentDevice.id, true);
    });
  });

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => {
      if (!currentDevice || !hasMoreNotifications) return;
      notificationOffset += notificationPageSize;
      loadDeviceNotifications(currentDevice.id, false);
    });
  }
}

function buildNotificationQuery(limit, offset) {
  const search = document.getElementById('notif-filter-input')?.value?.trim() || '';
  const appPackage = document.getElementById('notif-app-filter-input')?.value?.trim() || '';
  const dateFrom = document.getElementById('notif-date-from-input')?.value;
  const dateTo = document.getElementById('notif-date-to-input')?.value;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (search) params.set('search', search);
  if (appPackage) params.set('appPackage', appPackage);
  if (dateFrom) params.set('startTime', String(new Date(`${dateFrom}T00:00:00`).getTime()));
  if (dateTo) params.set('endTime', String(new Date(`${dateTo}T23:59:59`).getTime()));
  return params.toString();
}

async function loadDeviceNotifications(deviceId, replace = true) {
  try {
    const query = buildNotificationQuery(notificationPageSize, notificationOffset);
    const res = await fetch(`/api/devices/${deviceId}/notifications?${query}`, {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    if (!res.ok) return;

    const notifs = await res.json();
    const tbody = document.getElementById('notif-table-body');
    hasMoreNotifications = notifs.length >= notificationPageSize;

    const loadMoreBtn = document.getElementById('notif-load-more-btn');
    if (loadMoreBtn) {
      loadMoreBtn.disabled = !hasMoreNotifications;
      loadMoreBtn.textContent = hasMoreNotifications ? 'Load More' : 'No More Results';
    }

    if (replace && notifs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No notifications recorded</td></tr>';
      return;
    }

    const rows = notifs.map(n => `
      <tr>
        <td><b>${escapeHtml(n.app_name || n.package_name)}</b></td>
        <td>${escapeHtml(n.title || '')}</td>
        <td>${escapeHtml(n.text || '')}</td>
        <td>${new Date(Number(n.post_time)).toLocaleTimeString()}</td>
        <td><button class="btn-icon" onclick="deleteNotification('${deviceId}', '${n.id}')">🗑️</button></td>
      </tr>
    `).join('');

    if (replace) {
      tbody.innerHTML = rows;
    } else {
      tbody.insertAdjacentHTML('beforeend', rows);
    }
  } catch (_) {}
}

window.deleteNotification = async function(deviceId, notifId) {
  await fetch(`/api/devices/${deviceId}/notifications/${notifId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + authToken }
  });
  notificationOffset = 0;
  loadDeviceNotifications(deviceId, true);
};

function appendNotificationFeed(n) {
  const feed = document.getElementById('overview-notifications-list');
  const empty = feed.querySelector('.empty-state');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.style.padding = '10px 0';
  item.style.borderBottom = '1px solid var(--border)';
  item.innerHTML = `
    <div style="font-weight: 600; font-size: 0.88rem;">${escapeHtml(n.appName)}: ${escapeHtml(n.title)}</div>
    <div style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(n.text)}</div>
    <div style="font-size: 0.72rem; color: #818cf8; margin-top: 2px;">${new Date().toLocaleTimeString()}</div>
  `;
  feed.prepend(item);
}

function setupFilesAndMediaFilters() {
  const filesSearch = document.getElementById('files-search-input');
  const filesType = document.getElementById('files-type-filter');
  const requestFilesBtn = document.getElementById('btn-request-files');

  if (filesSearch) {
    filesSearch.addEventListener('input', () => {
      if (!currentDevice) return;
      loadDeviceFiles(currentDevice.id);
    });
  }

  if (filesType) {
    filesType.addEventListener('change', () => {
      if (!currentDevice) return;
      loadDeviceFiles(currentDevice.id);
      loadDeviceMedia(currentDevice.id, filesType.value === 'all' ? 'all' : filesType.value);
    });
  }

  if (requestFilesBtn) {
    requestFilesBtn.addEventListener('click', () => {
      if (currentDevice) dispatchCommand(currentDevice.id, 'REQUEST_FILES');
    });
  }

  document.querySelectorAll('.media-filter-btn').forEach((button) => {
    button.addEventListener('click', () => {
      currentMediaType = button.getAttribute('data-type') || 'images';
      if (currentDevice) loadDeviceMedia(currentDevice.id, currentMediaType);
    });
  });
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return '--';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

async function loadDeviceFiles(deviceId) {
  const search = document.getElementById('files-search-input')?.value?.trim() || '';
  const type = document.getElementById('files-type-filter')?.value || 'all';
  const params = new URLSearchParams({
    search,
    type,
    limit: '100',
    sortBy: 'modified',
    sortOrder: 'desc'
  });

  try {
    const res = await fetch(`/api/devices/${deviceId}/files?${params.toString()}`, {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    if (!res.ok) return;
    const files = await res.json();
    const tbody = document.getElementById('files-table-body');
    if (!tbody) return;
    if (!files.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No matching files found.</td></tr>';
      return;
    }
    tbody.innerHTML = files.map(file => `
      <tr>
        <td><b>${escapeHtml(file.file_name || '')}</b></td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${escapeHtml(file.file_path || '')}</td>
        <td>${escapeHtml(file.mime_type || '--')}</td>
        <td>${formatBytes(file.file_size)}</td>
        <td>${new Date(file.created_at).toLocaleString()}</td>
      </tr>
    `).join('');
  } catch (_) {}
}

async function loadDeviceMedia(deviceId, mediaType = 'images') {
  const type = mediaType === 'images' || mediaType === 'videos' ? mediaType : 'all';
  const params = new URLSearchParams({
    type,
    limit: '80',
    sortBy: 'modified',
    sortOrder: 'desc'
  });

  try {
    const res = await fetch(`/api/devices/${deviceId}/files?${params.toString()}`, {
      headers: { Authorization: 'Bearer ' + authToken }
    });
    if (!res.ok) return;
    const files = await res.json();
    const media = files.filter(file => String(file.mime_type || '').startsWith('image/') || String(file.mime_type || '').startsWith('video/'));
    const grid = document.getElementById('media-grid');
    if (!grid) return;
    if (!media.length) {
      grid.innerHTML = '<div class="empty-state">No media found for this filter.</div>';
      return;
    }
    grid.innerHTML = media.map(file => {
      const mime = String(file.mime_type || '');
      const icon = mime.startsWith('video/') ? '🎬' : '🖼️';
      return `
        <div class="media-card">
          <div class="media-thumb">${icon}</div>
          <div class="media-meta">
            <div class="media-title">${escapeHtml(file.file_name || 'Media file')}</div>
            <div class="media-sub">${formatBytes(file.file_size)} • ${new Date(file.created_at).toLocaleDateString()}</div>
          </div>
        </div>
      `;
    }).join('');
  } catch (_) {}
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
    const container = document.getElementById('usage-list');
    if (usage.length === 0) {
      container.innerHTML = '<div class="empty-state">No app usage stats recorded. Click "Refresh Stats".</div>';
      return;
    }
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

async function loadDeviceCommands(deviceId) {
  try {
    const res = await fetch(`/api/devices/${deviceId}/commands`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const cmds = await res.json();
    const tbody = document.getElementById('commands-table-body');
    if (cmds.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center">No commands dispatched yet</td></tr>';
      return;
    }
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
  } catch (_) {}
}

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
    if (alerts.length === 0) {
      container.innerHTML = '<div class="empty-state">No active security alerts. All systems operational.</div>';
      return;
    }
    container.innerHTML = alerts.map(a => `
      <div style="background: var(--bg-surface); border-left: 4px solid var(--amber); padding: 14px; border-radius: 8px; margin-bottom: 10px;">
        <div style="font-weight: 600;">${escapeHtml(a.type)}: ${escapeHtml(a.message)}</div>
        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Device: ${a.device_id} • ${new Date(a.created_at).toLocaleString()}</div>
      </div>
    `).join('');
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
