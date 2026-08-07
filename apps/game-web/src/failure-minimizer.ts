export function minimizeFailingTrace<T>(
  trace: readonly T[],
  stillFails: (candidate: readonly T[]) => boolean,
): T[] {
  let current = [...trace];
  if (current.length <= 1 || !stillFails(current)) return current;

  let granularity = 2;
  while (current.length >= 2) {
    const chunkSize = Math.ceil(current.length / granularity);
    let reduced = false;

    for (let start = 0; start < current.length; start += chunkSize) {
      const candidate = [...current.slice(0, start), ...current.slice(start + chunkSize)];
      if (candidate.length === 0) continue;
      if (!stillFails(candidate)) continue;

      current = candidate;
      granularity = Math.max(2, granularity - 1);
      reduced = true;
      break;
    }

    if (reduced) continue;
    if (granularity >= current.length) break;
    granularity = Math.min(current.length, granularity * 2);
  }

  return current;
}
