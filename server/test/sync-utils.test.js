import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCommandStatus, canAdvanceCommandStatus, isTerminalCommandStatus } from '../src/sync-utils.js';

test('normalizes Android status aliases', () => {
  assert.equal(normalizeCommandStatus('EXECUTING'), 'RUNNING');
  assert.equal(normalizeCommandStatus('in progress'), 'RUNNING');
  assert.equal(normalizeCommandStatus('SUCCESS'), 'COMPLETED');
  assert.equal(normalizeCommandStatus('timeout'), 'FAILED');
  assert.equal(normalizeCommandStatus('cancelled'), 'CANCELLED');
  assert.equal(normalizeCommandStatus('nonsense'), null);
});

test('allows forward progress but prevents stale regressions', () => {
  assert.equal(canAdvanceCommandStatus('PENDING', 'RUNNING'), true);
  assert.equal(canAdvanceCommandStatus('RUNNING', 'COMPLETED'), true);
  assert.equal(canAdvanceCommandStatus('RUNNING', 'PENDING'), false);
  assert.equal(canAdvanceCommandStatus('COMPLETED', 'RUNNING'), false);
  assert.equal(canAdvanceCommandStatus('FAILED', 'COMPLETED'), false);
});

test('terminal statuses are terminal and completion is explicit', () => {
  assert.equal(isTerminalCommandStatus('SUCCESS'), true);
  assert.equal(isTerminalCommandStatus('FAILED'), true);
  assert.equal(isTerminalCommandStatus('RUNNING'), false);
});
