/**
 * map.js — Leaflet map initialization + helpers
 * Android MDM Dashboard
 */
const MapHelper = (function () {
  'use strict';

  const DEBUG = false;
  function log(...args) { if (DEBUG) console.log('[Map]', ...args); }

  const instances = new Map();

  /**
   * Initialize a Leaflet map on a container
   */
  function init(containerId, options = {}) {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) {
      log('Container not found:', containerId);
      return null;
    }
    if (typeof L === 'undefined') {
      log('Leaflet not loaded');
      container.innerHTML = '<div class="empty-state"><div class="empty-state-title">Map library not loaded</div></div>';
      return null;
    }

    // Destroy existing
    if (instances.has(container)) {
      instances.get(container).map.remove();
    }

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      ...options
    });

    // OpenStreetMap tiles (dark friendly)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    // Default view
    map.setView([20, 0], 2);

    const instance = {
      map,
      markers: [],
      circles: [],
      polylines: []
    };
    instances.set(container, instance);
    return instance;
  }

  /**
   * Add a device location marker with accuracy circle
   */
  function addDeviceMarker(instance, lat, lng, options = {}) {
    if (!instance || !instance.map) return null;

    // Remove existing device marker
    if (instance.deviceMarker) {
      instance.map.removeLayer(instance.deviceMarker);
    }
    if (instance.accuracyCircle) {
      instance.map.removeLayer(instance.accuracyCircle);
    }

    // Custom device icon
    const icon = L.divIcon({
      className: 'device-marker-wrapper',
      html: `
        <div style="position: relative;">
          <div style="width: 20px; height: 20px; background: #3b82f6; border: 3px solid white; border-radius: 50%; box-shadow: 0 2px 8px rgba(59,130,246,0.5);"></div>
          <div style="position: absolute; inset: -6px; border-radius: 50%; border: 2px solid #3b82f6; opacity: 0.4; animation: map-pulse 2s ease-out infinite;"></div>
        </div>
        <style>@keyframes map-pulse { 0% { transform: scale(0.8); opacity: 0.6; } 100% { transform: scale(1.8); opacity: 0; } }</style>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });

    const marker = L.marker([lat, lng], { icon }).addTo(instance.map);
    if (options.popup) {
      marker.bindPopup(options.popup);
    }
    instance.deviceMarker = marker;

    // Accuracy circle
    if (options.accuracy) {
      const circle = L.circle([lat, lng], {
        radius: options.accuracy,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.1,
        weight: 1
      }).addTo(instance.map);
      instance.accuracyCircle = circle;
    }

    // Pan to location
    instance.map.setView([lat, lng], options.zoom || 15);
    return marker;
  }

  /**
   * Add a geofence circle
   */
  function addGeofence(instance, lat, lng, radius, options = {}) {
    if (!instance || !instance.map) return null;
    const color = options.color || '#10b981';
    const circle = L.circle([lat, lng], {
      radius: radius,
      color: color,
      fillColor: color,
      fillOpacity: 0.12,
      weight: 2,
      dashArray: options.dashed ? '6,4' : null
    }).addTo(instance.map);

    if (options.name) {
      const label = L.tooltip({
        permanent: true,
        direction: 'center',
        className: 'geofence-label',
        style: { background: 'transparent', border: 'none', color: color, fontWeight: '600', fontSize: '12px', textShadow: '0 1px 3px rgba(0,0,0,0.8)' }
      }).setContent(options.name).setLatLng([lat, lng]);
      circle.bindTooltip(label);
    }

    instance.circles.push(circle);
    return circle;
  }

  /**
   * Clear all geofences
   */
  function clearGeofences(instance) {
    if (!instance) return;
    instance.circles.forEach(c => instance.map.removeLayer(c));
    instance.circles = [];
  }

  /**
   * Draw a location history path polyline
   */
  function drawPath(instance, coordinates, options = {}) {
    if (!instance || !instance.map || !coordinates || coordinates.length === 0) return null;
    if (instance.pathPolyline) {
      instance.map.removeLayer(instance.pathPolyline);
    }
    const latlngs = coordinates.map(c => [c.lat || c[0], c.lng || c.latitude || c[1]]);
    const polyline = L.polyline(latlngs, {
      color: options.color || '#3b82f6',
      weight: 3,
      opacity: 0.8,
      dashArray: options.dashed ? '6,4' : null
    }).addTo(instance.map);

    // Add start/end markers
    if (options.showMarkers && latlngs.length > 1) {
      L.circleMarker(latlngs[0], { radius: 6, color: '#10b981', fillColor: '#10b981', fillOpacity: 1, weight: 2 }).addTo(instance.map).bindTooltip('Start');
      L.circleMarker(latlngs[latlngs.length - 1], { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1, weight: 2 }).addTo(instance.map).bindTooltip('End');
    }

    instance.map.fitBounds(polyline.getBounds(), { padding: [40, 40] });
    instance.pathPolyline = polyline;
    return polyline;
  }

  /**
   * Remove path
   */
  function clearPath(instance) {
    if (instance && instance.pathPolyline) {
      instance.map.removeLayer(instance.pathPolyline);
      instance.pathPolyline = null;
    }
  }

  /**
   * Enable click-to-set-location mode, returns promise of [lat, lng]
   */
  function pickLocation(instance) {
    return new Promise((resolve) => {
      if (!instance || !instance.map) {
        resolve(null);
        return;
      }
      const map = instance.map;
      map.getContainer().style.cursor = 'crosshair';

      function onClick(e) {
        map.off('click', onClick);
        map.getContainer().style.cursor = '';
        resolve([e.latlng.lat, e.latlng.lng]);
      }
      map.on('click', onClick);
    });
  }

  /**
   * Destroy a map instance
   */
  function destroy(containerId) {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (container && instances.has(container)) {
      instances.get(container).map.remove();
      instances.delete(container);
    }
  }

  return {
    init,
    addDeviceMarker,
    addGeofence,
    clearGeofences,
    drawPath,
    clearPath,
    pickLocation,
    destroy
  };
})();
