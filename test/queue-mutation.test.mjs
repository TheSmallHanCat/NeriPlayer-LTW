import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyListenTogetherQueueMutation,
  hasSameTrackStableKeySequence,
  validateListenTogetherPlaybackModeQueue,
  validateListenTogetherQueueMutation,
} from '../src/queue-mutation.js';

function track(stableKey) {
  return { stableKey };
}

function reference(stableKey, occurrence = 0) {
  return { stableKey, occurrence };
}

function mutation(operations, targetCurrent = null) {
  return {
    baseRoomVersion: 1,
    operations,
    targetCurrent,
  };
}

test('queue mutation replays a stale move on the latest queue and keeps remote inserts', () => {
  const result = applyListenTogetherQueueMutation({
    roomQueue: [track('a'), track('x'), track('b'), track('c')],
    roomCurrentIndex: 2,
    mutation: mutation([
      {
        type: 'move',
        target: reference('c'),
        placement: 'before',
        anchor: reference('a'),
      },
    ]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.queue.map((item) => item.stableKey), ['c', 'a', 'x', 'b']);
  assert.equal(result.currentIndex, 3);
});

test('queue mutation reports the exact target occurrence without changing generic current selection', () => {
  const result = applyListenTogetherQueueMutation({
    roomQueue: [track('dup'), track('dup')],
    roomCurrentIndex: 0,
    mutation: mutation([], reference('dup', 1)),
  });

  assert.equal(result.ok, true);
  assert.equal(result.currentIndex, 0);
  assert.equal(result.targetCurrentIndex, 1);
});

test('queue mutations preserve two independent moves regardless of arrival order', () => {
  const first = applyListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c'), track('d')],
    roomCurrentIndex: 0,
    mutation: mutation([
      { type: 'move', target: reference('b'), placement: 'append' },
    ]),
  });
  const second = applyListenTogetherQueueMutation({
    roomQueue: first.queue,
    roomCurrentIndex: first.currentIndex,
    mutation: mutation([
      {
        type: 'move',
        target: reference('c'),
        placement: 'prepend',
      },
    ]),
  });

  assert.deepEqual(second.queue.map((item) => item.stableKey), ['c', 'a', 'd', 'b']);
  assert.equal(second.currentIndex, 1);
});

test('queue mutation removes a stale current track and selects the requested replacement', () => {
  const result = applyListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('c')],
    roomCurrentIndex: 1,
    targetCurrentStableKey: 'c',
    mutation: mutation([
      { type: 'remove', target: reference('b') },
    ], reference('c')),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.queue.map((item) => item.stableKey), ['a', 'c']);
  assert.equal(result.currentIndex, 1);
  assert.equal(result.currentRemoved, true);
});

test('queue reorder preserves remote items in their existing slots', () => {
  const result = applyListenTogetherQueueMutation({
    roomQueue: [track('a'), track('remote'), track('b'), track('c')],
    roomCurrentIndex: 0,
    mutation: mutation([
      {
        type: 'reorder',
        order: [reference('c'), reference('a'), reference('b')],
      },
    ]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.queue.map((item) => item.stableKey), ['c', 'remote', 'a', 'b']);
});

test('remove_many clears an old large queue without deleting newer remote tracks', () => {
  const result = applyListenTogetherQueueMutation({
    roomQueue: [track('a'), track('b'), track('remote')],
    roomCurrentIndex: 0,
    mutation: mutation([
      {
        type: 'remove_many',
        order: [reference('a'), reference('b')],
      },
    ]),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.queue.map((item) => item.stableKey), ['remote']);
  assert.equal(result.currentIndex, 0);
});

test('queue mutation selects a newly inserted target when the old queue was empty', () => {
  const result = applyListenTogetherQueueMutation({
    roomQueue: [],
    roomCurrentIndex: -1,
    targetCurrentStableKey: 'c',
    mutation: mutation([
      { type: 'insert', placement: 'append', track: track('a') },
      { type: 'insert', placement: 'append', track: track('b') },
      { type: 'insert', placement: 'append', track: track('c') },
    ]),
  });

  assert.deepEqual(result.queue.map((item) => item.stableKey), ['a', 'b', 'c']);
  assert.equal(result.currentIndex, 2);
});

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

test('playback mode queue accepts the requester exact reorder and current track', () => {
  const result = validateListenTogetherPlaybackModeQueue({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('b'), track('c'), track('a')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 0,
  });

  assert.deepEqual(result, { ok: true, kind: 'reorder' });
});

test('playback mode queue rejects additions and removals', () => {
  const added = validateListenTogetherPlaybackModeQueue({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('b'), track('c'), track('a'), track('x')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 0,
  });
  const removed = validateListenTogetherPlaybackModeQueue({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('b'), track('c')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 0,
  });

  assert.equal(added.ok, false);
  assert.equal(removed.ok, false);
});

test('playback mode queue rejects a current track mismatch', () => {
  const result = validateListenTogetherPlaybackModeQueue({
    roomQueue: [track('a'), track('b'), track('c')],
    requesterQueue: [track('a'), track('b'), track('c')],
    roomCurrentIndex: 1,
    requesterCurrentIndex: 0,
  });

  assert.deepEqual(result, {
    ok: false,
    error: 'playback mode current track mismatch',
  });
});

test('stable key sequence distinguishes a true shuffle from an unchanged snapshot', () => {
  const roomQueue = [track('a'), track('b'), track('c')];

  assert.equal(hasSameTrackStableKeySequence(roomQueue, [track('a'), track('b'), track('c')]), true);
  assert.equal(hasSameTrackStableKeySequence(roomQueue, [track('b'), track('c'), track('a')]), false);
});
