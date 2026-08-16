function stableKey(track) {
  return typeof track?.stableKey === 'string' && track.stableKey.length > 0
    ? track.stableKey
    : null;
}

function referenceMapForQueue(queue) {
  const occurrences = new Map();
  const references = new Map();
  queue.forEach((track) => {
    const key = stableKey(track);
    if (!key) return;
    const occurrence = occurrences.get(key) || 0;
    occurrences.set(key, occurrence + 1);
    references.set(JSON.stringify([key, occurrence]), track);
  });
  return references;
}

function resolveReference(reference, references) {
  if (!reference || typeof reference.stableKey !== 'string') return null;
  const occurrence = Number(reference.occurrence);
  if (!Number.isInteger(occurrence) || occurrence < 0) return null;
  return references.get(JSON.stringify([reference.stableKey, occurrence])) || null;
}

export function applyListenTogetherQueueMutation({
  roomQueue,
  roomCurrentIndex,
  mutation,
  targetCurrentStableKey = null,
  maxQueueSize = Number.MAX_SAFE_INTEGER,
}) {
  if (!Array.isArray(roomQueue) || !Array.isArray(mutation?.operations)) {
    return { ok: false, error: 'queue mutation unavailable' };
  }
  const nextQueue = roomQueue.slice();
  const references = referenceMapForQueue(nextQueue);
  const previousCurrent = nextQueue[roomCurrentIndex] || null;
  const targetCurrent = resolveReference(mutation.targetCurrent, references);

  for (const operation of mutation.operations) {
    const operationType = operation?.type;
    if (operationType === 'remove' || operationType === 'move') {
      const target = resolveReference(operation.target, references);
      const targetIndex = target ? nextQueue.indexOf(target) : -1;
      if (targetIndex < 0) continue;
      const [moved] = nextQueue.splice(targetIndex, 1);
      if (operationType === 'remove') continue;
      const anchor = resolveReference(operation.anchor, references);
      const anchorIndex = anchor ? nextQueue.indexOf(anchor) : -1;
      const placement = operation.placement;
      const insertionIndex = placement === 'prepend'
        ? 0
        : placement === 'before' && anchorIndex >= 0
          ? anchorIndex
          : nextQueue.length;
      nextQueue.splice(insertionIndex, 0, moved);
      continue;
    }
    if (operationType === 'remove_many') {
      const targets = Array.isArray(operation.order)
        ? operation.order
          .map((reference) => resolveReference(reference, references))
          .filter(Boolean)
        : [];
      for (const target of targets) {
        const targetIndex = nextQueue.indexOf(target);
        if (targetIndex >= 0) nextQueue.splice(targetIndex, 1);
      }
      continue;
    }
    if (operationType === 'insert') {
      const track = operation.track;
      if (!track || !stableKey(track)) continue;
      if (nextQueue.length >= maxQueueSize) continue;
      const anchor = resolveReference(operation.anchor, references);
      const anchorIndex = anchor ? nextQueue.indexOf(anchor) : -1;
      const insertionIndex = operation.placement === 'prepend'
        ? 0
        : operation.placement === 'before' && anchorIndex >= 0
          ? anchorIndex
          : nextQueue.length;
      nextQueue.splice(insertionIndex, 0, track);
      continue;
    }
    if (operationType === 'reorder') {
      const requestedTracks = Array.isArray(operation.order)
        ? operation.order
          .map((reference) => resolveReference(reference, references))
          .filter(Boolean)
        : [];
      if (!requestedTracks.length) continue;
      const selected = new Set(requestedTracks);
      const selectedSlots = nextQueue
        .map((track, index) => selected.has(track) ? index : -1)
        .filter((index) => index >= 0);
      requestedTracks.forEach((track, index) => {
        const slot = selectedSlots[index];
        if (slot != null) nextQueue[slot] = track;
      });
    }
  }

  if (!nextQueue.length) {
    return {
      ok: true,
      queue: [],
      currentIndex: -1,
      targetCurrentIndex: null,
      currentRemoved: previousCurrent != null,
    };
  }
  const targetCurrentIndex = targetCurrent ? nextQueue.indexOf(targetCurrent) : -1;
  const currentCandidate = nextQueue.includes(previousCurrent)
    ? previousCurrent
    : nextQueue.includes(targetCurrent)
      ? targetCurrent
      : targetCurrentStableKey
        ? nextQueue.find((track) => stableKey(track) === targetCurrentStableKey) || null
        : null;
  const currentIndex = currentCandidate
    ? nextQueue.indexOf(currentCandidate)
    : Math.min(Math.max(Number(roomCurrentIndex) || 0, 0), nextQueue.length - 1);
  return {
    ok: true,
    queue: nextQueue,
    currentIndex,
    targetCurrentIndex: targetCurrentIndex >= 0 ? targetCurrentIndex : null,
    currentRemoved: previousCurrent != null && !nextQueue.includes(previousCurrent),
  };
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
