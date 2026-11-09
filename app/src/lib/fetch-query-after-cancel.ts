import { isCancelledError, type FetchQueryOptions, type QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * queryClient.fetchQuery that retries (up to 3 attempts) when the fetch was cancelled. The query provider clears the
 * cache when the first session check settles, which cancels any imperative fetch already in flight;
 * useQuery observers refetch on their own, but a bare fetchQuery promise would just reject.
 */
export async function fetchQueryAfterCancel<T, TKey extends QueryKey>(
  client: QueryClient,
  options: FetchQueryOptions<T, Error, T, TKey>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await client.fetchQuery(options);
    } catch (error) {
      if (!isCancelledError(error) || attempt >= 3) throw error;
    }
  }
}
