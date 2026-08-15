import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reconcileListenTogetherShuffleRestoreQueue,
  resolveListenTogetherPlaybackModeQueue,
  shuffleListenTogetherQueue,
} from '../src/queue-order.js';

test('shuffle keeps the active track first and uses one shared order', () => {
  const tracks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];

  const result = shuffleListenTogetherQueue(tracks, 2, () => 0);

  assert.equal(result.currentIndex, 0);
  assert.deepEqual(result.queue.map((track) => track.id), ['c', 'b', 'd', 'a']);
  assert.deepEqual(tracks.map((track) => track.id), ['a', 'b', 'c', 'd']);
});

test('shuffle handles an empty queue and an invalid current index', () => {
  assert.deepEqual(shuffleListenTogetherQueue([], 0), { queue: [], currentIndex: 0 });

  const result = shuffleListenTogetherQueue([{ id: 'a' }, { id: 'b' }], 99, () => 0);

  assert.equal(result.currentIndex, 0);
  assert.equal(result.queue[0].id, 'b');
});

test('playback mode uses the requester shuffle order without reshuffling it', () => {
  const roomQueue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const requesterQueue = [roomQueue[1], roomQueue[2], roomQueue[0]];

  const result = resolveListenTogetherPlaybackModeQueue({
    roomQueue,
    roomCurrentIndex: 1,
    requesterQueue,
    requesterCurrentIndex: 0,
    adoptRequesterQueue: true,
    shuffleEnabled: true,
    previousShuffleEnabled: false,
    random: () => 0,
  });

  assert.equal(result.currentIndex, 0);
  assert.deepEqual(result.queue.map((track) => track.id), ['b', 'c', 'a']);
});

test('playback mode uses the requester restored order when shuffle is disabled', () => {
  const shuffledQueue = [{ id: 'b' }, { id: 'c' }, { id: 'a' }];
  const restoredQueue = [shuffledQueue[2], shuffledQueue[0], shuffledQueue[1]];

  const result = resolveListenTogetherPlaybackModeQueue({
    roomQueue: shuffledQueue,
    roomCurrentIndex: 0,
    requesterQueue: restoredQueue,
    requesterCurrentIndex: 1,
    adoptRequesterQueue: true,
    shuffleEnabled: false,
    previousShuffleEnabled: true,
  });

  assert.equal(result.currentIndex, 1);
  assert.deepEqual(result.queue.map((track) => track.id), ['a', 'b', 'c']);
});

test('playback mode restores the room order when a listener disables shuffle', () => {
  const originalQueue = [
    { id: 'a', stableKey: 'a' },
    { id: 'b', stableKey: 'b' },
    { id: 'c', stableKey: 'c' },
  ];
  const shuffledQueue = [originalQueue[1], originalQueue[2], originalQueue[0]];

  const result = resolveListenTogetherPlaybackModeQueue({
    roomQueue: shuffledQueue,
    roomCurrentIndex: 0,
    requesterQueue: shuffledQueue,
    requesterCurrentIndex: 0,
    adoptRequesterQueue: true,
    shuffleEnabled: false,
    previousShuffleEnabled: true,
    shuffleRestoreQueue: originalQueue,
  });

  assert.equal(result.currentIndex, 1);
  assert.deepEqual(result.queue.map((track) => track.id), ['a', 'b', 'c']);
});

test('an invalid shuffle restore snapshot cannot replace the room queue', () => {
  const shuffledQueue = [
    { id: 'b', stableKey: 'b' },
    { id: 'c', stableKey: 'c' },
    { id: 'a', stableKey: 'a' },
  ];
  const invalidRestoreQueue = [
    { id: 'a', stableKey: 'a' },
    { id: 'b', stableKey: 'b' },
    { id: 'd', stableKey: 'd' },
  ];

  const result = resolveListenTogetherPlaybackModeQueue({
    roomQueue: shuffledQueue,
    roomCurrentIndex: 0,
    requesterQueue: shuffledQueue,
    requesterCurrentIndex: 0,
    adoptRequesterQueue: true,
    shuffleEnabled: false,
    previousShuffleEnabled: true,
    shuffleRestoreQueue: invalidRestoreQueue,
  });

  assert.equal(result.currentIndex, 0);
  assert.deepEqual(result.queue.map((track) => track.id), ['b', 'c', 'a']);
});

