// ===========================================================================
// Command persistence + lifecycle enforcement shared by the HTTP API and the
// WebSocket layer. All status writes go through updateCommandStatus(), which
// applies the canonical lifecycle (server/src/commands.js): normalization of
// legacy aliases, transition guards, idempotent duplicate terminal reports,
// and expiry sweeps. No caller may write arbitrary statuses.
// ===========================================================================
import { db } from './db.js';
import {
  STATUS,
  TERMINAL_STATUSES,
  normalizeStatus,
  canTransition,
  coerceParamsToStrings
} from './commands.js';

const TERMINAL_LIST = [...TERMINAL_STATUSES];

/** Convert a stored command (memory or PG row) to the canonical wire shape. */
export function toWireCommand(row) {
  if (!row) return null;
  return {
    commandId: row.commandId || row.id,
    deviceId: row.deviceId || row.device_id,
    commandType: row.commandType || row.command_type,
    parameters: coerceParamsToStrings(row.parameters),
    status: row.status,
    timestamp: Number(row.timestamp),
    expiresAt: row.expiresAt !== undefined ? row.expiresAt : (row.expires_at ? Number(row.expires_at) : null)
  };
}

export async function insertCommand(command) {
  // command: { commandId, deviceId, userId, commandType, parameters, status,
  //            timestamp, expiresAt, idempotencyKey }
  if (db.isPostgres()) {
    await db.query(
      `INSERT INTO commands (id, device_id, user_id, command_type, parameters, status, timestamp, expires_at, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        command.commandId,
        command.deviceId,
        command.userId || null,
        command.commandType,
        JSON.stringify(command.parameters || {}),
        command.status || STATUS.QUEUED,
        command.timestamp,
        command.expiresAt || null,
        command.idempotencyKey || null
      ]
    );
  } else {
    db.getMemoryStore().commands.set(command.commandId, {
      id: command.commandId,
      commandId: command.commandId,
      deviceId: command.deviceId,
      user_id: command.userId || null,
      commandType: command.commandType,
      command_type: command.commandType,
      parameters: command.parameters || {},
      status: command.status || STATUS.QUEUED,
      timestamp: command.timestamp,
      expiresAt: command.expiresAt || null,
      expires_at: command.expiresAt || null,
      idempotency_key: command.idempotencyKey || null
    });
  }
}

export async function getCommand(commandId) {
  if (db.isPostgres()) {
    const r = await db.query('SELECT * FROM commands WHERE id = $1', [commandId]);
    return r.rows[0] || null;
  }
  return db.getMemoryStore().commands.get(commandId) || null;
}

export async function findCommandByIdempotencyKey(deviceId, key) {
  if (!key) return null;
  if (db.isPostgres()) {
    const r = await db.query(
      'SELECT * FROM commands WHERE device_id = $1 AND idempotency_key = $2 ORDER BY timestamp DESC LIMIT 1',
      [deviceId, key]
    );
    return r.rows[0] || null;
  }
  return Array.from(db.getMemoryStore().commands.values())
    .filter(c => c.deviceId === deviceId && c.idempotency_key === key)
    .sort((a, b) => b.timestamp - a.timestamp)[0] || null;
}

export async function listCommandsForDevice(deviceId, limit = 50) {
  if (db.isPostgres()) {
    const r = await db.query(
      'SELECT * FROM commands WHERE device_id = $1 ORDER BY timestamp DESC LIMIT $2',
      [deviceId, limit]
    );
    return r.rows;
  }
  return Array.from(db.getMemoryStore().commands.values())
    .filter(c => c.deviceId === deviceId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
}

/**
 * Lazy expiry: non-terminal commands past their delivery deadline become
 * EXPIRED. Called before replay and when listing, so expired work is never
 * delivered and dashboards see the truthful terminal state.
 */
export async function expireOverdueCommands(deviceId = null) {
  const now = Date.now();
  if (db.isPostgres()) {
    await db.query(
      `UPDATE commands SET status = 'EXPIRED'
        WHERE status NOT IN (${TERMINAL_LIST.map((_, i) => '$' + (i + 2)).join(', ')})
          AND expires_at IS NOT NULL AND expires_at < $1
          ${deviceId ? 'AND device_id = $' + (TERMINAL_LIST.length + 2) : ''}`,
      deviceId ? [now, ...TERMINAL_LIST, deviceId] : [now, ...TERMINAL_LIST]
    );
  } else {
    for (const cmd of db.getMemoryStore().commands.values()) {
      if ((!deviceId || cmd.deviceId === deviceId) &&
          !TERMINAL_STATUSES.has(cmd.status) &&
          cmd.expires_at && cmd.expires_at < now) {
        cmd.status = 'EXPIRED';
      }
    }
  }
}

/**
 * Commands awaiting delivery for a device: queued (never sent), and DELIVERED
 * ones that never reported progress — redelivered on reconnect so a crashed
 * device can recover them. RECEIVED/EXECUTING are never replayed (the device
 * already has them). Device-side idempotency (commandId dedupe) makes
 * redelivery safe against duplicate execution.
 */
export async function listQueuedCommands(deviceId) {
  await expireOverdueCommands(deviceId);
  if (db.isPostgres()) {
    const r = await db.query(
      `SELECT * FROM commands WHERE device_id = $1
         AND (status IN ('QUEUED', 'PENDING')
              OR (status IN ('DELIVERED', 'SENT') AND completion_timestamp IS NULL))
       ORDER BY timestamp ASC LIMIT 50`,
      [deviceId]
    );
    return r.rows.map(toWireCommand);
  }
  return Array.from(db.getMemoryStore().commands.values())
    .filter(c => c.deviceId === deviceId && (
      c.status === 'QUEUED' || c.status === 'PENDING' ||
      ((c.status === 'DELIVERED' || c.status === 'SENT') && !c.completion_timestamp))
    )
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(toWireCommand);
}

/**
 * Apply a lifecycle status to a command with full enforcement.
 *   - normalizes legacy aliases (PENDING/SENT/RUNNING)
 *   - validates transitions (terminal states are immutable except idempotent
 *     duplicate reports of the same terminal status)
 *   - sets completion timestamps on terminal states
 * Returns { ok, applied, normalized, previous, duplicate }.
 */
export async function updateCommandStatus(commandId, deviceId, rawStatus, { result, errorMessage } = {}) {
  const normalized = normalizeStatus(rawStatus);
  if (!normalized) return { ok: false, reason: 'invalid-status' };

  const current = await getCommand(commandId);
  if (!current) return { ok: false, reason: 'not-found' };
  const ownerId = current.deviceId || current.device_id;
  if (ownerId !== deviceId) return { ok: false, reason: 'not-found' };

  const previous = current.status;
  if (previous === normalized) {
    // Idempotent duplicate report of the same status (reconnect/retry safe).
    return { ok: true, applied: false, duplicate: true, normalized, previous };
  }
  if (!canTransition(previous, normalized)) {
    return { ok: false, reason: 'invalid-transition', normalized, previous };
  }

  const now = Date.now();
  const isTerminal = TERMINAL_STATUSES.has(normalized);
  if (db.isPostgres()) {
    await db.query(
      `UPDATE commands SET status = $1,
         result = COALESCE($2, result),
         error_message = COALESCE($3, error_message),
         completion_timestamp = CASE WHEN $4 THEN $5 ELSE completion_timestamp END
       WHERE id = $6 AND device_id = $7`,
      [normalized, result ?? null, errorMessage ?? null, isTerminal, now, commandId, deviceId]
    );
  } else {
    const cmd = db.getMemoryStore().commands.get(commandId);
    if (!cmd) return { ok: false, reason: 'not-found' };
    cmd.status = normalized;
    if (result !== undefined && result !== null) cmd.result = result;
    if (errorMessage !== undefined && errorMessage !== null) cmd.error_message = errorMessage;
    if (isTerminal) cmd.completion_timestamp = now;
  }
  return { ok: true, applied: true, normalized, previous };
}
