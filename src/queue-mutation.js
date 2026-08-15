function stableKey(track) {
  return typeof track?.stableKey === 'string' && track.stableKey.length > 0
    ? track.stableKey
    : null;
}

export function hasSameTrackStableKeyMultiset(first, second) {
  if (first.length !== second.length) return false;
  const counts = new Map();
  for (const track of first) {
    const key = stableKey(track);
    if (!key) return false;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const track of second) {
    const key = stableKey(track);
    if (!key) return false;
    const count = counts.get(key) || 0;
    if (count <= 0) return false;
    if (count === 1) {
      counts.delete(key);
    } else {
      counts.set(key, count - 1);
    }
  }
  return counts.size === 0;
}

export function hasSameTrackStableKeySequence(first, second) {
  if (!Array.isArray(first) || !Array.isArray(second) || first.length !== second.length) {
    return false;
  }
  return first.every((track, index) => {
    const firstKey = stableKey(track);
    return firstKey != null && firstKey === stableKey(second[index]);
  });
}

export function validateListenTogetherPlaybackModeQueue({
  roomQueue,
  requesterQueue,
  roomCurrentIndex,
  requesterCurrentIndex,
}) {
  if (!Array.isArray(roomQueue) || !Array.isArray(requesterQueue) || !roomQueue.length) {
    return { ok: false, error: 'playback mode queue unavailable' };
  }
  if (!hasSameTrackStableKeyMultiset(requesterQueue, roomQueue)) {
    return { ok: false, error: 'playback mode queue content mismatch' };
  }
  const currentKey = stableKey(roomQueue[roomCurrentIndex]);
  if (!currentKey) {
    return { ok: false, error: 'playback mode current track unavailable' };
  }
  return hasCurrentTrackAt(requesterQueue, requesterCurrentIndex, currentKey)
    ? { ok: true, kind: 'reorder' }
    : { ok: false, error: 'playback mode current track mismatch' };
}

function resolveRemovedIndex(source, target) {
  if (source.length !== target.length + 1) return null;
  let sourceIndex = 0;
  let targetIndex = 0;
  let removedIndex = null;
  while (sourceIndex < source.length) {
    const sourceKey = stableKey(source[sourceIndex]);
    const targetKey = stableKey(target[targetIndex]);
    if (!sourceKey || (targetIndex < target.length && !targetKey)) return null;
    if (targetIndex < target.length && sourceKey === targetKey) {
      sourceIndex += 1;
      targetIndex += 1;
      continue;
    }
    if (removedIndex != null) return null;
    removedIndex = sourceIndex;
    sourceIndex += 1;
  }
  return targetIndex === target.length ? removedIndex : null;
}

function hasCurrentTrackAt(queue, index, currentKey) {
  return index >= 0 && index < queue.length && stableKey(queue[index]) === currentKey;
}

export function validateListenTogetherQueueMutation({
  roomQueue,
  requesterQueue,
  roomCurrentIndex,
  requesterCurrentIndex,
}) {
  if (!Array.isArray(roomQueue) || !Array.isArray(requesterQueue) || !roomQueue.length) {
    return { ok: false, error: 'queue update queue unavailable' };
  }
  const currentKey = stableKey(roomQueue[roomCurrentIndex]);
  if (!currentKey) {
    return { ok: false, error: 'queue update current track unavailable' };
  }
  if (requesterQueue.length === roomQueue.length) {
    if (!hasSameTrackStableKeyMultiset(requesterQueue, roomQueue)) {
      return { ok: false, error: 'queue reorder content mismatch' };
    }
    return hasCurrentTrackAt(requesterQueue, requesterCurrentIndex, currentKey)
      ? { ok: true, kind: 'reorder' }
      : { ok: false, error: 'queue reorder current track mismatch' };
  }
  if (requesterQueue.length === roomQueue.length + 1) {
    const insertedIndex = resolveRemovedIndex(requesterQueue, roomQueue);
    if (insertedIndex == null) {
      return { ok: false, error: 'queue insertion must retain existing order' };
    }
    const expectedCurrentIndex = insertedIndex <= roomCurrentIndex
      ? roomCurrentIndex + 1
      : roomCurrentIndex;
    return requesterCurrentIndex === expectedCurrentIndex &&
      hasCurrentTrackAt(requesterQueue, requesterCurrentIndex, currentKey)
      ? { ok: true, kind: 'insert' }
      : { ok: false, error: 'queue insertion current track mismatch' };
  }
  if (requesterQueue.length === roomQueue.length - 1) {
    const removedIndex = resolveRemovedIndex(roomQueue, requesterQueue);
    if (removedIndex == null) {
      return { ok: false, error: 'queue removal must retain remaining order' };
    }
    if (!requesterQueue.length) {
      return roomQueue.length === 1 && roomCurrentIndex === 0 && requesterCurrentIndex === -1
        ? { ok: true, kind: 'clear' }
        : { ok: false, error: 'queue clear current track mismatch' };
    }
    const expectedCurrentIndex = removedIndex < roomCurrentIndex
      ? roomCurrentIndex - 1
      : removedIndex === roomCurrentIndex
        ? Math.min(removedIndex, requesterQueue.length - 1)
        : roomCurrentIndex;
    const expectedCurrentKey = removedIndex === roomCurrentIndex
      ? stableKey(requesterQueue[expectedCurrentIndex])
      : currentKey;
    return requesterCurrentIndex === expectedCurrentIndex &&
      hasCurrentTrackAt(requesterQueue, requesterCurrentIndex, expectedCurrentKey)
      ? { ok: true, kind: removedIndex === roomCurrentIndex ? 'remove_current' : 'remove' }
      : { ok: false, error: 'queue removal current track mismatch' };
  }
  return { ok: false, error: 'queue update changes too many tracks' };
}
