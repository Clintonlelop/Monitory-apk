// ===========================================================================
// Monitory Command Contract — single source of truth for remote commands.
// Shared by the HTTP dispatch API, the WebSocket layer, and (mirrored in
// Kotlin) the Android agent. See docs/COMMAND_CONTRACT.md for the full spec.
//
// Wire format of a command:
//   {
//     commandId:   "cmd_<ts>_<rand>",      // unique id
//     deviceId:    "dev_...",              // target device
//     commandType: "TAKE_SCREENSHOT",      // normalized type (registry key)
//     parameters:  { key: "string value" } // STRING-valued map (validated)
//     status:      "QUEUED",               // canonical lifecycle status
//     timestamp:   1712345678901,          // creation time (epoch ms)
//     expiresAt:   1712388878901           // delivery deadline (epoch ms)
//   }
//
// Lifecycle:  QUEUED -> DELIVERED -> RECEIVED -> EXECUTING -> COMPLETED
// Terminal:   COMPLETED | FAILED | REJECTED | EXPIRED | CANCELLED
// Ingress aliases (accepted, then normalized): PENDING->QUEUED, SENT->DELIVERED,
//                                             RUNNING->EXECUTING.
// A successful WebSocket send is NOT proof of execution: only COMPLETED /
// FAILED / REJECTED reported by the device (validated execution result) ends
// the lifecycle.
// ===========================================================================

export const STATUS = Object.freeze({
  QUEUED: 'QUEUED',
  DELIVERED: 'DELIVERED',
  RECEIVED: 'RECEIVED',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
});

export const TERMINAL_STATUSES = Object.freeze(new Set([
  STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED, STATUS.EXPIRED, STATUS.CANCELLED
]));

/** Statuses a device may report back. */
export const DEVICE_REPORTABLE_STATUSES = Object.freeze(new Set([
  STATUS.RECEIVED, STATUS.EXECUTING, STATUS.COMPLETED, STATUS.FAILED,
  STATUS.REJECTED, STATUS.CANCELLED
]));

/** Legacy / shorthand names accepted on ingress and normalized. */
const STATUS_ALIASES = Object.freeze({
  PENDING: STATUS.QUEUED,
  QUEUED: STATUS.QUEUED,
  SENT: STATUS.DELIVERED,
  DELIVERED: STATUS.DELIVERED,
  RUNNING: STATUS.EXECUTING,
  RECEIVED: STATUS.RECEIVED,
  EXECUTING: STATUS.EXECUTING,
  COMPLETED: STATUS.COMPLETED,
  FAILED: STATUS.FAILED,
  REJECTED: STATUS.REJECTED,
  EXPIRED: STATUS.EXPIRED,
  CANCELLED: STATUS.CANCELLED
});

/** Canonical or aliased -> canonical status; null when unknown. */
export function normalizeStatus(raw) {
  if (typeof raw !== 'string') return null;
  return STATUS_ALIASES[raw.trim().toUpperCase()] || null;
}

