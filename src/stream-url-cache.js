export const MAX_STREAM_URL_CACHE_ENTRIES = 64;
export const MAX_STREAM_URL_CANDIDATES = 3;

const MAX_STREAM_URL_CACHE_KEY_LENGTH = 512;
const MAX_STREAM_URL_CACHE_URL_LENGTH = 8192;

function normalizeStableKey(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_STREAM_URL_CACHE_KEY_LENGTH) return null;
  return normalized;
}

function normalizeCachedHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_STREAM_URL_CACHE_URL_LENGTH) return null;
  try {
    const url = new URL(normalized);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeCachedHttpUrls(values) {
  if (!Array.isArray(values)) return [];
  const urls = [];
  for (const value of values) {
    const url = normalizeCachedHttpUrl(value);
    if (url && !urls.includes(url)) urls.push(url);
    if (urls.length >= MAX_STREAM_URL_CANDIDATES) break;
  }
  return urls;
}

function normalizeUpdatedAt(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized > 0 ? Math.floor(normalized) : 0;
}

function trimCache(cache) {
  const entries = Object.entries(cache)
    .sort(([leftKey, left], [rightKey, right]) =>
      left.updatedAt - right.updatedAt || leftKey.localeCompare(rightKey)
    )
    .slice(-MAX_STREAM_URL_CACHE_ENTRIES);
  return Object.fromEntries(entries);
}

function normalizeCacheEntry(entry) {
  const urls = normalizeCachedHttpUrls([
    ...(Array.isArray(entry?.urls) ? entry.urls : []),
    entry?.url,
  ]);
  if (!urls.length) return null;
  return {
    // url remains available for older persisted room snapshots
    url: urls[0],
    urls,
    updatedAt: normalizeUpdatedAt(entry?.updatedAt),
  };
}

export function normalizeStreamUrlCache(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const cache = {};
  for (const [rawStableKey, rawEntry] of Object.entries(value)) {
    const stableKey = normalizeStableKey(rawStableKey);
    const entry = normalizeCacheEntry(rawEntry);
    if (!stableKey || !entry) continue;
    cache[stableKey] = entry;
  }
  return trimCache(cache);
}

export function cacheStreamUrls(cache, stableKey, streamUrls, updatedAt = Date.now()) {
  const normalizedStableKey = normalizeStableKey(stableKey);
  const urls = normalizeCachedHttpUrls(streamUrls);
  const next = normalizeStreamUrlCache(cache);
  if (!normalizedStableKey || !urls.length) return next;
  next[normalizedStableKey] = {
    url: urls[0],
    urls,
    updatedAt: normalizeUpdatedAt(updatedAt) || Date.now(),
  };
  return trimCache(next);
}

export function cacheStreamUrl(cache, stableKey, streamUrl, updatedAt = Date.now()) {
  return cacheStreamUrls(cache, stableKey, [streamUrl], updatedAt);
}

export function removeCachedStreamUrls(cache, stableKey) {
  const normalizedStableKey = normalizeStableKey(stableKey);
  const next = normalizeStreamUrlCache(cache);
  if (!normalizedStableKey) return next;
  delete next[normalizedStableKey];
  return next;
}

export function cachedStreamUrlsForTrack(cache, stableKey) {
  const normalizedStableKey = normalizeStableKey(stableKey);
  if (!normalizedStableKey) return [];
  return normalizeStreamUrlCache(cache)[normalizedStableKey]?.urls || [];
}

export function cachedStreamUrlForTrack(cache, stableKey) {
  return cachedStreamUrlsForTrack(cache, stableKey)[0] || null;
}

function stripTrackStreamUrls(track) {
  return track ? { ...track, streamUrl: null, streamUrls: [] } : track;
}

function normalizedCurrentIndex(index, queueLength) {
  if (!Number.isInteger(index) || index < 0 || index >= queueLength) return 0;
  return index;
}

function withCachedStreamUrls(track, stableKey, streamUrls) {
  if (!track || track.stableKey !== stableKey) return track;
  return {
    ...track,
    streamUrl: streamUrls[0] || null,
    streamUrls,
  };
}

export function publicRoomStateWithCurrentStreamUrl(state, cache) {
  if (!state || typeof state !== 'object') return state;
  const queue = Array.isArray(state.queue) ? state.queue.map(stripTrackStreamUrls) : [];
  const currentIndex = normalizedCurrentIndex(state.currentIndex, queue.length);
  const currentTrack = queue[currentIndex] || stripTrackStreamUrls(state.track);
  const publicState = { ...state, queue, track: currentTrack };
  if (state.settings?.shareAudioLinks === false) return publicState;
  const streamUrls = cachedStreamUrlsForTrack(cache, currentTrack?.stableKey);
  if (!currentTrack || !streamUrls.length) return publicState;
  return {
    ...publicState,
    queue: queue.map((item) => withCachedStreamUrls(item, currentTrack.stableKey, streamUrls)),
    track: withCachedStreamUrls(currentTrack, currentTrack.stableKey, streamUrls),
  };
}
