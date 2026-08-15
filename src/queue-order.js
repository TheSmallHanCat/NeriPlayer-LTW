function normalizeQueueIndex(index, queueLength, fallback = 0) {
  const safeFallback = Number.isInteger(fallback) ? fallback : 0;
  if (queueLength <= 0) return 0;
  const candidate = Number.isInteger(index) ? index : safeFallback;
  return Math.min(Math.max(candidate, 0), queueLength - 1);
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
  random = Math.random,
}) {
  const fallbackQueue = Array.isArray(roomQueue) ? roomQueue : [];
  const fallbackIndex = normalizeQueueIndex(
    roomCurrentIndex,
    fallbackQueue.length,
    0,
  );
  const requestedQueue = Array.isArray(requesterQueue) ? requesterQueue : [];
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
