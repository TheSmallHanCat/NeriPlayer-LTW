import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expectedPlaybackPosition,
  playbackModeAnchor,
} from '../src/playback-position.js';

test('single repeat expected position wraps at the exact track end', () => {
  const playback = {
    state: 'playing',
    basePositionMs: 58_000,
    baseTimestampMs: 1_000,
    playbackRate: 1,
    repeatMode: 1,
  };

  assert.equal(
    expectedPlaybackPosition(playback, { durationMs: 60_000 }, 3_000),
    0,
  );
});

test('playback mode commit reanchors the wrapped position at commit time', () => {
  const playback = {
    state: 'playing',
    basePositionMs: 59_000,
    baseTimestampMs: 1_000,
    playbackRate: 1,
    repeatMode: 1,
  };

  assert.deepEqual(
    playbackModeAnchor(playback, { durationMs: 60_000 }, 2_500),
    {
      basePositionMs: 500,
      baseTimestampMs: 2_500,
    },
  );
});
