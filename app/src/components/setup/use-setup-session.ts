"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getProjectSetupQueryKey, updateProjectSetup } from "@/hooks/use-project-setup";
import type { SetupDraft } from "@/lib/setup/draft-schema";
import type { SetupStepKey } from "@/lib/setup/persona";
import type { SetupLockInfo, SetupStateDto, SetupUpdateRequest } from "@/lib/setup/types";

type Tracked = {
  draft: SetupDraft;
  skipped: SetupStepKey[];
  currentStep: SetupStepKey | null;
  statusPageOptOut: boolean;
  status: SetupStateDto["status"];
};
type TrackedKey = keyof Tracked;

export type SaveState = "idle" | "saving" | "saved" | "error";

const fromState = (s: SetupStateDto): Tracked => ({
  draft: s.draft,
  skipped: s.skipped,
  currentStep: s.currentStep,
  statusPageOptOut: s.statusPageOptOut,
  status: s.status,
});

/**
 * Local copy of the setup state with debounced, serialized autosave. Writes carry
 * `expectedUpdatedAt`; on a 409 the server state replaces the local one and the user is told.
 */
export function useSetupSession(projectId: string, initial: SetupStateDto, debounceMs = 800) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<Tracked>(() => fromState(initial));
  const latest = useRef(state);
  const updatedAt = useRef(initial.updatedAt);
  const dirty = useRef(new Set<TrackedKey>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const flush = useCallback((): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    chain.current = chain.current.then(async () => {
      if (dirty.current.size === 0) return;
      const keys = [...dirty.current];
      dirty.current.clear();
      const body: SetupUpdateRequest = { expectedUpdatedAt: updatedAt.current };
      for (const key of keys) (body as Record<string, unknown>)[key] = latest.current[key];
      setSaveState("saving");
      try {
        const res = await updateProjectSetup(projectId, body);
        updatedAt.current = res.state.updatedAt;
        setSaveState("saved");
        queryClient.setQueryData(getProjectSetupQueryKey(projectId), res);
      } catch (error) {
        const failure = error as { status?: number; body?: { state?: SetupStateDto } };
        if (failure.status === 409 && failure.body?.state) {
          const server = failure.body.state;
          latest.current = fromState(server);
          updatedAt.current = server.updatedAt;
          setState(latest.current);
          setSaveState("idle");
          toast.error("Setup was changed somewhere else. Your view was reloaded with the saved version.");
          return;
        }
        for (const key of keys) dirty.current.add(key);
        setSaveState("error");
      }
    });
    return chain.current;
  }, [projectId, queryClient]);

  const patch = useCallback(
    (partial: Partial<Tracked>) => {
      latest.current = { ...latest.current, ...partial };
      setState(latest.current);
      for (const key of Object.keys(partial) as TrackedKey[]) dirty.current.add(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), debounceMs);
    },
    [debounceMs, flush],
  );

  const patchDraft = useCallback(
    (fn: (draft: SetupDraft) => SetupDraft) => patch({ draft: fn(latest.current.draft) }),
    [patch],
  );

  /** Persist an id into draft.created right away (used by the create runner). */
  const recordCreated = useCallback(
    async (key: string, id: string) => {
      patch({ draft: { ...latest.current.draft, created: { ...latest.current.draft.created, [key]: id } } });
      await flush();
    },
    [patch, flush],
  );
  const getCreated = useCallback(() => latest.current.draft.created ?? {}, []);

  useEffect(() => () => void flush(), [flush]);

  return { ...state, saveState, patch, patchDraft, flush, recordCreated, getCreated };
}

/** Take the lock on mount, heartbeat every 60 s, release on unmount. Another holder makes it read-only. */
export function useSetupLock(projectId: string, enabled: boolean, initialHolder: SetupLockInfo | null) {
  const [holder, setHolder] = useState<SetupLockInfo | null>(initialHolder && !initialHolder.mine ? initialHolder : null);
  const held = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const url = `/api/projects/${projectId}/setup/lock`;
    const take = async () => {
      try {
        const res = await fetch(url, { method: "POST" });
        if (cancelled) return;
        if (res.status === 423) {
          const body = (await res.json().catch(() => ({}))) as { lock?: SetupLockInfo };
          held.current = false;
          setHolder(body.lock ?? { userId: "", userName: null, lockedAt: new Date().toISOString(), mine: false });
        } else if (res.ok) {
          held.current = true;
          setHolder(null);
        }
      } catch {
        // A missed heartbeat is retried on the next tick; the lock expires only after 15 minutes.
      }
    };
    void take();
    const interval = setInterval(() => void take(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      if (held.current) void fetch(url, { method: "DELETE", keepalive: true }).catch(() => undefined);
      held.current = false;
    };
  }, [projectId, enabled]);

  return { holder, readOnly: holder !== null };
}
