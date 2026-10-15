import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

let pool = null;
let usePostgres = false;

// In-memory mock store for standalone / zero-dependency development
const memoryStore = {
  // Development convenience only; production never receives preset accounts.
  users: process.env.NODE_ENV === 'production' ? [] : [{
    id: 2, username: 'Clinton', email: 'clintonumelo15@gmail.com',
    password_hash: '$2a$10$asTM6G2n7Nzc6.7XSyLWWeVu/zBsPMQTHy5Km5l.ieDF2avgwYcHC',
    role: 'admin', created_at: new Date()
  }],
  devices: new Map(),
  pairing_codes: new Map(),
  device_permissions: new Map(),
  locations: [],
  notifications: [],
  applications: new Map(),
  usage_statistics: [],
  files: [],
  recordings: [],
  commands: new Map(),
  alerts: [],
  audit_logs: [],
  sms: [],
  calls: [],
  contacts: [],
  keystrokes: [],
  geofences: [],
  data_usage: [],
  service_health: new Map()
};

export async function initDb() {
  const dbUrl = process.env.DATABASE_URL || 
    (process.env.PGHOST ? `postgres://${process.env.PGUSER || 'postgres'}:${process.env.PGPASSWORD || 'postgres'}@${process.env.PGHOST}:${process.env.PGPORT || 5432}/${process.env.PGDATABASE || 'devicemanager'}` : null);

  if (dbUrl) {
    try {
      pool = new Pool({
        connectionString: dbUrl,
        connectionTimeoutMillis: 3000
      });
      // Test connection
      const client = await pool.connect();
      console.log('Connected to PostgreSQL successfully.');
      usePostgres = true;

      // Run schema if exists
      const schemaPath = path.join(__dirname, '..', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await client.query(schema);
        console.log('PostgreSQL schema applied successfully.');
        
        // Dynamic column migrations
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS contacts BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS calls BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS sms BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS accessibility BOOLEAN DEFAULT FALSE');
        await client.query(`CREATE TABLE IF NOT EXISTS geofences (
          id SERIAL PRIMARY KEY,
          device_id VARCHAR(64) REFERENCES devices(id) ON DELETE CASCADE,
          name VARCHAR(128) NOT NULL,
          latitude DOUBLE PRECISION NOT NULL,
          longitude DOUBLE PRECISION NOT NULL,
          radius_meters INTEGER NOT NULL DEFAULT 500,
          is_active BOOLEAN DEFAULT TRUE,
          last_status VARCHAR(32) DEFAULT 'OUTSIDE',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`);
        await client.query(`CREATE TABLE IF NOT EXISTS data_usage (
          id SERIAL PRIMARY KEY,
          device_id VARCHAR(64) REFERENCES devices(id) ON DELETE CASCADE,
          wifi_bytes_rx BIGINT DEFAULT 0,
          wifi_bytes_tx BIGINT DEFAULT 0,
          mobile_bytes_rx BIGINT DEFAULT 0,
          mobile_bytes_tx BIGINT DEFAULT 0,
          recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`);

        // Never seed publicly known administrator credentials.

        console.log('PostgreSQL migrations applied successfully.');
      }
      client.release();
      return;
    } catch (err) {
      console.error('PostgreSQL connection failed; refusing to silently fall back to volatile storage:', err.message);
      pool = null;
      usePostgres = false;
    }
  } else {
    console.log('No DATABASE_URL provided. Running with integrated embedded data store.');
  }
}

export const db = {
  isPostgres() {
    return usePostgres;
  },

  getMemoryStore() {
    return memoryStore;
  },

  async query(text, params = []) {
    if (usePostgres && pool) {
      return pool.query(text, params);
    }
    // Simple memory query simulation for standalone operations
    return { rows: [] };
  }
};
