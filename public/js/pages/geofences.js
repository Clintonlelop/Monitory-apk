/**
 * pages/geofences.js — Geofence management page
 * Map with geofence circles, list, add/edit/delete, events log
 */
(function () {
  'use strict';

  let geofences = [];
  let geofenceEvents = [];
  let mapInstance = null;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Geofences</h1>
          <p class="page-subtitle">Geographic boundary monitoring and alerts</p>
        </div>
        <div class="page-actions">
          <button class="btn btn-primary btn-sm" id="btnAddGeofence">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            Add Geofence
          </button>
        </div>
      </div>
      <div class="grid grid-2" style="margin-bottom: 16px;">
        <div class="card">
          <div class="card-header"><div class="card-title">Geofence Map</div></div>
          <div class="card-body no-padding">
            <div class="geofence-map-container" id="geofenceMap"></div>
          </div>
        </div>
        <div class="card">
          <div class="card-header">
            <div class="card-title">Geofences</div>
            <span class="text-muted" style="font-size: 12px;" id="gfCount"></span>
          </div>
          <div class="card-body no-padding">
            <div id="geofenceList" style="max-height: 360px; overflow-y: auto;">
              <div class="loading-container"><div class="loading-spinner"></div></div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><div class="card-title">Geofence Events</div></div>
        <div class="card-body no-padding">
          <div id="geofenceEventsList" class="geofence-events-list" style="padding: 0 18px;">
            <div class="loading-container"><div class="loading-spinner"></div></div>
          </div>
        </div>
      </div>
    `;

    if (!deviceId) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-title">No device selected</div></div>';
      return;
    }

    document.getElementById('btnAddGeofence').addEventListener('click', () => showAddGeofenceModal());

    await Promise.all([loadGeofences(), loadEvents()]);

    App.subscribeWS('GEOFENCE_EVENT', (data) => {
      geofenceEvents.unshift(data);
      renderEvents();
      UI.showToast(`Geofence ${data.action || ''}: ${data.geofence_name || ''}`, 'info');
    });
  }

  async function loadGeofences() {
    const deviceId = App.currentDeviceId;
    try {
      const res = await API.geofences.list({ device_id: deviceId });
      geofences = res.data || res || [];
      renderGeofenceList();
      setTimeout(initMap, 50);
    } catch (err) {
      document.getElementById('geofenceList').innerHTML = '';
      document.getElementById('geofenceList').appendChild(UI.emptyState('Failed to load geofences', null, err.message));
    }
  }

  async function loadEvents() {
    const deviceId = App.currentDeviceId;
    try {
      const res = await API.geofences.events({ device_id: deviceId, limit: 100 });
      geofenceEvents = res.data || res || [];
      renderEvents();
    } catch (err) {
      document.getElementById('geofenceEventsList').innerHTML = '';
      document.getElementById('geofenceEventsList').appendChild(
        UI.emptyState('Failed to load events', null, err.message)
      );
    }
  }

  function initMap() {
    const el = document.getElementById('geofenceMap');
    if (!el || typeof L === 'undefined') return;
    if (mapInstance) {
      try { mapInstance.map.remove(); } catch (e) {}
    }
    mapInstance = MapHelper.init(el);
    if (!mapInstance) return;

    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
    geofences.forEach((gf, i) => {
      MapHelper.addGeofence(mapInstance, gf.lat || gf.latitude, gf.lng || gf.longitude, gf.radius || 100, {
        name: gf.name,
        color: colors[i % colors.length]
      });
    });

    if (geofences.length > 0) {
      const gf = geofences[0];
      mapInstance.map.setView([gf.lat || gf.latitude, gf.lng || gf.longitude], 13);
    }
  }

  function renderGeofenceList() {
    const listEl = document.getElementById('geofenceList');
    const countEl = document.getElementById('gfCount');
    if (!listEl) return;
    if (countEl) countEl.textContent = geofences.length + ' geofences';

    if (geofences.length === 0) {
      listEl.innerHTML = '';
      listEl.appendChild(UI.emptyState(
        'No geofences configured',
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line></svg>',
        'Click "Add Geofence" to create a geographic boundary.'
      ));
      return;
    }

    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
    listEl.innerHTML = '';
    geofences.forEach((gf, i) => {
      const item = document.createElement('div');
      item.className = 'geofence-list-item';
      item.innerHTML = `
        <div class="geofence-color-dot" style="background: ${colors[i % colors.length]};"></div>
        <div class="geofence-info">
          <div class="geofence-name">${UI.escapeHtml(gf.name || 'Unnamed')}</div>
          <div class="geofence-coords">${(gf.lat || gf.latitude || 0).toFixed(4)}, ${(gf.lng || gf.longitude || 0).toFixed(4)} • Radius: ${gf.radius || 100}m</div>
        </div>
        <div class="geofence-actions">
          <button class="btn btn-secondary btn-sm btn-icon" data-action="edit" title="Edit">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
          </button>
          <button class="btn btn-secondary btn-sm btn-icon" data-action="delete" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;
      item.querySelector('[data-action="edit"]').addEventListener('click', () => showEditGeofenceModal(gf));
      item.querySelector('[data-action="delete"]').addEventListener('click', async () => {
        const confirmed = await UI.confirmDialog(`Delete geofence "${gf.name || 'Unnamed'}"?`);
        if (confirmed) {
          try {
            await API.geofences.delete(gf.id);
            UI.showToast('Geofence deleted', 'success');
            loadGeofences();
          } catch (err) {
            UI.showToast('Failed to delete: ' + err.message, 'error');
          }
        }
      });
      listEl.appendChild(item);
    });
  }

  function renderEvents() {
    const listEl = document.getElementById('geofenceEventsList');
    if (!listEl) return;
    if (geofenceEvents.length === 0) {
      listEl.innerHTML = '';
      listEl.appendChild(UI.emptyState('No geofence events yet', null, 'Enter/exit events will appear here.'));
      return;
    }
    listEl.innerHTML = '';
    geofenceEvents.slice(0, 50).forEach(evt => {
      const item = document.createElement('div');
      item.className = 'geofence-event-item';
      const isEnter = (evt.action || '').toUpperCase() === 'ENTER';
      item.innerHTML = `
        <span class="badge ${isEnter ? 'badge-success' : 'badge-warning'}">${evt.action || 'EVENT'}</span>
        <span style="flex: 1;">${UI.escapeHtml(evt.geofence_name || evt.geofence_id || 'Unknown')}</span>
        <span class="text-mono" style="font-size: 11px;">${UI.escapeHtml(evt.device_id || '')}</span>
        <span class="text-muted" style="font-size: 12px;">${UI.formatDateString(evt.timestamp || evt.created_at)}</span>
      `;
      listEl.appendChild(item);
    });
  }

  async function showAddGeofenceModal() {
    const deviceId = App.currentDeviceId;
    const formHtml = `
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-input" id="gfName" placeholder="e.g. Home, Office">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Latitude</label>
          <input class="form-input" id="gfLat" type="number" step="0.000001" placeholder="0.000000">
        </div>
        <div class="form-group">
          <label class="form-label">Longitude</label>
          <input class="form-input" id="gfLng" type="number" step="0.000001" placeholder="0.000000">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Radius (meters)</label>
        <input class="form-input" id="gfRadius" type="number" value="100" min="10">
      </div>
      <div class="form-hint">Click on the map after creating to adjust position, or enter coordinates manually.</div>
    `;
    const result = await UI.showModal('Add Geofence', formHtml, {
      buttons: [
        { text: 'Cancel', class: 'btn-secondary', value: null },
        { text: 'Create', class: 'btn-primary', value: 'create' }
      ]
    });
    if (result !== 'create') return;

    const name = document.getElementById('gfName')?.value.trim();
    const lat = parseFloat(document.getElementById('gfLat')?.value);
    const lng = parseFloat(document.getElementById('gfLng')?.value);
    const radius = parseInt(document.getElementById('gfRadius')?.value) || 100;

    if (!name || isNaN(lat) || isNaN(lng)) {
      UI.showToast('Please fill in all fields', 'error');
      return;
    }

    try {
      await API.geofences.create({ name, lat, lng, radius, device_id: deviceId });
      UI.showToast('Geofence created', 'success');
      loadGeofences();
    } catch (err) {
      UI.showToast('Failed to create: ' + err.message, 'error');
    }
  }

  async function showEditGeofenceModal(gf) {
    const formHtml = `
      <div class="form-group">
        <label class="form-label">Name</label>
        <input class="form-input" id="gfName" value="${UI.escapeHtml(gf.name || '')}">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Latitude</label>
          <input class="form-input" id="gfLat" type="number" step="0.000001" value="${gf.lat || gf.latitude || 0}">
        </div>
        <div class="form-group">
          <label class="form-label">Longitude</label>
          <input class="form-input" id="gfLng" type="number" step="0.000001" value="${gf.lng || gf.longitude || 0}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Radius (meters)</label>
        <input class="form-input" id="gfRadius" type="number" value="${gf.radius || 100}" min="10">
      </div>
    `;
    const result = await UI.showModal('Edit Geofence', formHtml, {
      buttons: [
        { text: 'Cancel', class: 'btn-secondary', value: null },
        { text: 'Save', class: 'btn-primary', value: 'save' }
      ]
    });
    if (result !== 'save') return;

    try {
      await API.geofences.update(gf.id, {
        name: document.getElementById('gfName')?.value,
        lat: parseFloat(document.getElementById('gfLat')?.value),
        lng: parseFloat(document.getElementById('gfLng')?.value),
        radius: parseInt(document.getElementById('gfRadius')?.value)
      });
      UI.showToast('Geofence updated', 'success');
      loadGeofences();
    } catch (err) {
      UI.showToast('Failed to update: ' + err.message, 'error');
    }
  }

  const module = { init, refresh: () => { loadGeofences(); loadEvents(); } };
  App.registerPage('geofences', module);
})();
