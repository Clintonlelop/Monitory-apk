/**
 * app.js — Main app init, routing, state management
 * Android MDM Dashboard
 * Hash-based routing, no page reloads
 */
const App = (function () {
  'use strict';

  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('[App]', ...args); }

  // ============================================================
  // Global State
  // ============================================================
  const state = {
    currentDeviceId: '',
    devices: [],
    currentRoute: '',
    sidebarCollapsed: false,
    autoRefresh: true,
    autoRefreshInterval: null,
    wsUnsubscribers: []
  };

  // ============================================================
  // Navigation definition
  // ============================================================
  const NAV_SECTIONS = [
    {
      label: 'Monitoring',
      items: [
        { route: 'overview', label: 'Overview', icon: iconDashboard },
        { route: 'deviceHealth', label: 'Device Health', icon: iconActivity },
        { route: 'performance', label: 'Performance', icon: iconGauge },
        { route: 'location', label: 'Location', icon: iconMapPin },
        { route: 'notifications', label: 'Notifications', icon: iconBell },
        { route: 'appsUsage', label: 'Apps & Usage', icon: iconGrid }
      ]
    },
    {
      label: 'Data',
      items: [
        { route: 'contacts', label: 'Contacts', icon: iconUsers },
        { route: 'calls', label: 'Calls', icon: iconPhone },
        { route: 'sms', label: 'SMS', icon: iconMessage },
        { route: 'files', label: 'Files', icon: iconFolder },
        { route: 'transfers', label: 'Transfers', icon: iconUpload },
        { route: 'gallery', label: 'Gallery', icon: iconImage }
      ]
    },
    {
      label: 'Actions',
      items: [
        { route: 'camera', label: 'Camera', icon: iconCamera },
        { route: 'recordings', label: 'Recordings', icon: iconVideo },
        { route: 'remoteControl', label: 'Remote Control', icon: iconRemote },
        { route: 'commands', label: 'Commands', icon: iconTerminal }
      ]
    },
    {
      label: 'System',
      items: [
        { route: 'permissions', label: 'Permissions', icon: iconShield },
        { route: 'activity', label: 'Activity', icon: iconClock },
        { route: 'snapshots', label: 'Snapshots', icon: iconCamera },
        { route: 'diagnostics', label: 'Diagnostics', icon: iconActivity },
        { route: 'geofences', label: 'Geofences', icon: iconGlobe },
        { route: 'settings', label: 'Settings', icon: iconSettings }
      ]
    }
  ];

  // ============================================================
  // SVG Icons (inline, no library)
  // ============================================================
  function svg(paths) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  }
  function iconDashboard() { return svg('<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>'); }
  function iconActivity() { return svg('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>'); }
  function iconMapPin() { return svg('<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle>'); }
  function iconBell() { return svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path>'); }
  function iconGrid() { return svg('<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect>'); }
  function iconUsers() { return svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>'); }
  function iconPhone() { return svg('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>'); }
  function iconMessage() { return svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>'); }
  function iconFolder() { return svg('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>'); }
  function iconImage() { return svg('<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>'); }
  function iconCamera() { return svg('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>'); }
  function iconVideo() { return svg('<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>'); }
  function iconTerminal() { return svg('<polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line>'); }
  function iconRemote() { return svg('<rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line><circle cx="12" cy="10" r="2"></circle><line x1="9" y1="6" x2="15" y2="6"></line>'); }
  function iconShield() { return svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>'); }
  function iconClock() { return svg('<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>'); }
  function iconGlobe() { return svg('<circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>'); }
  function iconSettings() { return svg('<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>'); }
  function iconGauge() { return svg('<path d="M12 14l4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path>'); }
  function iconUpload() { return svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>'); }

  // ============================================================
  // Page module registry
  // ============================================================
  const pageModules = {};

  function registerPage(route, module) {
    pageModules[route] = module;
  }

  // ============================================================
  // Render sidebar navigation
  // ============================================================
  function renderSidebar() {
    const nav = document.getElementById('sidebarNav');
    if (!nav) return;
    nav.innerHTML = '';

    NAV_SECTIONS.forEach(section => {
      const sectionEl = document.createElement('div');
      sectionEl.className = 'nav-section';

      const label = document.createElement('div');
      label.className = 'nav-section-label';
      label.textContent = section.label;
      sectionEl.appendChild(label);

      section.items.forEach(item => {
        const a = document.createElement('a');
        a.className = 'nav-item';
        a.href = '#/' + item.route;
        a.dataset.route = item.route;
        a.innerHTML = `
          <span class="nav-item-icon">${item.icon()}</span>
          <span class="nav-item-label">${item.label}</span>
          <span class="nav-item-tooltip">${item.label}</span>
        `;
        a.addEventListener('click', () => {
          // Close mobile drawer
          document.getElementById('appLayout').classList.remove('sidebar-open');
        });
        sectionEl.appendChild(a);
      });

      nav.appendChild(sectionEl);
    });
  }

  // ============================================================
  // Update active nav item
  // ============================================================
  function updateActiveNav(route) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.route === route);
    });
  }

  // ============================================================
  // Router
  // ============================================================
  function getRoute() {
    const hash = window.location.hash.replace(/^#\/?/, '');
    return hash || 'overview';
  }

  async function navigate() {
    const route = getRoute();
    state.currentRoute = route;
    updateActiveNav(route);

    const container = document.getElementById('pageContainer');
    if (!container) return;

    // Cleanup previous page
    cleanupPage();

    // Fade out
    container.style.opacity = '0';
    container.style.transition = 'opacity 150ms ease';

    const module = pageModules[route];
    if (!module) {
      container.innerHTML = '';
      container.appendChild(UI.emptyState('Page not found', null, `The route "${route}" does not exist.`));
      container.style.opacity = '1';
      return;
    }

    try {
      if (typeof module.init === 'function') {
        await module.init(container);
      } else {
        container.innerHTML = '';
        container.appendChild(UI.emptyState('Page module error', null, 'This page module does not export an init function.'));
      }
    } catch (err) {
      log('Page init error:', err);
      container.innerHTML = '';
      container.appendChild(UI.emptyState('Failed to load page', null, err.message || 'An unexpected error occurred.'));
    }

    // Fade in
    requestAnimationFrame(() => {
      container.style.opacity = '1';
    });

    // Scroll to top
    container.scrollTop = 0;
  }

  function cleanupPage() {
    // Dispose all charts
    if (typeof Charts !== 'undefined') Charts.disposeAll();
    // Unsubscribe WS events for page
    state.wsUnsubscribers.forEach(unsub => {
      try { unsub(); } catch (e) { log('Unsub error:', e); }
    });
    state.wsUnsubscribers = [];
  }

  /**
   * Pages call this to subscribe to WS events; auto-cleaned on navigation
   */
  function subscribeWS(event, callback) {
    if (typeof WebSocketManager === 'undefined') return () => {};
    const unsub = WebSocketManager.on(event, callback);
    state.wsUnsubscribers.push(unsub);
    return unsub;
  }

  // ============================================================
  // Device management
  // ============================================================
  async function loadDevices() {
    try {
      const data = await API.devices.list();
      state.devices = Array.isArray(data) ? data : (data.devices || data.data || []);
      renderDeviceSelector();
    } catch (err) {
      log('Failed to load devices:', err);
      state.devices = [];
      renderDeviceSelector();
    }
  }

  function renderDeviceSelector() {
    const selector = document.getElementById('deviceSelector');
    if (!selector) return;
    selector.innerHTML = '';

    if (state.devices.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No devices registered';
      selector.appendChild(opt);
      return;
    }

    state.devices.forEach(device => {
      const opt = document.createElement('option');
      opt.value = device.id || device.device_id;
      opt.textContent = device.name || device.device_name || device.model || device.id;
      selector.appendChild(opt);
    });

    // Restore selected device or pick first
    if (state.currentDeviceId && state.devices.some(d => (d.id || d.device_id) === state.currentDeviceId)) {
      selector.value = state.currentDeviceId;
    } else {
      state.currentDeviceId = state.devices[0]?.id || state.devices[0]?.device_id || '';
      selector.value = state.currentDeviceId;
    }
  }

  function getCurrentDevice() {
    return state.devices.find(d => (d.id || d.device_id) === state.currentDeviceId) || null;
  }

  // ============================================================
  // WebSocket status indicator
  // ============================================================
  function initWSStatus() {
    const dot = document.getElementById('wsStatusDot');
    const text = document.getElementById('wsStatusText');
    if (!dot || !text) return;

    WebSocketManager.onStatusChange((status) => {
      dot.className = 'status-dot ' + status;
      if (status === 'connected') {
        dot.classList.add('pulse');
        text.textContent = 'Connected';
      } else if (status === 'connecting') {
        dot.classList.add('pulse');
        text.textContent = 'Connecting…';
      } else if (status === 'reconnecting') {
        dot.classList.add('pulse');
        const attempts = WebSocketManager.getReconnectAttempts ? WebSocketManager.getReconnectAttempts() : 0;
        text.textContent = attempts > 0 ? `Reconnecting (attempt ${attempts})…` : 'Reconnecting…';
      } else {
        text.textContent = 'Disconnected';
      }
    });
  }

  // ============================================================
  // User menu
  // ============================================================
  function initUserMenu() {
    const user = Auth.getUser();
    if (user) {
      const name = user.username || 'User';
      const avatar = document.getElementById('userAvatar');
      const nameEl = document.getElementById('userNameText');
      if (avatar) avatar.textContent = name.charAt(0).toUpperCase();
      if (nameEl) nameEl.textContent = name;
    }

    const btn = document.getElementById('userMenuBtn');
    const dropdown = document.getElementById('userMenuDropdown');
    if (btn && dropdown) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('open');
      });
      document.addEventListener('click', () => dropdown.classList.remove('open'));
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => Auth.logout());
    }
  }

  // ============================================================
  // Sidebar toggle
  // ============================================================
  function initSidebarToggle() {
    const layout = document.getElementById('appLayout');
    const collapseBtn = document.getElementById('sidebarCollapseBtn');
    const mobileBtn = document.getElementById('mobileMenuBtn');
    const overlay = document.getElementById('sidebarOverlay');

    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => {
        layout.classList.toggle('sidebar-collapsed');
        state.sidebarCollapsed = layout.classList.contains('sidebar-collapsed');
        localStorage.setItem('mdm_sidebar_collapsed', state.sidebarCollapsed ? '1' : '0');
        // Trigger chart resize
        setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
      });
    }

    if (mobileBtn) {
      mobileBtn.addEventListener('click', () => {
        layout.classList.toggle('sidebar-open');
      });
    }

    if (overlay) {
      overlay.addEventListener('click', () => {
        layout.classList.remove('sidebar-open');
      });
    }

    // Restore collapsed state
    if (localStorage.getItem('mdm_sidebar_collapsed') === '1') {
      layout.classList.add('sidebar-collapsed');
      state.sidebarCollapsed = true;
    }
  }

  // ============================================================
  // Device selector change
  // ============================================================
  function initDeviceSelector() {
    const selector = document.getElementById('deviceSelector');
    if (!selector) return;
    selector.addEventListener('change', () => {
      state.currentDeviceId = selector.value;
      log('Device changed to:', state.currentDeviceId);
      // Re-render current page
      navigate();
    });
  }

  // ============================================================
  // Auto-refresh
  // ============================================================
  function startAutoRefresh() {
    if (state.autoRefreshInterval) clearInterval(state.autoRefreshInterval);
    if (!state.autoRefresh) return;
    state.autoRefreshInterval = setInterval(() => {
      // Only refresh if current page has a refresh function
      const module = pageModules[state.currentRoute];
      if (module && typeof module.refresh === 'function') {
        try { module.refresh(); } catch (e) { log('Auto refresh error:', e); }
      }
    }, 30000); // every 30 seconds
  }

  // ============================================================
  // Init
  // ============================================================
  async function init() {
    // Auth guard
    if (!Auth.requireAuth()) return;

    log('Initializing app…');

    // Render UI
    renderSidebar();
    initSidebarToggle();
    initUserMenu();
    initWSStatus();
    initDeviceSelector();

    // Load devices
    await loadDevices();

    // Connect WebSocket
    WebSocketManager.connect();

    // Setup routing
    window.addEventListener('hashchange', navigate);
    await navigate();

    // Auto refresh
    startAutoRefresh();

    log('App initialized. Route:', state.currentRoute, 'Device:', state.currentDeviceId);
  }

  // ============================================================
  // Public API
  // ============================================================
  return {
    init,
    navigate,
    registerPage,
    subscribeWS,
    get state() { return state; },
    getCurrentDevice,
    loadDevices,
    get currentDeviceId() { return state.currentDeviceId; }
  };
})();

// ============================================================
// Bootstrap
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
