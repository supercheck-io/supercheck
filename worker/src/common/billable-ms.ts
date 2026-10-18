/**
 * Billable execution time travels with errors thrown after a container has
 * started, so metering charges only work that actually ran.
 */
const BILLABLE_MS = 'billableMs';

/** Attach container-run time to an error without changing its class. */
export function attachBillableMs<T>(error: T, billableMs: number): T {
  if (billableMs > 0 && error !== null && typeof error === 'object') {
    try {
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
