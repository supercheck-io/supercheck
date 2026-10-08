import type { NextBullBoardAdapterState } from "@/lib/bull-board/next-adapter";

const BULL_BOARD_STATE_KEY = "__SUPERCHECK_BULL_BOARD_STATE__";

type BullBoardRuntime = {
  bullBoardInitialized: boolean;
  cachedState: NextBullBoardAdapterState | null;
  initializationPromise: Promise<NextBullBoardAdapterState> | null;
  /** Enabled-location signature the cached board was built from. */
  locationSignature: string | null;
};

function getRuntime(): BullBoardRuntime {
  const scope = globalThis as typeof globalThis & {
    [BULL_BOARD_STATE_KEY]?: BullBoardRuntime;
  };
  if (!scope[BULL_BOARD_STATE_KEY]) {
    scope[BULL_BOARD_STATE_KEY] = {
      bullBoardInitialized: false,
      cachedState: null,
      initializationPromise: null,
      locationSignature: null,
    };
  }
  return scope[BULL_BOARD_STATE_KEY];
}

export function getBullBoardState() {
  const runtime = getRuntime();
  return {
    bullBoardInitialized: runtime.bullBoardInitialized,
    cachedState: runtime.cachedState,
    initializationPromise: runtime.initializationPromise,
    locationSignature: runtime.locationSignature,
  };
}

export function setBullBoardState(state: {
  bullBoardInitialized?: boolean;
  cachedState?: NextBullBoardAdapterState | null;
  initializationPromise?: Promise<NextBullBoardAdapterState> | null;
  locationSignature?: string | null;
}) {
  const runtime = getRuntime();
  if (state.bullBoardInitialized !== undefined)
    runtime.bullBoardInitialized = state.bullBoardInitialized;
  if (state.cachedState !== undefined) runtime.cachedState = state.cachedState;
  if (state.initializationPromise !== undefined)
    runtime.initializationPromise = state.initializationPromise;
  if (state.locationSignature !== undefined)
    runtime.locationSignature = state.locationSignature;
}

/**
 * Invalidate Bull Board so it re-initializes with updated queues.
 * Called when locations are added, removed, or changed.
 * Stored on globalThis so every Next.js server chunk sees the same board.
 */
export function invalidateBullBoard(): void {
  const runtime = getRuntime();
  runtime.bullBoardInitialized = false;
  runtime.cachedState = null;
  runtime.locationSignature = null;
}
