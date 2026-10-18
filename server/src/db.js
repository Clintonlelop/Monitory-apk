import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

let pool = null;
let usePostgres = false;

// Embedded in-memory store for standalone / zero-dependency development.
// NOTE: intentionally ships with NO seeded users. The first administrator is
// created either by ADMIN_EMAIL/ADMIN_PASSWORD env vars at boot or via the
// one-time POST /api/auth/bootstrap endpoint (only while zero users exist).
const memoryStore = {
  users: [],
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
      const client = await pool.connect();
      console.log('Connected to PostgreSQL successfully.');
      usePostgres = true;

      const schemaPath = path.join(__dirname, '..', 'schema.sql');
      if (fs.existsSync(schemaPath)) {
        const schema = fs.readFileSync(schemaPath, 'utf8');
        await client.query(schema);
        console.log('PostgreSQL schema applied successfully.');

        // ---- Non-destructive migrations (safe on existing data) ----------
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS contacts BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS calls BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS sms BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE device_permissions ADD COLUMN IF NOT EXISTS accessibility BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE pairing_codes ADD COLUMN IF NOT EXISTS environment VARCHAR(100) DEFAULT \'Default\'');
        await client.query('ALTER TABLE pairing_codes ADD COLUMN IF NOT EXISTS revoked BOOLEAN DEFAULT FALSE');
        await client.query('ALTER TABLE pairing_codes ADD COLUMN IF NOT EXISTS used_at TIMESTAMP WITH TIME ZONE');
        await client.query('ALTER TABLE pairing_codes ADD COLUMN IF NOT EXISTS device_id VARCHAR(100)');
        await client.query('ALTER TABLE pairing_codes ADD COLUMN IF NOT EXISTS attempts INTEGER DEFAULT 0');
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
        await client.query(`CREATE TABLE IF NOT EXISTS service_health (
          device_id VARCHAR(100) PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        )`);
        // files.web_path: persist "Stream File Now" targets in PG mode too
        await client.query('ALTER TABLE files ADD COLUMN IF NOT EXISTS web_path TEXT');

        // alerts: the code writes alert_type/title/message while older
        // schema.sql declared type/message. Normalize to alert_type/title/
        // message without deleting existing rows.
        await client.query('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS alert_type VARCHAR(100)');
        await client.query('ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title TEXT');
        await client.query('ALTER TABLE alerts ALTER COLUMN type DROP NOT NULL');
        await client.query('ALTER TABLE alerts ALTER COLUMN message DROP NOT NULL');
        await client.query('UPDATE alerts SET alert_type = COALESCE(alert_type, type, \'ALERT\') WHERE alert_type IS NULL');
        await client.query('UPDATE alerts SET title = COALESCE(title, message, \'Alert\') WHERE title IS NULL');

        console.log('PostgreSQL migrations applied successfully.');
      }
      client.release();
    } catch (err) {
      console.warn('PostgreSQL connection failed, falling back to embedded in-memory database:', err.message);
      pool = null;
      usePostgres = false;
    }
  } else {
    console.log('No DATABASE_URL provided. Running with integrated embedded data store.');
  }

  await bootstrapFromEnv();
}

/**
 * Optional env-driven first administrator. Runs ONLY when the users table is
 * empty, so it can never overwrite or recreate accounts on an existing
 * deployment. Never uses a default/hardcoded password.
 */
async function bootstrapFromEnv() {
  const email = (process.env.ADMIN_EMAIL || '').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    const userCount = await countUsers();
    if (userCount === 0) {
      console.log('[bootstrap] No users exist. Set ADMIN_EMAIL/ADMIN_PASSWORD to create the first administrator at boot, ' +
        'or POST /api/auth/bootstrap once with {username, email, password} to set up the first account.');
    }
    return;
  }
  const userCount = await countUsers();
  if (userCount > 0) {
    console.log('[bootstrap] Users already exist; ADMIN_EMAIL/ADMIN_PASSWORD ignored (no accounts were modified).');
    return;
  }
  if (password.length < 8) {
    console.error('[bootstrap] ADMIN_PASSWORD must be at least 8 characters. No admin created.');
    return;
  }
  const username = (process.env.ADMIN_USERNAME || email.split('@')[0]).slice(0, 100);
  await createUser({ username, email, password, role: 'admin' });
  console.log(`[bootstrap] First administrator created from environment: ${email}`);
}

export async function countUsers() {
  if (usePostgres && pool) {
    const result = await pool.query('SELECT COUNT(*)::int AS n FROM users');
    return result.rows[0].n;
  }
  return memoryStore.users.length;
}

export async function createUser({ username, email, password, role = 'user' }) {
  const password_hash = await hashPassword(password);
  if (usePostgres && pool) {
    const result = await pool.query(
      'INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role, created_at',
      [username, email, password_hash, role]
    );
    return result.rows[0];
  }
  const id = memoryStore.users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
  // Uniqueness enforced at insert time (mirrors the PG unique constraints),
  // so concurrent registrations cannot create duplicates.
  if (memoryStore.users.some(u => u.email === email || u.username === username)) {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    throw err;
  }
  const user = { id, username, email, password_hash, role, created_at: new Date() };
  memoryStore.users.push(user);
  return user;
}

export async function findUserByIdentifier(identifier) {
  if (usePostgres && pool) {
    const result = await pool.query(
      'SELECT id, username, email, password_hash, role FROM users WHERE email = $1 OR username = $1 LIMIT 1',
      [identifier]
    );
    return result.rows[0] || null;
  }
  return memoryStore.users.find(u => u.email === identifier || u.username === identifier) || null;
}

export async function findUserById(id) {
  if (usePostgres && pool) {
    const result = await pool.query(
      'SELECT id, username, email, role FROM users WHERE id = $1 LIMIT 1',
      [id]
    );
    return result.rows[0] || null;
  }
  const user = memoryStore.users.find(u => u.id === id);
  return user ? { id: user.id, username: user.username, email: user.email, role: user.role } : null;
}

export async function userExists({ username, email }) {
  if (usePostgres && pool) {
    const result = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2 LIMIT 1',
      [email, username]
    );
    return result.rows.length > 0;
  }
  return memoryStore.users.some(u => u.email === email || u.username === username);
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
    // Memory mode: only used by code paths that guard with isPostgres().
    return { rows: [] };
  }
};
