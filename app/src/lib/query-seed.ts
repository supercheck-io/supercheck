/** How long a value the server read for this page load counts as fresh in the client cache. */
export const SEED_FRESH_MS = 30_000;

/**
 * Query options that start a query from a value the server already read for this request, so the
 * page does not request it again on load. With no value they change nothing.
 *
 * Seeded queries must also be memory-only (`meta: { persist: false }`): the saved cache is restored
 * after mount and an older saved entry would replace the fresher server value.
 */
export function seededQueryOptions<T>(value: T | undefined, readAt: number | undefined) {
  if (value === undefined) return {};
  return {
    initialData: value,
    initialDataUpdatedAt: readAt,
    staleTime: SEED_FRESH_MS,
    refetchOnMount: true as const,
  };
}
