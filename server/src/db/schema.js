const db = require('./database');

/**
 * Initialize all database tables and indexes.
 * 19 tables with proper foreign keys to devices.
 */
function initSchema() {
  db.exec(`
    -- 1. Users
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 2. Devices
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_token TEXT NOT NULL UNIQUE,
      name TEXT,
      model TEXT,
      manufacturer TEXT,
      android_version TEXT,
      app_version TEXT,
      online INTEGER NOT NULL DEFAULT 0,
      last_seen TEXT,
      lat REAL,
      lng REAL,
      location_accuracy REAL,
      location_timestamp TEXT,
      battery INTEGER,
      charging INTEGER DEFAULT 0,
      battery_temp REAL,
      network_type TEXT,
      wifi_ssid TEXT,
      storage_total INTEGER,
      storage_used INTEGER,
      ram_total INTEGER,
      ram_used INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 3. Commands
    CREATE TABLE IF NOT EXISTS commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      result TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 4. Telemetry
    CREATE TABLE IF NOT EXISTS telemetry (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      battery INTEGER,
      charging INTEGER DEFAULT 0,
      battery_temp REAL,
      network_type TEXT,
      wifi_ssid TEXT,
      storage_total INTEGER,
      storage_used INTEGER,
      ram_total INTEGER,
      ram_used INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 5. Locations
    CREATE TABLE IF NOT EXISTS locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      accuracy REAL,
      altitude REAL,
      speed REAL,
      provider TEXT,
      timestamp TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 6. Geofences
    CREATE TABLE IF NOT EXISTS geofences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      radius_meters REAL NOT NULL DEFAULT 100,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 7. Geofence Events
    CREATE TABLE IF NOT EXISTS geofence_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      geofence_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      lat REAL,
      lng REAL,
      timestamp TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE CASCADE,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 8. Notifications
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      package_name TEXT,
      title TEXT,
      text TEXT,
      category TEXT,
      posted_time TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 9. App Usage
    CREATE TABLE IF NOT EXISTS app_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      package_name TEXT NOT NULL,
      app_name TEXT,
      usage_seconds INTEGER DEFAULT 0,
      last_used TEXT,
      date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 10. Contacts
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      name TEXT,
      phone TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, phone),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 11. Calls
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      number TEXT NOT NULL,
      contact_name TEXT,
      call_type TEXT NOT NULL,
      duration_seconds INTEGER DEFAULT 0,
      call_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, number, call_date),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 12. SMS Messages
    CREATE TABLE IF NOT EXISTS sms_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      address TEXT NOT NULL,
      body TEXT,
      message_type TEXT NOT NULL,
      date TEXT,
      thread_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, address, date),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 13. Files (device metadata)
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      file_type TEXT,
      size_bytes INTEGER,
      file_path TEXT,
      mime_type TEXT,
      date_modified TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 14. Media (server-stored uploads)
    CREATE TABLE IF NOT EXISTS media (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      media_type TEXT NOT NULL,
      size_bytes INTEGER,
      server_path TEXT NOT NULL,
      thumbnail_path TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 15. Recordings
    CREATE TABLE IF NOT EXISTS recordings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      filename TEXT,
      duration_seconds INTEGER,
      size_bytes INTEGER,
      server_path TEXT,
      status TEXT DEFAULT 'PENDING',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 16. Permissions
    CREATE TABLE IF NOT EXISTS permissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      permission_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'REQUIRES_USER_ACTION',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, permission_name),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    -- 17. Activity Events
    CREATE TABLE IF NOT EXISTS activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      event_type TEXT NOT NULL,
      description TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_commands_device_id ON commands(device_id);
    CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
    CREATE INDEX IF NOT EXISTS idx_telemetry_device_id ON telemetry(device_id);
    CREATE INDEX IF NOT EXISTS idx_telemetry_created ON telemetry(created_at);
    CREATE INDEX IF NOT EXISTS idx_locations_device_id ON locations(device_id);
    CREATE INDEX IF NOT EXISTS idx_locations_created ON locations(created_at);
    CREATE INDEX IF NOT EXISTS idx_geofences_device_id ON geofences(device_id);
    CREATE INDEX IF NOT EXISTS idx_geofence_events_geofence ON geofence_events(geofence_id);
    CREATE INDEX IF NOT EXISTS idx_geofence_events_device ON geofence_events(device_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_device_id ON notifications(device_id);
    CREATE INDEX IF NOT EXISTS idx_app_usage_device_id ON app_usage(device_id);
    CREATE INDEX IF NOT EXISTS idx_app_usage_date ON app_usage(date);
    CREATE INDEX IF NOT EXISTS idx_contacts_device_id ON contacts(device_id);
    CREATE INDEX IF NOT EXISTS idx_calls_device_id ON calls(device_id);
    CREATE INDEX IF NOT EXISTS idx_sms_device_id ON sms_messages(device_id);
    CREATE INDEX IF NOT EXISTS idx_sms_thread ON sms_messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_files_device_id ON files(device_id);
    CREATE INDEX IF NOT EXISTS idx_media_device_id ON media(device_id);
    CREATE INDEX IF NOT EXISTS idx_recordings_device_id ON recordings(device_id);
    CREATE INDEX IF NOT EXISTS idx_permissions_device_id ON permissions(device_id);
    CREATE INDEX IF NOT EXISTS idx_activity_device_id ON activity_events(device_id);
    CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_events(created_at);
  `);

  // ============================================================
  // Migrations: ALTER TABLE for existing databases
  // ============================================================
  runMigrations();
}

