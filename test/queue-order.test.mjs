import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
