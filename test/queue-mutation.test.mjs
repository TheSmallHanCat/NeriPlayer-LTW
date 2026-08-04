import test from 'node:test';
import assert from 'node:assert/strict';
import { validateListenTogetherQueueMutation } from '../src/queue-mutation.js';

function track(stableKey) {
  return { stableKey };
}

test('queue mutation accepts insertion after the current track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('a'), track('b'), track('x'), track('c')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 1,
  });

  assert.deepEqual(result, { ok: true, kind: 'insert' });
});

test('queue mutation accepts removal before the current track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('b'), track('c')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 0,
  });

  assert.deepEqual(result, { ok: true, kind: 'remove' });
});

test('queue mutation accepts removal after the current track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('a'), track('b')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 1,
  });

  assert.deepEqual(result, { ok: true, kind: 'remove' });
});

test('queue mutation accepts current-track removal with deterministic next track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('a'), track('c')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 1,
  });

  assert.deepEqual(result, { ok: true, kind: 'remove_current' });
});

test('queue mutation falls back to the previous track after removing the last current track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('a'), track('b')],
    roomCurrentIndex: 2,
    requesterCurrentIndex: 1,
  });

  assert.deepEqual(result, { ok: true, kind: 'remove_current' });
});

test('queue mutation accepts clearing a single current track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a')],
    requesterQueue: [],
    roomCurrentIndex: 0,
    requesterCurrentIndex: -1,
  });

  assert.deepEqual(result, { ok: true, kind: 'clear' });
});

test('queue mutation rejects replacing more than one track', () => {
  const result = validateListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('a'), track('x'), track('y')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 1,
  });

  assert.equal(result.ok, false);
});
