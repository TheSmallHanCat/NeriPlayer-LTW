import test from 'node:test';
import assert from 'node:assert/strict';
import { shuffleListenTogetherQueue } from '../src/queue-order.js';

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
