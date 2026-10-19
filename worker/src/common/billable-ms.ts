/**
 * Billable execution time travels with errors thrown after a container has
 * started, so metering charges only work that actually ran.
 */
const BILLABLE_MS = 'billableMs';
const BILLABLE_VUS = 'billableVirtualUsers';

/** Attach container-run time to an error without changing its class. */
export function attachBillableMs<T>(
  error: T,
  billableMs: number,
  virtualUsers?: number,
): T {
  if (billableMs > 0 && error !== null && typeof error === 'object') {
    try {
      if (Number.isSafeInteger(virtualUsers) && virtualUsers! >= 0) {
        Object.defineProperty(error, BILLABLE_VUS, {
          value: virtualUsers,
          configurable: true,
        });
      }
      Object.defineProperty(error, BILLABLE_MS, {
        value: billableMs,
        enumerable: false,
        configurable: true,
      });
    } catch {
      // Frozen/sealed error objects simply carry no billing evidence.
    }
  }
  return error;
}

/** Container-run time carried by an error; zero when none was attached. */
export function getBillableMs(error: unknown): number {
  if (error !== null && typeof error === 'object') {
    const value = (error as Record<string, unknown>)[BILLABLE_MS];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return 0;
}

/** Native allocation evidence, never a tenant-modifiable summary metric. */
export function getBillableVirtualUsers(error: unknown): number | undefined {
  if (error !== null && typeof error === 'object') {
    const value = (error as Record<string, unknown>)[BILLABLE_VUS];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
      return value;
  }
  return undefined;
}

/** Read native k6 progress before bounded console storage truncates it. */
export function createK6AllocationTracker() {
  let pending = '';
  let dropping = false;
  let maximum: number | undefined;
  return {
    write(chunk: string) {
      for (const character of chunk) {
        if (character === '\n' || character === '\r') {
          if (!dropping) {
            const match =
              /^running \([^)]{1,40}\),\s*\d+\/(\d+) VUs(?:,|$)/.exec(pending);
            if (match) {
              const allocated = Number(match[1]);
              if (Number.isSafeInteger(allocated))
                maximum = Math.max(maximum ?? 0, allocated);
            }
          }
          pending = '';
          dropping = false;
        } else if (!dropping) {
          if (pending.length < 1024) pending += character;
          else {
            pending = '';
            dropping = true;
          }
        }
      }
    },
    value: () => maximum,
  };
}
