import { hasSameTrackStableKeyMultiset } from './queue-mutation.js';

function normalizeQueueIndex(index, queueLength, fallback = 0) {
  const safeFallback = Number.isInteger(fallback) ? fallback : 0;
  if (queueLength <= 0) return 0;
  const candidate = Number.isInteger(index) ? index : safeFallback;
  return Math.min(Math.max(candidate, 0), queueLength - 1);
}

function stableKey(track) {
  return typeof track?.stableKey === 'string' && track.stableKey.length > 0
    ? track.stableKey
    : null;
}

export function shuffleListenTogetherQueue(queue, currentIndex, random = Math.random) {
  const source = Array.isArray(queue) ? queue : [];
  if (!source.length) {
    return { queue: [], currentIndex: 0 };
  }

  const resolvedCurrentIndex = normalizeQueueIndex(currentIndex, source.length, 0);
  const currentTrack = source[resolvedCurrentIndex];
  const remaining = source.filter((_, index) => index !== resolvedCurrentIndex);
  for (let index = remaining.length - 1; index > 0; index -= 1) {
    const randomValue = Number(random());
    const normalizedRandom = Number.isFinite(randomValue)
      ? Math.min(Math.max(randomValue, 0), 0.9999999999999999)
      : 0;
    const swapIndex = Math.floor(normalizedRandom * (index + 1));
    [remaining[index], remaining[swapIndex]] = [remaining[swapIndex], remaining[index]];
  }
  return {
    queue: [currentTrack, ...remaining],
    currentIndex: 0,
  };
}

export function resolveListenTogetherPlaybackModeQueue({
  roomQueue,
  roomCurrentIndex,
  requesterQueue,
  requesterCurrentIndex,
  adoptRequesterQueue,
  shuffleEnabled,
  previousShuffleEnabled,
  shuffleRestoreQueue,
  random = Math.random,
}) {
  const fallbackQueue = Array.isArray(roomQueue) ? roomQueue : [];
  const fallbackIndex = normalizeQueueIndex(
    roomCurrentIndex,
    fallbackQueue.length,
    0,
  );
  const requestedQueue = Array.isArray(requesterQueue) ? requesterQueue : [];
  const shuffleChanged = shuffleEnabled !== previousShuffleEnabled;

  if (!shuffleChanged) {
    return {
      queue: fallbackQueue,
      currentIndex: fallbackIndex,
    };
  }

  if (shuffleEnabled !== true && Array.isArray(shuffleRestoreQueue)) {
    const restoreQueue = shuffleRestoreQueue;
    if (
      restoreQueue.length > 0 &&
      hasSameTrackStableKeyMultiset(fallbackQueue, restoreQueue)
    ) {
      const currentKey = stableKey(fallbackQueue[fallbackIndex]);
      const restoredIndex = restoreQueue.findIndex((track) => stableKey(track) === currentKey);
      if (restoredIndex >= 0) {
        return {
          queue: restoreQueue,
          currentIndex: restoredIndex,
        };
      }
    }
  }

  if (adoptRequesterQueue && requestedQueue.length) {
    return {
      queue: requestedQueue,
      currentIndex: normalizeQueueIndex(
        requesterCurrentIndex,
        requestedQueue.length,
        fallbackIndex,
      ),
    };
  }
  if (shuffleEnabled === true && previousShuffleEnabled !== true) {
    return shuffleListenTogetherQueue(fallbackQueue, fallbackIndex, random);
  }
  return {
    queue: fallbackQueue,
    currentIndex: fallbackIndex,
  };
}

export function reconcileListenTogetherShuffleRestoreQueue({
  roomQueue,
  shuffleRestoreQueue,
}) {
  const nextQueue = Array.isArray(roomQueue) ? roomQueue : [];
  const previousRestoreQueue = Array.isArray(shuffleRestoreQueue)
    ? shuffleRestoreQueue
    : [];
  if (!nextQueue.length || !previousRestoreQueue.length) {
    return null;
  }
  if (
    nextQueue.some((track) => !stableKey(track)) ||
    previousRestoreQueue.some((track) => !stableKey(track))
  ) {
    return null;
  }

  const remainingCounts = new Map();
  for (const track of nextQueue) {
    const key = stableKey(track);
    remainingCounts.set(key, (remainingCounts.get(key) || 0) + 1);
  }
  const reconciled = [];
  for (const track of previousRestoreQueue) {
    const key = stableKey(track);
    const remaining = remainingCounts.get(key) || 0;
    if (remaining <= 0) continue;
    reconciled.push(track);
    if (remaining === 1) {
      remainingCounts.delete(key);
    } else {
      remainingCounts.set(key, remaining - 1);
    }
  }
  for (const track of nextQueue) {
    const key = stableKey(track);
    const remaining = remainingCounts.get(key) || 0;
    if (remaining <= 0) continue;
    reconciled.push(track);
    if (remaining === 1) {
      remainingCounts.delete(key);
    } else {
      remainingCounts.set(key, remaining - 1);
    }
  }

  return hasSameTrackStableKeyMultiset(nextQueue, reconciled)
    ? reconciled
    : null;
}
