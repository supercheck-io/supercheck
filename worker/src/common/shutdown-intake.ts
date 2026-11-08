type IntakeStopper = () => unknown;

const stoppers = new Set<IntakeStopper>();
let draining = false;
let inFlight = 0;

/** Registers a queue consumer that must stop pulling jobs when shutdown begins. Returns an unregister function. */
export function registerIntakeStopper(stop: IntakeStopper): () => void {
  stoppers.add(stop);
  return () => stoppers.delete(stop);
}

/** Stops every registered consumer from fetching new jobs without waiting for the active ones. */
export async function stopIntake(): Promise<void> {
  draining = true;
  await Promise.allSettled(
    [...stoppers].map(async (stop) => {
      await stop();
    }),
  );
}

/** True once shutdown began: readiness reports not-ready while in-flight runs finish. */
export function isDraining(): boolean {
  return draining;
}

/**
 * Counts work from the moment a worker picked it up, so the shutdown drain also sees runs that
 * are still in admission or setup (a paused BullMQ worker can still take one more job).
 */
export async function trackInFlight<T>(work: () => Promise<T>): Promise<T> {
  inFlight++;
  try {
    return await work();
  } finally {
    inFlight--;
  }
}

export function inFlightCount(): number {
  return inFlight;
}