/**
 * Run ALTER TABLE migrations for columns added after initial schema.
 * Checks if columns exist before adding to avoid errors.
 */
function runMigrations() {
  // Helper: check if a column exists in a table
  function columnExists(table, column) {
    try {
      const row = db.prepare(`PRAGMA table_info(${table})`).all();
      return row.some(c => c.name === column);
    } catch (e) {
      return false;
    }
  }

  // Helper: add column if not exists
  function addColumnIfNotExists(table, column, definition) {
    if (!columnExists(table, column)) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        console.log(`[Migration] Added ${table}.${column}`);
      } catch (e) {
        console.error(`[Migration] Failed to add ${table}.${column}:`, e.message);
      }
    }
  }

  // ── Display info columns on devices table ──
  addColumnIfNotExists('devices', 'display_width', 'INTEGER');
  addColumnIfNotExists('devices', 'display_height', 'INTEGER');
  addColumnIfNotExists('devices', 'display_refresh_rate', 'REAL');
  addColumnIfNotExists('devices', 'display_current_mode', 'REAL');
  addColumnIfNotExists('devices', 'display_supported_rates', 'TEXT');
  addColumnIfNotExists('devices', 'display_density', 'INTEGER');
  addColumnIfNotExists('devices', 'display_orientation', 'INTEGER');
  addColumnIfNotExists('devices', 'display_size', 'REAL');

  // ── Display info columns on telemetry table ──
  addColumnIfNotExists('telemetry', 'display_width', 'INTEGER');
  addColumnIfNotExists('telemetry', 'display_height', 'INTEGER');
  addColumnIfNotExists('telemetry', 'display_refresh_rate', 'REAL');
  addColumnIfNotExists('telemetry', 'display_density', 'INTEGER');
  addColumnIfNotExists('telemetry', 'display_orientation', 'INTEGER');

  // ── Remote sessions table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      duration_seconds INTEGER,
      target_fps INTEGER,
      target_quality INTEGER,
      low_latency INTEGER DEFAULT 0,
      frames_sent INTEGER DEFAULT 0,
      avg_latency_ms REAL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_remote_sessions_device ON remote_sessions(device_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_remote_sessions_status ON remote_sessions(status)`);

  // ── Remote quality reports table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS remote_quality_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      session_id TEXT,
      latency_ms INTEGER,
      jitter_ms INTEGER,
      packet_loss_pct REAL,
      fps INTEGER,
      resolution TEXT,
      bitrate_kbps INTEGER,
      network_type TEXT,
      quality INTEGER,
      frame_interval_ms INTEGER,
      low_latency INTEGER DEFAULT 0,
      adjustment_reason TEXT,
      input_latency_ms INTEGER,
      upload_speed_kbps INTEGER,
      download_speed_kbps INTEGER,
      ws_state TEXT,
      reconnection_attempts INTEGER,
      battery_temp REAL,
      battery_level INTEGER,
      cpu_load REAL,
      session_duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  // ── Performance columns on telemetry table ──
  addColumnIfNotExists('telemetry', 'cpu_usage', 'REAL');
  addColumnIfNotExists('telemetry', 'app_memory_mb', 'REAL');
  addColumnIfNotExists('telemetry', 'uptime_seconds', 'INTEGER');
  addColumnIfNotExists('telemetry', 'battery_health', 'TEXT');
  addColumnIfNotExists('telemetry', 'cpu_freq_mhz', 'INTEGER');
  addColumnIfNotExists('telemetry', 'thermal_status', 'TEXT');

  // ── Performance columns on devices table ──
  addColumnIfNotExists('devices', 'cpu_usage', 'REAL');
  addColumnIfNotExists('devices', 'app_memory_mb', 'REAL');
  addColumnIfNotExists('devices', 'uptime_seconds', 'INTEGER');
  addColumnIfNotExists('devices', 'battery_health', 'TEXT');
  addColumnIfNotExists('devices', 'cpu_freq_mhz', 'INTEGER');
  addColumnIfNotExists('devices', 'thermal_status', 'TEXT');

  // ── File transfers table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS file_transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      transfer_id TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      size_bytes INTEGER,
      mime_type TEXT,
      checksum TEXT,
      uploaded_chunks INTEGER DEFAULT 0,
      total_chunks INTEGER DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING',
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_device ON file_transfers(device_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transfers_status ON file_transfers(status)`);

  // ── Transfer chunks table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS transfer_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transfer_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      checksum TEXT,
      size_bytes INTEGER,
      received_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(transfer_id, chunk_index)
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_transfer_chunks_tid ON transfer_chunks(transfer_id)`);

  // ── Snapshots table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_device ON snapshots(device_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_created ON snapshots(created_at)`);

  // ── Diagnostic results table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagnostic_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER,
      results TEXT NOT NULL,
      overall_status TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_diagnostics_device ON diagnostic_results(device_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_diagnostics_created ON diagnostic_results(created_at)`);

  // ── Connection events table ──
  db.exec(`
    CREATE TABLE IF NOT EXISTS connection_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      reason TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conn_events_device ON connection_events(device_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conn_events_ts ON connection_events(timestamp)`);
}

module.exports = { initSchema };
