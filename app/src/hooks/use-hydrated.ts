import { useSyncExternalStore } from "react";

const subscribeNever = () => () => {};

/**
 * False while the page hydrates. The server HTML has no query data, but a restored browser cache can have it
 * before a late-hydrating component renders (and a fetch can already be running), so data and loading flags
 * are shown only after hydration to avoid a mismatch (#418).
 */
export function useHydrated() {
  return useSyncExternalStore(subscribeNever, () => true, () => false);
}
