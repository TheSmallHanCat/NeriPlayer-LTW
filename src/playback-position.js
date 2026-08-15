const REPEAT_MODE_ONE = 1;

export function wrapSingleTrackRepeatPosition(positionMs, playback, track) {
  const normalizedPositionMs = Math.max(0, Math.floor(Number(positionMs) || 0));
  const durationMs = Number(track?.durationMs);
  if (
    playback?.repeatMode !== REPEAT_MODE_ONE ||
    !Number.isFinite(durationMs) ||
    durationMs <= 0
  ) {
    return normalizedPositionMs;
  }
  return normalizedPositionMs % Math.floor(durationMs);
}

export function expectedPlaybackPosition(playback, track, atMs) {
  if (playback?.state !== 'playing') {
    return Math.max(0, Math.floor(Number(playback?.basePositionMs) || 0));
  }
  const projectedPositionMs = Number(playback.basePositionMs) +
    (Number(atMs) - Number(playback.baseTimestampMs)) *
      (Number(playback.playbackRate) || 1);
  return wrapSingleTrackRepeatPosition(projectedPositionMs, playback, track);
}

export function playbackModeAnchor(playback, track, committedAtMs) {
  const baseTimestampMs = Math.max(0, Math.floor(Number(committedAtMs) || 0));
  return {
    basePositionMs: expectedPlaybackPosition(playback, track, baseTimestampMs),
    baseTimestampMs,
  };
}
