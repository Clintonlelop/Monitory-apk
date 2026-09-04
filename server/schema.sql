-- Android Remote Device Management Database Schema
-- Compatible with PostgreSQL 14+

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(100) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    device_name VARCHAR(150) NOT NULL,
    manufacturer VARCHAR(100),
    model VARCHAR(100),
    os_version VARCHAR(50),
    sdk_version INTEGER,
    app_version VARCHAR(50),
    auth_token VARCHAR(255),
    status VARCHAR(20) DEFAULT 'OFFLINE', -- 'ONLINE', 'OFFLINE'
    battery_level INTEGER DEFAULT 0,
    is_charging BOOLEAN DEFAULT FALSE,
    storage_available BIGINT DEFAULT 0,
    storage_total BIGINT DEFAULT 0,
    ram_available BIGINT DEFAULT 0,
    ram_total BIGINT DEFAULT 0,
    network_type VARCHAR(50),
    wifi_ssid VARCHAR(100),
    uptime_millis BIGINT DEFAULT 0,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pairing_codes (
    id SERIAL PRIMARY KEY,
    code VARCHAR(10) UNIQUE NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS device_permissions (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(100) UNIQUE REFERENCES devices(id) ON DELETE CASCADE,
    location BOOLEAN DEFAULT FALSE,
    notification_access BOOLEAN DEFAULT FALSE,
    files_access BOOLEAN DEFAULT FALSE,
    camera BOOLEAN DEFAULT FALSE,
    microphone BOOLEAN DEFAULT FALSE,
    usage_access BOOLEAN DEFAULT FALSE,
    screen_sharing BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locations (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    accuracy REAL,
    altitude DOUBLE PRECISION,
    speed REAL,
    provider VARCHAR(50),
    timestamp BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_locations_device_time ON locations(device_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS notifications (
    id VARCHAR(100) PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    package_name VARCHAR(255) NOT NULL,
    app_name VARCHAR(255) NOT NULL,
    title TEXT,
    text TEXT,
    category VARCHAR(100),
    post_time BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_device_time ON notifications(device_id, post_time DESC);

CREATE TABLE IF NOT EXISTS applications (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    package_name VARCHAR(255) NOT NULL,
    app_name VARCHAR(255) NOT NULL,
    version_name VARCHAR(100),
    version_code BIGINT,
    is_system_app BOOLEAN DEFAULT FALSE,
    first_install_time BIGINT,
    last_update_time BIGINT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_device_pkg UNIQUE (device_id, package_name)
);

CREATE TABLE IF NOT EXISTS usage_statistics (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    package_name VARCHAR(255) NOT NULL,
    app_name VARCHAR(255),
    total_time_ms BIGINT NOT NULL,
    last_time_used BIGINT,
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS files (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type VARCHAR(100),
    is_directory BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS recordings (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    duration_ms BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commands (
    id VARCHAR(100) PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    command_type VARCHAR(100) NOT NULL,
    parameters JSONB,
    status VARCHAR(50) DEFAULT 'PENDING', -- 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
    result TEXT,
    error_message TEXT,
    timestamp BIGINT NOT NULL,
    completion_timestamp BIGINT
);

CREATE INDEX IF NOT EXISTS idx_commands_device ON commands(device_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS alerts (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE CASCADE,
    type VARCHAR(100) NOT NULL, -- 'OFFLINE', 'LOW_BATTERY', 'PERMISSION_REVOKED', 'STORAGE_FULL'
    message TEXT NOT NULL,
    severity VARCHAR(20) DEFAULT 'INFO', -- 'INFO', 'WARNING', 'CRITICAL'
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    device_id VARCHAR(100) REFERENCES devices(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    details JSONB,
    ip_address VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(created_at DESC);
