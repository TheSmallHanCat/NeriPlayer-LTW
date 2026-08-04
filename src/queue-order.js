export function shuffleListenTogetherQueue(queue, currentIndex, random = Math.random) {
  const source = Array.isArray(queue) ? queue : [];
  if (!source.length) {
    return { queue: [], currentIndex: 0 };
  }

  const resolvedCurrentIndex = Math.min(
    Math.max(Number.isInteger(currentIndex) ? currentIndex : 0, 0),
    source.length - 1,
  );
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
