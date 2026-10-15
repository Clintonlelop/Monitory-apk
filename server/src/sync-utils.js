const STATUS_ALIASES = new Map([
  ['PENDING', 'PENDING'],
  ['QUEUED', 'PENDING'],
  ['STARTED', 'RUNNING'],
  ['EXECUTING', 'RUNNING'],
  ['PROCESSING', 'RUNNING'],
  ['IN_PROGRESS', 'RUNNING'],
  ['RUNNING', 'RUNNING'],
  ['SUCCESS', 'COMPLETED'],
  ['SUCCEEDED', 'COMPLETED'],
  ['DONE', 'COMPLETED'],
  ['COMPLETED', 'COMPLETED'],
  ['ERROR', 'FAILED'],
  ['FAILURE', 'FAILED'],
  ['TIMEOUT', 'FAILED'],
  ['TIMED_OUT', 'FAILED'],
  ['FAILED', 'FAILED'],
  ['CANCELLED', 'CANCELLED'],
  ['CANCELED', 'CANCELLED']
]);

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export function normalizeCommandStatus(value) {
  if (typeof value !== 'string') return null;
  return STATUS_ALIASES.get(value.trim().toUpperCase().replace(/[ -]+/g, '_')) || null;
}

export function canAdvanceCommandStatus(currentValue, nextValue) {
  const current = normalizeCommandStatus(currentValue);
  const next = normalizeCommandStatus(nextValue);
  if (!current || !next) return false;
  if (TERMINAL.has(current)) return current === next;
  if (current === 'RUNNING' && next === 'PENDING') return false;
  return true;
}

export function isTerminalCommandStatus(value) {
  return TERMINAL.has(normalizeCommandStatus(value));
}