test('unchanged playback mode cannot replace the authoritative queue', () => {
  const roomQueue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const staleRequesterQueue = [{ id: 'b' }, { id: 'a' }, { id: 'c' }];

  const result = resolveListenTogetherPlaybackModeQueue({
    roomQueue,
    roomCurrentIndex: 1,
    requesterQueue: staleRequesterQueue,
    requesterCurrentIndex: 0,
    adoptRequesterQueue: true,
    shuffleEnabled: true,
    previousShuffleEnabled: true,
  });

  assert.equal(result.currentIndex, 1);
  assert.deepEqual(result.queue.map((track) => track.id), ['a', 'b', 'c']);
});

test('repeated listener shuffle requests preserve the controller restore order', () => {
  const originalQueue = [
    { id: 'a', stableKey: 'a' },
    { id: 'b', stableKey: 'b' },
    { id: 'c', stableKey: 'c' },
    { id: 'd', stableKey: 'd' },
  ];
  const enabled = resolveListenTogetherPlaybackModeQueue({
    roomQueue: originalQueue,
    roomCurrentIndex: 2,
    requesterQueue: originalQueue,
    requesterCurrentIndex: 2,
    adoptRequesterQueue: false,
    shuffleEnabled: true,
    previousShuffleEnabled: false,
    random: () => 0,
  });
  const restoreQueue = originalQueue;

  const duplicateEnable = resolveListenTogetherPlaybackModeQueue({
    roomQueue: enabled.queue,
    roomCurrentIndex: enabled.currentIndex,
    requesterQueue: [enabled.queue[0], enabled.queue[2], enabled.queue[1], enabled.queue[3]],
    requesterCurrentIndex: 0,
    adoptRequesterQueue: true,
    shuffleEnabled: true,
    previousShuffleEnabled: true,
    shuffleRestoreQueue: restoreQueue,
  });
  assert.deepEqual(
    duplicateEnable.queue.map((track) => track.id),
    enabled.queue.map((track) => track.id),
  );

  const disabled = resolveListenTogetherPlaybackModeQueue({
    roomQueue: duplicateEnable.queue,
    roomCurrentIndex: duplicateEnable.currentIndex,
    requesterQueue: duplicateEnable.queue,
    requesterCurrentIndex: duplicateEnable.currentIndex,
    adoptRequesterQueue: true,
    shuffleEnabled: false,
    previousShuffleEnabled: true,
    shuffleRestoreQueue: restoreQueue,
  });
  assert.deepEqual(disabled.queue.map((track) => track.id), ['a', 'b', 'c', 'd']);
  assert.equal(disabled.currentIndex, 2);

  const duplicateDisable = resolveListenTogetherPlaybackModeQueue({
    roomQueue: disabled.queue,
    roomCurrentIndex: disabled.currentIndex,
    requesterQueue: [disabled.queue[2], disabled.queue[1], disabled.queue[0], disabled.queue[3]],
    requesterCurrentIndex: 0,
    adoptRequesterQueue: true,
    shuffleEnabled: false,
    previousShuffleEnabled: false,
    shuffleRestoreQueue: restoreQueue,
  });
  assert.deepEqual(duplicateDisable.queue.map((track) => track.id), ['a', 'b', 'c', 'd']);
  assert.equal(duplicateDisable.currentIndex, 2);
});

test('shuffle restore order retains its original sequence across queue mutations', () => {
  const originalQueue = [
    { id: 'a', stableKey: 'a' },
    { id: 'b', stableKey: 'b' },
    { id: 'c', stableKey: 'c' },
  ];
  const mutatedShuffledQueue = [
    { id: 'c', stableKey: 'c' },
    { id: 'x', stableKey: 'x' },
    { id: 'a', stableKey: 'a' },
  ];

  const reconciled = reconcileListenTogetherShuffleRestoreQueue({
    roomQueue: mutatedShuffledQueue,
    shuffleRestoreQueue: originalQueue,
  });

  assert.deepEqual(reconciled?.map((track) => track.id), ['a', 'c', 'x']);
});

test('legacy playback mode without a queue keeps the server shuffle fallback', () => {
  const roomQueue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  const result = resolveListenTogetherPlaybackModeQueue({
    roomQueue,
    roomCurrentIndex: 1,
    requesterQueue: [],
    requesterCurrentIndex: 0,
    adoptRequesterQueue: false,
    shuffleEnabled: true,
    previousShuffleEnabled: false,
    random: () => 0,
  });

  assert.equal(result.currentIndex, 0);
  assert.deepEqual(result.queue.map((track) => track.id), ['b', 'c', 'a']);
});
