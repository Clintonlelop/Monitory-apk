const express = require('express');
const db = require('../db/database');
const auth = require('../middleware/auth');
const deviceAuth = require('../middleware/deviceAuth');
const wsManager = require('../ws/manager');

const router = express.Router();

// POST /api/telemetry - device sends telemetry (device auth)
router.post('/telemetry', deviceAuth, (req, res) => {
  try {
    const device = req.device;
    const {
      battery, charging, battery_temp, network_type, wifi_ssid,
      storage_total, storage_used, ram_total, ram_used, display,
      performance
    } = req.body;

    // Parse display info
    const displayWidth = display?.resolution_width != null ? parseInt(display.resolution_width) : null;
    const displayHeight = display?.resolution_height != null ? parseInt(display.resolution_height) : null;
    const displayRefreshRate = display?.refresh_rate != null ? parseFloat(display.refresh_rate) : null;
    const displayDensity = display?.density_dpi != null ? parseInt(display.density_dpi) : null;
    const displayOrientation = display?.orientation != null ? parseInt(display.orientation) : null;

    // Parse performance data
    const cpuUsage = performance?.cpu_usage_pct != null ? parseFloat(performance.cpu_usage_pct) : null;
    const appMemoryMb = performance?.app_memory_mb != null ? parseFloat(performance.app_memory_mb) : null;
    const uptimeSeconds = performance?.uptime_seconds != null ? parseInt(performance.uptime_seconds) : null;
    const batteryHealth = performance?.battery_health || null;
    const cpuFreqMhz = performance?.cpu_freq_mhz != null ? parseInt(performance.cpu_freq_mhz) : null;
    const thermalStatus = performance?.thermal_status || null;

    db.prepare(`INSERT INTO telemetry
        (device_id, battery, charging, battery_temp, network_type, wifi_ssid,
         storage_total, storage_used, ram_total, ram_used,
         display_width, display_height, display_refresh_rate, display_density, display_orientation,
         cpu_usage, app_memory_mb, uptime_seconds, battery_health, cpu_freq_mhz, thermal_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(
        device.id,
        battery != null ? parseInt(battery) : null,
        charging ? 1 : 0,
        battery_temp != null ? parseFloat(battery_temp) : null,
        network_type || null,
        wifi_ssid || null,
        storage_total != null ? parseInt(storage_total) : null,
        storage_used != null ? parseInt(storage_used) : null,
        ram_total != null ? parseInt(ram_total) : null,
        ram_used != null ? parseInt(ram_used) : null,
        displayWidth, displayHeight, displayRefreshRate, displayDensity, displayOrientation,
        cpuUsage, appMemoryMb, uptimeSeconds, batteryHealth, cpuFreqMhz, thermalStatus
      );

    db.prepare(`UPDATE devices SET
        battery = ?, charging = ?, battery_temp = ?, network_type = ?, wifi_ssid = ?,
        storage_total = ?, storage_used = ?, ram_total = ?, ram_used = ?,
        display_width = COALESCE(?, display_width),
        display_height = COALESCE(?, display_height),
        display_refresh_rate = COALESCE(?, display_refresh_rate),
        display_density = COALESCE(?, display_density),
        display_orientation = COALESCE(?, display_orientation),
        cpu_usage = COALESCE(?, cpu_usage),
        app_memory_mb = COALESCE(?, app_memory_mb),
        uptime_seconds = COALESCE(?, uptime_seconds),
        battery_health = COALESCE(?, battery_health),
        cpu_freq_mhz = COALESCE(?, cpu_freq_mhz),
        thermal_status = COALESCE(?, thermal_status),
        last_seen = datetime('now')
      WHERE id = ?`)
      .run(
        battery != null ? parseInt(battery) : device.battery,
        charging ? 1 : (device.charging || 0),
        battery_temp != null ? parseFloat(battery_temp) : device.battery_temp,
        network_type || device.network_type,
        wifi_ssid != null ? wifi_ssid : device.wifi_ssid,
        storage_total != null ? parseInt(storage_total) : device.storage_total,
        storage_used != null ? parseInt(storage_used) : device.storage_used,
        ram_total != null ? parseInt(ram_total) : device.ram_total,
        ram_used != null ? parseInt(ram_used) : device.ram_used,
        displayWidth, displayHeight, displayRefreshRate, displayDensity, displayOrientation,
        cpuUsage, appMemoryMb, uptimeSeconds, batteryHealth, cpuFreqMhz, thermalStatus,
        device.id
      );

    wsManager.broadcastToDashboards(wsManager.buildEvent('TELEMETRY_UPDATED', device.id, {
      battery, charging, battery_temp, network_type, wifi_ssid,
      storage_total, storage_used, ram_total, ram_used, display,
      performance: performance || null
    }));

    res.status(201).json({ success: true, message: 'Telemetry recorded' });
  } catch (err) {
    console.error('Telemetry error:', err.message);
    res.status(500).json({ error: 'Server error recording telemetry' });
  }
});

// GET /api/devices/:id/performance - performance history for charts (dashboard auth)
router.get('/devices/:deviceId/performance', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { hours = 24 } = req.query;
    const h = Math.min(parseInt(hours) || 24, 168);

    const telemetry = db.prepare(`
      SELECT created_at, cpu_usage, app_memory_mb, uptime_seconds,
             battery_health, cpu_freq_mhz, thermal_status,
             battery, charging, battery_temp,
             storage_total, storage_used, ram_total, ram_used,
             network_type, display_refresh_rate
      FROM telemetry
      WHERE device_id = ? AND created_at >= datetime('now', ?)
      ORDER BY created_at ASC
    `).all(deviceId, `-${h} hours`);

    // Get latest device performance values
    const device = db.prepare(`
      SELECT cpu_usage, app_memory_mb, uptime_seconds, battery_health,
             cpu_freq_mhz, thermal_status, display_refresh_rate
      FROM devices WHERE id = ?
    `).get(deviceId);

    res.json({
      latest: device || {},
      history: telemetry
    });
  } catch (err) {
    console.error('Get performance error:', err.message);
    res.status(500).json({ error: 'Server error fetching performance data' });
  }
});

// GET /api/devices/:id/telemetry - telemetry history (dashboard auth)
router.get('/devices/:deviceId/telemetry', auth, (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 100, hours } = req.query;
    const lim = Math.min(parseInt(limit) || 100, 1000);

    let query = 'SELECT * FROM telemetry WHERE device_id = ?';
    const params = [deviceId];

    if (hours) {
      query += ` AND created_at >= datetime('now', ?)`;
      params.push(`-${parseInt(hours)} hours`);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(lim);

    const telemetry = db.prepare(query).all(...params);
    res.json(telemetry);
  } catch (err) {
    console.error('Get telemetry error:', err.message);
    res.status(500).json({ error: 'Server error fetching telemetry' });
  }
});

module.exports = router;