/**
 * Allowed status transitions. Terminal -> the SAME terminal is allowed as an
 * idempotent duplicate report (reconnect/retry); terminal -> anything else is
 * a forbidden forgery/regression and must be rejected.
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [STATUS.QUEUED]: new Set([STATUS.DELIVERED, STATUS.RECEIVED, STATUS.EXECUTING, STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED, STATUS.EXPIRED, STATUS.CANCELLED]),
  [STATUS.DELIVERED]: new Set([STATUS.RECEIVED, STATUS.EXECUTING, STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED, STATUS.EXPIRED, STATUS.CANCELLED]),
  [STATUS.RECEIVED]: new Set([STATUS.EXECUTING, STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED, STATUS.CANCELLED, STATUS.EXPIRED]),
  [STATUS.EXECUTING]: new Set([STATUS.COMPLETED, STATUS.FAILED, STATUS.REJECTED, STATUS.CANCELLED]),
  [STATUS.COMPLETED]: new Set([STATUS.COMPLETED]),
  [STATUS.FAILED]: new Set([STATUS.FAILED]),
  [STATUS.REJECTED]: new Set([STATUS.REJECTED]),
  [STATUS.EXPIRED]: new Set([STATUS.EXPIRED]),
  [STATUS.CANCELLED]: new Set([STATUS.CANCELLED])
});

export function canTransition(from, to) {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.has(to));
}

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------
// param spec: { type: 'string'|'int'|'enum', required, min, max, maxLen,
//               enum: [...], default }
// ttlSeconds: delivery deadline after which a queued command may no longer be
//             replayed (it becomes EXPIRED instead).
// resultKind: 'text' | 'media' | 'none' — how the dashboard should render the
//             structured result.
// requiresConsent: 'screen-capture' | 'camera' — the Android agent must show a
//             visible user-consent flow before executing.
// interactive: requires the device user to be present (consent dialogs etc).

const UPLOAD_PATH_ROOTS = ['/storage/emulated/0/', '/sdcard/', '/mnt/sdcard/'];

const NO_PARAMS = Object.freeze({});

function reg(type, opts) {
  return Object.freeze({
    type,
    description: opts.description || type,
    category: opts.category || 'sync',
    params: opts.params || NO_PARAMS,
    ttlSeconds: opts.ttlSeconds || 6 * 60 * 60,
    resultKind: opts.resultKind || 'text',
    requiresConsent: opts.requiresConsent || null,
    destructive: Boolean(opts.destructive)
  });
}

export const COMMAND_REGISTRY = Object.freeze({
  // ---- data synchronization ---------------------------------------------
  REFRESH_TELEMETRY: reg('REFRESH_TELEMETRY', { description: 'Refresh device telemetry', category: 'sync' }),
  REFRESH_PERMISSIONS: reg('REFRESH_PERMISSIONS', { description: 'Refresh permission audit', category: 'sync' }),
  REQUEST_LOCATION: reg('REQUEST_LOCATION', { description: 'Request current GPS location', category: 'sync' }),
  REQUEST_APPS: reg('REQUEST_APPS', { description: 'Request installed applications', category: 'sync' }),
  REQUEST_USAGE: reg('REQUEST_USAGE', { description: 'Request usage statistics', category: 'sync' }),
  SYNC_DEVICE: reg('SYNC_DEVICE', { description: 'Full telemetry + permissions sync', category: 'sync' }),
  SYNC_FILES: reg('SYNC_FILES', { description: 'Synchronize file inventory', category: 'sync' }),
  SYNC_NOTIFICATIONS: reg('SYNC_NOTIFICATIONS', { description: 'Synchronize notification log', category: 'sync' }),
  SYNC_CONTACTS: reg('SYNC_CONTACTS', { description: 'Synchronize contacts', category: 'sync' }),
  SYNC_APPLICATIONS: reg('SYNC_APPLICATIONS', { description: 'Synchronize app inventory', category: 'sync' }),
  SYNC_USAGE: reg('SYNC_USAGE', { description: 'Synchronize usage statistics', category: 'sync' }),
  SYNC_SMS: reg('SYNC_SMS', { description: 'Synchronize SMS log', category: 'sync' }),
  SYNC_CALLS: reg('SYNC_CALLS', { description: 'Synchronize call log', category: 'sync' }),
  SYNC_KEYSTROKES: reg('SYNC_KEYSTROKES', {
    description: 'Synchronize the accessibility text log captured with the on-device accessibility consent',
    category: 'sync'
  }),

  // ---- alerts / attention ------------------------------------------------
  SEND_NOTIFICATION: reg('SEND_NOTIFICATION', {
    description: 'Show a notification on the device',
    category: 'alert',
    params: {
      title: { type: 'string', maxLen: 120, default: 'Admin Alert' },
      message: { type: 'string', maxLen: 500, default: 'Notice from management dashboard' }
    }
  }),
  RING_ALARM: reg('RING_ALARM', {
    description: 'Ring the device alarm at full volume',
    category: 'alert',
    params: { durationSeconds: { type: 'int', min: 3, max: 30, default: 10 } }
  }),
  VIBRATE: reg('VIBRATE', {
    description: 'Vibrate the device',
    category: 'alert',
    params: { durationMs: { type: 'int', min: 100, max: 2000, default: 800 } }
  }),

  // ---- capture (requires visible user consent on the device) -------------
  TAKE_SCREENSHOT: reg('TAKE_SCREENSHOT', {
    description: 'Capture one screen frame via MediaProjection (user consent required on device)',
    category: 'capture',
    requiresConsent: 'screen-capture',
    resultKind: 'media',
    ttlSeconds: 15 * 60
  }),
  TAKE_PHOTO: reg('TAKE_PHOTO', {
    description: 'Take a photo with the system camera app (user taps the shutter)',
    category: 'capture',
    requiresConsent: 'camera',
    resultKind: 'media',
    ttlSeconds: 15 * 60
  }),
  RECORD_AUDIO: reg('RECORD_AUDIO', {
    description: 'Record a short audio clip and upload it',
    category: 'capture',
    resultKind: 'media',
    params: { durationSeconds: { type: 'int', min: 1, max: 60, default: 10 } },
    ttlSeconds: 15 * 60
  }),
  START_RECORDING: reg('START_RECORDING', {
    description: 'Start a screen-recording session (MediaProjection consent required on device)',
    category: 'capture',
    requiresConsent: 'screen-capture',
    resultKind: 'none',
    ttlSeconds: 15 * 60
  }),
  STOP_RECORDING: reg('STOP_RECORDING', {
    description: 'Stop the active screen-recording session, finalize and upload the video',
    category: 'capture',
    resultKind: 'media',
    ttlSeconds: 15 * 60
  }),
  RECORDING_STATUS: reg('RECORDING_STATUS', {
    description: 'Report the current screen-recording session state',
    category: 'capture',
    resultKind: 'text',
    ttlSeconds: 15 * 60
  }),

  // ---- device actions ----------------------------------------------------
  LOCK_DEVICE: reg('LOCK_DEVICE', {
    description: 'Lock the device screen (requires Device Admin activation on the device)',
    category: 'device'
  }),
  WIPE_DEVICE: reg('WIPE_DEVICE', {
    description: 'Wipe the Monitory agent\'s own local data and unpair (NOT a factory reset). Requires confirm=WIPE.',
    category: 'device',
    destructive: true,
    params: { confirm: { type: 'enum', required: true, enum: ['WIPE'] } },
    resultKind: 'none'
  }),

  // ---- applications / files ---------------------------------------------
  LAUNCH_APP: reg('LAUNCH_APP', {
    description: 'Launch an installed application',
    category: 'apps',
    params: { packageName: { type: 'string', required: true, maxLen: 255 } }
  }),
  UNINSTALL_APP: reg('UNINSTALL_APP', {
    description: 'Open the uninstall dialog for an application',
    category: 'apps',
    params: { packageName: { type: 'string', required: true, maxLen: 255 } }
  }),
  UPLOAD_FILE: reg('UPLOAD_FILE', {
    description: 'Upload a shared-storage file from the device to the server',
    category: 'files',
    resultKind: 'media',
    params: { path: { type: 'string', required: true, maxLen: 1024, uploadPath: true } }
  })
});

export const ALLOWED_COMMAND_TYPES = Object.freeze(new Set(Object.keys(COMMAND_REGISTRY)));

export function getCommandSpec(commandType) {
  return COMMAND_REGISTRY[commandType] || null;
}

// ---------------------------------------------------------------------------
// Parameter validation / normalization
// ---------------------------------------------------------------------------

/**
 * Validates request parameters against the registry spec and returns a
 * normalized STRING-valued map (the wire contract) or an error string.
 */
