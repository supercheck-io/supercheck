/** No expected location has a live worker (e.g. during a deploy rollout); not a monitor failure. */
export class NoLiveWorkersError extends Error {
  constructor(
    readonly monitorId: string,
    readonly expectedLocations: string[],
  ) {
    super(
      `Monitor ${monitorId}: no jobs enqueued — none of the expected locations ` +
      `[${expectedLocations.join(', ')}] have live workers. Check worker health and location configuration.`
    );
    this.name = 'NoLiveWorkersError';
  }
}
