import type { NextBullBoardAdapterState } from "@/lib/bull-board/next-adapter";

let bullBoardInitialized = false;
let cachedState: NextBullBoardAdapterState | null = null;
let initializationPromise: Promise<NextBullBoardAdapterState> | null = null;

export function getBullBoardState() {
  return { bullBoardInitialized, cachedState, initializationPromise };
}

export function setBullBoardState(state: {
  bullBoardInitialized?: boolean;
  cachedState?: NextBullBoardAdapterState | null;
  initializationPromise?: Promise<NextBullBoardAdapterState> | null;
}) {
  if (state.bullBoardInitialized !== undefined)
    bullBoardInitialized = state.bullBoardInitialized;
  if (state.cachedState !== undefined) cachedState = state.cachedState;
  if (state.initializationPromise !== undefined)
    initializationPromise = state.initializationPromise;
}

/**
 * Invalidate Bull Board so it re-initializes with updated queues.
 * Called when locations are added/removed/changed.
 */
export function invalidateBullBoard(): void {
  bullBoardInitialized = false;
  cachedState = null;
  initializationPromise = null;
}
