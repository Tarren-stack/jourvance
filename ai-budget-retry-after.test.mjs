// F2: the AI draft's 429 says how long until the hourly window has room again. aiBudgetRetryAfter
// answers that from the same counter aiBudgetLeft keeps, without spending a slot. A sliding window
// frees a slot when its oldest counting call leaves, so the wait is that call's hour, not a fixed
// guess. The clock is faked, and the limit is set before the module reads it at import.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_COPY_PER_HOUR = '3';
const { aiBudgetLeft, aiBudgetRetryAfter } = await import('./server/routes/authWorkspaceRoutes.mjs');

const MIN = 60_000;
const T = Date.UTC(2026, 8, 29, 9, 0, 0);

function atClock(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try { return fn(); } finally { Date.now = real; }
}

test('the wait is the oldest counting call leaving the hour, and never spends a slot', () => {
  const uid = 'retry-after-user';
  assert.equal(atClock(T, () => aiBudgetRetryAfter(uid)), 0, 'no wait while the hour has room');
  assert.equal(atClock(T, () => aiBudgetLeft(uid)), true);
  assert.equal(atClock(T + 10 * MIN, () => aiBudgetLeft(uid)), true);
  // Asking while there is still room answers 0 and leaves the last slot for aiBudgetLeft.
  assert.equal(atClock(T + 15 * MIN, () => aiBudgetRetryAfter(uid)), 0);
  assert.equal(atClock(T + 20 * MIN, () => aiBudgetLeft(uid)), true);

  // Three calls at T, T+10 and T+20 minutes: at T+30 the one at T leaves at T+60, 1,800s away.
  const now = T + 30 * MIN;
  assert.equal(atClock(now, () => aiBudgetRetryAfter(uid)), 1800);
  assert.equal(atClock(now, () => aiBudgetRetryAfter(uid)), 1800, 'asking twice changes nothing');
  assert.equal(atClock(now, () => aiBudgetLeft(uid)), false, 'the hour is spent');
  // A refused call is not counted, so the wait is unchanged.
  assert.equal(atClock(now, () => aiBudgetRetryAfter(uid)), 1800);

  // One second before the returned instant the window is still full; at it, there is room.
  const opens = now + 1800 * 1000;
  assert.equal(atClock(opens - 1000, () => aiBudgetLeft(uid)), false);
  assert.equal(atClock(opens - 1000, () => aiBudgetRetryAfter(uid)), 1);
  assert.equal(atClock(opens, () => aiBudgetLeft(uid)), true);
});

test('a part second rounds up, so waiting the answer is always enough', () => {
  const uid = 'retry-after-part-second';
  for (const at of [T, T + 1, T + 2]) assert.equal(atClock(at, () => aiBudgetLeft(uid)), true);
  // The call at T leaves 3,599.5s after T + 500ms, which rounds up to 3,600.
  assert.equal(atClock(T + 500, () => aiBudgetRetryAfter(uid)), 3600);
  // The window keeps a call while t > cutoff, so the call at T counts until the hour after it.
  assert.equal(atClock(T + 3599_999, () => aiBudgetLeft(uid)), false, 'T itself is still inside the window');
  assert.equal(atClock(T + 3600_000, () => aiBudgetLeft(uid)), true);
});
