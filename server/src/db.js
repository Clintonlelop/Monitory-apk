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
  users: [
    {
      id: 1,
      username: 'admin',
      email: 'admin@devicemanager.local',
      password_hash: '$2a$10$w85v21rIe/EaG1o4wQ1i7O3Z22fRkFf1F9FkHqT7c2.k9mE5iAxeG', // password: admin
      role: 'admin',
      created_at: new Date()
    }
  ],
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
  audit_logs: []
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
      }
      client.release();
      return;
    } catch (err) {
      console.warn('PostgreSQL connection failed, falling back to embedded in-memory database:', err.message);
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
