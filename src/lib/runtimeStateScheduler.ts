export function createRuntimeStateScheduler<T>(
  loadState: () => Promise<T>,
  applyState: (state: T) => Promise<void>
): () => Promise<void> {
  let queue: Promise<void> = Promise.resolve();

  return () => {
    const scheduled = queue.then(async () => {
      const latestState = await loadState();
      await applyState(latestState);
    });
    queue = scheduled.then(
      () => undefined,
      () => undefined
    );
    return scheduled;
  };
}