export function validateAndNormalizeParams(commandType, parameters) {
  const spec = getCommandSpec(commandType);
  if (!spec) return { error: `Unknown commandType: ${commandType}` };
  if (parameters !== undefined && parameters !== null) {
    if (typeof parameters !== 'object' || Array.isArray(parameters)) {
      return { error: 'parameters must be an object' };
    }
    for (const key of Object.keys(parameters)) {
      if (!spec.params[key]) {
        return { error: `Unknown parameter "${key}" for ${commandType}` };
      }
    }
  }
  const out = {};
  for (const [key, def] of Object.entries(spec.params)) {
    let value = parameters?.[key];
    if (value === undefined || value === null || value === '') {
      if (def.required) return { error: `${commandType} requires parameters.${key}` };
      if (def.default !== undefined) out[key] = String(def.default);
      continue;
    }
    if (def.type === 'int') {
      const n = Number(value);
      if (!Number.isInteger(n)) return { error: `parameters.${key} must be an integer` };
      if (def.min !== undefined && n < def.min) return { error: `parameters.${key} must be >= ${def.min}` };
      if (def.max !== undefined && n > def.max) return { error: `parameters.${key} must be <= ${def.max}` };
      out[key] = String(n);
    } else if (def.type === 'enum') {
      const s = String(value);
      if (!def.enum.includes(s)) return { error: `parameters.${key} must be one of: ${def.enum.join(', ')}` };
      out[key] = s;
    } else {
      const s = String(value);
      if (def.maxLen && s.length > def.maxLen) return { error: `parameters.${key} is too long (max ${def.maxLen})` };
      if (s.includes('\u0000')) return { error: `parameters.${key} contains illegal characters` };
      if (def.uploadPath) {
        if (s.includes('..')) return { error: 'UPLOAD_FILE path contains illegal sequences' };
        if (!UPLOAD_PATH_ROOTS.some(root => s.startsWith(root))) {
          return { error: `UPLOAD_FILE path must be under ${UPLOAD_PATH_ROOTS[0]}` };
        }
      }
      out[key] = s;
    }
  }
  return { params: out };
}

/** Coerce arbitrary device/user parameter values to the string wire format. */
export function coerceParamsToStrings(parameters) {
  const out = {};
  if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
    for (const [k, v] of Object.entries(parameters)) {
      if (v === undefined || v === null) continue;
      out[String(k)] = typeof v === 'string' ? v : String(v);
    }
  }
  return out;
}

/** TTL in ms for a command type (delivery deadline). */
export function ttlMsFor(commandType, overrideSeconds) {
  const spec = getCommandSpec(commandType);
  const seconds = Number(overrideSeconds);
  if (Number.isInteger(seconds) && seconds >= 1 && seconds <= 86400) {
    return seconds * 1000;
  }
  return (spec ? spec.ttlSeconds : 6 * 60 * 60) * 1000;
}
