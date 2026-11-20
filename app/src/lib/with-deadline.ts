/**
 * Resolves to `fallback` if `promise` has not settled within `ms`. For optional server reads that must not
 * hold up a page: the caller then takes its normal path (for example the client requests the value).
 * The timer is cleared as soon as the read settles. The read itself is not cancelled.
 */
export function withDeadline<T, F>(promise: Promise<T>, ms: number, fallback: F): Promise<T | F> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<F>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
