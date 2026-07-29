import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_STREAM_URL_CACHE_ENTRIES,
  cacheStreamUrl,
  cacheStreamUrls,
  cachedStreamUrlForTrack,
  cachedStreamUrlsForTrack,
  normalizeStreamUrlCache,
  publicRoomStateWithCurrentStreamUrl,
} from '../src/stream-url-cache.js';

function track(stableKey, streamUrl = null, streamUrls = []) {
  return {
    stableKey,
    channelId: 'netease',
    audioId: stableKey,
    name: `Song ${stableKey}`,
    artist: 'Artist',
    streamUrl,
    streamUrls,
  };
}

test('public room state only exposes cached candidates for the current stream', () => {
  const urls = [
    'https://cdn.example.com/second.m4a',
    'https://backup.example.com/second.m4a',
  ];
  const cache = cacheStreamUrls({}, 'second', urls, 100);
  const state = publicRoomStateWithCurrentStreamUrl({
    settings: { shareAudioLinks: true },
    queue: [
      track('first', 'https://cdn.example.com/private-first.m4a'),
      track('second', 'https://cdn.example.com/private-second.m4a'),
    ],
    currentIndex: 1,
    track: track('second', 'https://cdn.example.com/private-second.m4a'),
  }, cache);

  assert.equal(state.queue[0].streamUrl, null);
  assert.deepEqual(state.queue[0].streamUrls, []);
  assert.equal(state.queue[1].streamUrl, 'https://cdn.example.com/second.m4a');
  assert.deepEqual(state.queue[1].streamUrls, urls);
  assert.equal(state.track.streamUrl, 'https://cdn.example.com/second.m4a');
  assert.deepEqual(state.track.streamUrls, urls);
});

test('disabled audio sharing redacts cached URLs from every state surface', () => {
  const cache = cacheStreamUrl({}, 'current', 'https://cdn.example.com/current.m4a', 100);
  const state = publicRoomStateWithCurrentStreamUrl({
    settings: { shareAudioLinks: false },
    queue: [track('current', 'https://cdn.example.com/private-current.m4a')],
    currentIndex: 0,
    track: track('current', 'https://cdn.example.com/private-current.m4a'),
  }, cache);

  assert.equal(state.queue[0].streamUrl, null);
  assert.deepEqual(state.queue[0].streamUrls, []);
  assert.equal(state.track.streamUrl, null);
  assert.deepEqual(state.track.streamUrls, []);
});

test('current queue entry wins over a stale track when exposing a cached URL', () => {
  let cache = cacheStreamUrl({}, 'first', 'https://cdn.example.com/first.m4a', 100);
  cache = cacheStreamUrl(cache, 'second', 'https://cdn.example.com/second.m4a', 200);
  const state = publicRoomStateWithCurrentStreamUrl({
    settings: { shareAudioLinks: true },
    queue: [track('first'), track('second')],
    currentIndex: 1,
    track: track('first'),
  }, cache);

  assert.equal(state.track.stableKey, 'second');
  assert.equal(state.track.streamUrl, 'https://cdn.example.com/second.m4a');
  assert.equal(state.queue[0].streamUrl, null);
  assert.equal(state.queue[1].streamUrl, 'https://cdn.example.com/second.m4a');
});

test('stream URL cache migrates legacy single links and keeps ordered unique candidates', () => {
  const legacy = normalizeStreamUrlCache({
    song: {
      url: 'https://cdn.example.com/legacy.m4a',
      updatedAt: 100,
    },
  });
  const cache = cacheStreamUrls(legacy, 'song', [
    'https://cdn.example.com/primary.m4a',
    'https://cdn.example.com/primary.m4a',
    'file:///private/audio.m4a',
    'https://backup-a.example.com/audio.m4a',
    'https://backup-b.example.com/audio.m4a',
    'https://backup-c.example.com/audio.m4a',
  ], 200);

  assert.deepEqual(
    cachedStreamUrlsForTrack(legacy, 'song'),
    ['https://cdn.example.com/legacy.m4a']
  );
  assert.deepEqual(
    cachedStreamUrlsForTrack(cache, 'song'),
    [
      'https://cdn.example.com/primary.m4a',
      'https://backup-a.example.com/audio.m4a',
      'https://backup-b.example.com/audio.m4a',
    ]
  );
  assert.equal(cachedStreamUrlForTrack(cache, 'song'), 'https://cdn.example.com/primary.m4a');
});

test('stream URL cache rejects invalid links and remains bounded', () => {
  let cache = cacheStreamUrl({}, 'invalid', 'file:///private/audio.m4a', 1);
  assert.equal(cachedStreamUrlForTrack(cache, 'invalid'), null);

  for (let index = 0; index <= MAX_STREAM_URL_CACHE_ENTRIES; index += 1) {
    cache = cacheStreamUrl(
      cache,
      `track-${index}`,
      `https://cdn.example.com/${index}.m4a`,
      index + 1
    );
  }

  assert.equal(Object.keys(cache).length, MAX_STREAM_URL_CACHE_ENTRIES);
  assert.equal(cachedStreamUrlForTrack(cache, 'track-0'), null);
  assert.equal(
    cachedStreamUrlForTrack(cache, `track-${MAX_STREAM_URL_CACHE_ENTRIES}`),
    `https://cdn.example.com/${MAX_STREAM_URL_CACHE_ENTRIES}.m4a`
  );
});
