export const MAX_STREAM_URL_CACHE_ENTRIES = 64;

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

export function normalizeStreamUrlCache(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const cache = {};
  for (const [rawStableKey, rawEntry] of Object.entries(value)) {
    const stableKey = normalizeStableKey(rawStableKey);
    const url = normalizeCachedHttpUrl(rawEntry?.url);
    if (!stableKey || !url) continue;
    cache[stableKey] = {
      url,
      updatedAt: normalizeUpdatedAt(rawEntry?.updatedAt),
    };
  }
  return trimCache(cache);
}

export function cacheStreamUrl(cache, stableKey, streamUrl, updatedAt = Date.now()) {
  const normalizedStableKey = normalizeStableKey(stableKey);
  const normalizedUrl = normalizeCachedHttpUrl(streamUrl);
  const next = normalizeStreamUrlCache(cache);
  if (!normalizedStableKey || !normalizedUrl) return next;
  next[normalizedStableKey] = {
    url: normalizedUrl,
    updatedAt: normalizeUpdatedAt(updatedAt) || Date.now(),
  };
  return trimCache(next);
}

export function cachedStreamUrlForTrack(cache, stableKey) {
  const normalizedStableKey = normalizeStableKey(stableKey);
  if (!normalizedStableKey) return null;
  return normalizeStreamUrlCache(cache)[normalizedStableKey]?.url || null;
}

function stripTrackStreamUrl(track) {
  return track ? { ...track, streamUrl: null } : track;
}

function normalizedCurrentIndex(index, queueLength) {
  if (!Number.isInteger(index) || index < 0 || index >= queueLength) return 0;
  return index;
}

function withCachedStreamUrl(track, stableKey, streamUrl) {
  if (!track || track.stableKey !== stableKey) return track;
  return { ...track, streamUrl };
}

export function publicRoomStateWithCurrentStreamUrl(state, cache) {
  if (!state || typeof state !== 'object') return state;
  const queue = Array.isArray(state.queue) ? state.queue.map(stripTrackStreamUrl) : [];
  const currentIndex = normalizedCurrentIndex(state.currentIndex, queue.length);
  const currentTrack = queue[currentIndex] || stripTrackStreamUrl(state.track);
  const publicState = { ...state, queue, track: currentTrack };
  if (state.settings?.shareAudioLinks === false) return publicState;
  const streamUrl = cachedStreamUrlForTrack(cache, currentTrack?.stableKey);
  if (!currentTrack || !streamUrl) return publicState;
  return {
    ...publicState,
    queue: queue.map((item) => withCachedStreamUrl(item, currentTrack.stableKey, streamUrl)),
    track: withCachedStreamUrl(currentTrack, currentTrack.stableKey, streamUrl),
  };
}
