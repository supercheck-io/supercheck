type IntakeStopper = () => unknown;

const stoppers = new Set<IntakeStopper>();

/** Registers a queue consumer that must stop pulling jobs when shutdown begins. Returns an unregister function. */
export function registerIntakeStopper(stop: IntakeStopper): () => void {
  stoppers.add(stop);
  return () => stoppers.delete(stop);
}

/** Stops every registered consumer from fetching new jobs without waiting for the active ones. */
export async function stopIntake(): Promise<void> {
  await Promise.allSettled(
    [...stoppers].map(async (stop) => {
      await stop();
    }),
  );
}
