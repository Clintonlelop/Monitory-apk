/**
 * pages/location.js — Location tracking page
 * Full-screen Leaflet map, location details, history, geofence visualization
 */
(function () {
  'use strict';

  let mapInstance = null;
  let showHistory = false;

  async function init(container) {
    const deviceId = App.currentDeviceId;
    container.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Location</h1>
          <p class="page-subtitle">Real-time device location and history tracking</p>
        </div>
        <div class="page-actions">
          <label class="location-history-toggle">
            <span class="toggle-switch">
              <input type="checkbox" id="toggleHistory">
              <span class="toggle-slider"></span>
            </span>
            Show history path
          </label>
          <button class="btn btn-primary btn-sm" id="btnRefreshLocation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            Refresh Location
          </button>
        </div>
      </div>
      <div id="locationContent">
        <div class="loading-container"><div class="loading-spinner"></div><span>Loading location data…</span></div>
      </div>
    `;

    if (!deviceId) {
      document.getElementById('locationContent').innerHTML = '';
      document.getElementById('locationContent').appendChild(
        UI.emptyState('No device selected', null, 'Select a device to view its location.')
      );
      return;
    }

    document.getElementById('btnRefreshLocation').addEventListener('click', () => {
      API.commands.create(deviceId, 'GET_LOCATION', {}).then(() => {
        UI.showToast('Location request sent to device', 'success');
      }).catch(() => {});
    });

    document.getElementById('toggleHistory').addEventListener('change', (e) => {
      showHistory = e.target.checked;
      loadLocation();
    });

    await loadLocation();

    App.subscribeWS('LOCATION_UPDATED', () => loadLocation());
  }

  async function loadLocation() {
    const deviceId = App.currentDeviceId;
    const content = document.getElementById('locationContent');
    if (!content || !deviceId) return;

    try {
      const [locationsRes, geofencesRes] = await Promise.allSettled([
        API.locations.list(deviceId, { limit: 100 }),
        API.geofences.list({ device_id: deviceId })
      ]);

      const locations = locationsRes.status === 'fulfilled' ? (locationsRes.value.data || locationsRes.value) : [];
      const geofences = geofencesRes.status === 'fulfilled' ? (geofencesRes.value.data || geofencesRes.value) : [];
      const latest = Array.isArray(locations) && locations.length > 0 ? locations[0] : null;

      content.innerHTML = `
        <!-- Map -->
        <div class="location-map-container" id="locationMap" style="margin-bottom: 16px;"></div>

        ${latest ? `
        <!-- Location Details -->
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-header">
            <div class="card-title">Location Details</div>
            <span class="badge badge-success">Updated ${UI.formatDateString(latest.timestamp || latest.created_at)}</span>
          </div>
          <div class="card-body">
            <div class="location-details-panel">
              ${locationDetail('Latitude', latest.lat != null ? latest.lat.toFixed(6) : (latest.latitude || '—'))}
              ${locationDetail('Longitude', latest.lng != null ? latest.lng.toFixed(6) : (latest.longitude || '—'))}
              ${locationDetail('Accuracy', latest.accuracy != null ? latest.accuracy + ' m' : '—')}
              ${locationDetail('Altitude', latest.altitude != null ? latest.altitude + ' m' : '—')}
              ${locationDetail('Speed', latest.speed != null ? (latest.speed * 3.6).toFixed(1) + ' km/h' : '—')}
              ${locationDetail('Provider', latest.provider || '—')}
              ${locationDetail('Bearing', latest.bearing != null ? latest.bearing + '°' : '—')}
              ${locationDetail('Timestamp', UI.formatDateString(latest.timestamp || latest.created_at))}
            </div>
          </div>
        </div>
        ` : `
        <div class="card" style="margin-bottom: 16px;">
          <div class="card-body">
            <div class="empty-state">
              <div class="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
              </div>
              <div class="empty-state-title">No location data yet</div>
              <div class="empty-state-desc">Click "Refresh Location" to request the device's current location. Make sure location permission is granted on the device.</div>
            </div>
          </div>
        </div>
        `}

        <!-- Location History Table -->
        <div class="card">
          <div class="card-header">
            <div class="card-title">Location History</div>
            <span class="text-muted" style="font-size: 12px;">${locations.length} records</span>
          </div>
          <div class="card-body no-padding">
            ${locations.length > 0 ? renderHistoryTable(locations) : '<div class="empty-state"><div class="empty-state-title">No history</div></div>'}
          </div>
        </div>
      `;

      // Initialize map
      setTimeout(() => initMap(latest, locations, geofences), 50);

    } catch (err) {
      content.innerHTML = '';
      content.appendChild(UI.emptyState('Failed to load location', null, err.message));
    }
  }

  function initMap(latest, locations, geofences) {
    const el = document.getElementById('locationMap');
    if (!el || typeof L === 'undefined') return;

    if (mapInstance) {
      try { mapInstance.map.remove(); } catch (e) {}
    }
    mapInstance = MapHelper.init(el);

    if (!mapInstance) return;

    // Draw geofences
    geofences.forEach(gf => {
      MapHelper.addGeofence(mapInstance, gf.lat || gf.latitude, gf.lng || gf.longitude, gf.radius || 100, {
        name: gf.name,
        color: '#10b981'
      });
    });

    // Draw history path
    if (showHistory && locations.length > 1) {
      MapHelper.drawPath(mapInstance, locations, { showMarkers: true });
    }

    // Add current location marker
    if (latest) {
      MapHelper.addDeviceMarker(mapInstance, latest.lat || latest.latitude, latest.lng || latest.longitude, {
        accuracy: latest.accuracy,
        popup: `<div style="font-size: 12px;"><strong>Device Location</strong><br>Accuracy: ${latest.accuracy || '?'}m<br>${UI.formatDateString(latest.timestamp || latest.created_at)}</div>`
      });
    } else if (geofences.length > 0) {
      const gf = geofences[0];
      mapInstance.map.setView([gf.lat || gf.latitude, gf.lng || gf.longitude], 13);
    }
  }

  function locationDetail(label, value) {
    return `
      <div class="location-detail-item">
        <div class="location-detail-label">${label}</div>
        <div class="location-detail-value">${value}</div>
      </div>
    `;
  }

  function renderHistoryTable(locations) {
    const headers = [
      { label: '#', key: 'idx', sortable: false },
      { label: 'Latitude', key: 'lat' },
      { label: 'Longitude', key: 'lng' },
      { label: 'Accuracy', key: 'accuracy' },
      { label: 'Provider', key: 'provider' },
      { label: 'Timestamp', key: 'timestamp' }
    ];
    const rows = locations.map((loc, i) => ({
      idx: i + 1,
      lat: loc.lat != null ? loc.lat.toFixed(6) : (loc.latitude || '—'),
      lng: loc.lng != null ? loc.lng.toFixed(6) : (loc.longitude || '—'),
      accuracy: loc.accuracy != null ? loc.accuracy + ' m' : '—',
      provider: loc.provider || '—',
      timestamp: UI.formatDateString(loc.timestamp || loc.created_at)
    }));
    const table = UI.createTable(headers, rows);
    const wrapper = document.createElement('div');
    wrapper.style.overflowX = 'auto';
    wrapper.appendChild(table);
    return wrapper.outerHTML;
  }

  const module = { init, refresh: loadLocation };
  App.registerPage('location', module);
})();
