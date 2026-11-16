"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
export function useSetupSession(projectId: string, initial: SetupStateDto, lockToken?: string, debounceMs = 800) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<Tracked>(() => fromState(initial));
  const latest = useRef(state);
  const updatedAt = useRef(initial.updatedAt);
  const dirty = useRef(new Set<TrackedKey>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const [saveState, setSaveState] = useState<SaveState>("idle");

  /** Whether the last save attempt persisted everything that was dirty. */
  const lastSaveOk = useRef(true);

  /** Resolves true when everything dirty was persisted. */
  const flush = useCallback((): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    chain.current = chain.current.then(async () => {
      // A second attempt only follows a 409 whose merge left local created ids to re-save.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (dirty.current.size === 0) return;
        const keys = [...dirty.current];
        dirty.current.clear();
        const body: SetupUpdateRequest = { expectedUpdatedAt: updatedAt.current, lockToken };
        for (const key of keys) (body as Record<string, unknown>)[key] = latest.current[key];
        setSaveState("saving");
        try {
          const res = await updateProjectSetup(projectId, body);
          updatedAt.current = res.state.updatedAt;
          lastSaveOk.current = true;
          setSaveState("saved");
          queryClient.setQueryData(getProjectSetupQueryKey(projectId), res);
          return;
        } catch (error) {
          const failure = error as { status?: number; body?: { state?: SetupStateDto } };
          if (!(failure.status === 409 && failure.body?.state)) {
            for (const key of keys) dirty.current.add(key);
            lastSaveOk.current = false;
            setSaveState("error");
            return;
          }
          const server = failure.body.state;
          // Ids this tab created must survive the reload, or a re-run would create them again.
          const local = latest.current.draft.created ?? {};
          const unsaved = Object.entries(local).some(([key, id]) => server.draft.created?.[key] !== id);
          latest.current = fromState({ ...server, draft: { ...server.draft, created: { ...server.draft.created, ...local } } });
          updatedAt.current = server.updatedAt;
          setState(latest.current);
          toast.error("Setup was changed somewhere else. Your view was reloaded with the saved version.");
          if (!unsaved) {
            lastSaveOk.current = true;
            setSaveState("idle");
            return;
          }
          dirty.current.add("draft");
        }
      }
      lastSaveOk.current = false;
      setSaveState("error");
    });
    return chain.current.then(() => lastSaveOk.current);
  }, [projectId, queryClient, lockToken]);

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
      // Rejecting shows the item as failed to record instead of silently succeeding.
      if (!lastSaveOk.current) throw new Error("Created, but your progress could not be saved. Check your connection and retry.");
    },
    [patch, flush],
  );
  const getCreated = useCallback(() => latest.current.draft.created ?? {}, []);

  useEffect(() => () => void flush(), [flush]);

  return { ...state, saveState, patch, patchDraft, flush, recordCreated, getCreated };
}

/** Take the lock on mount, heartbeat every 60 s, release on unmount. Another holder makes it read-only. */
export function useSetupLock(projectId: string, enabled: boolean, initialHolder: SetupLockInfo | null, lockToken: string) {
  const [holder, setHolder] = useState<SetupLockInfo | null>(initialHolder && !initialHolder.mine ? initialHolder : null);
  const held = useRef(false);
  const url = `/api/projects/${projectId}/setup/lock`;
  // The token identifies this tab: two tabs of the same user must not both hold the lock.
  const post = useCallback(
    (takeover = false): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lockToken, ...(takeover ? { takeover: true } : {}) }) }),
    [lockToken],
  );
  const drop = useMemo<RequestInit>(
    () => ({ method: "DELETE", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lockToken }) }),
    [lockToken],
  );

  const claim = useCallback(
    async (takeover: boolean) => {
      const res = await fetch(url, post(takeover));
      if (res.ok) {
        held.current = true;
        setHolder(null);
      }
      return res.ok;
    },
    [url, post],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const release = () => {
      if (held.current) void fetch(url, drop).catch(() => undefined);
      held.current = false;
    };
    const take = async () => {
      try {
        const res = await fetch(url, post());
        if (cancelled) {
          // Unmounted while the claim was in flight: it still took the lock, so give it back.
          if (res.ok) void fetch(url, drop).catch(() => undefined);
          return;
        }
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
    // Closing the tab never runs the unmount cleanup reliably, so release on pagehide too.
    window.addEventListener("pagehide", release);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [url, enabled, post, drop]);

  /** Re-claim before a long action writes more; false only when another tab or person holds the lock now. */
  const heartbeat = useCallback(async () => {
    try {
      const res = await fetch(url, post());
      if (res.status !== 423) return true;
      const body = (await res.json().catch(() => ({}))) as { lock?: SetupLockInfo };
      held.current = false;
      setHolder(body.lock ?? { userId: "", userName: null, lockedAt: new Date().toISOString(), mine: false });
      return false;
    } catch {
      return true; // offline: the item's own request fails and reports it
    }
  }, [url, post]);

  /** Needs project:update on the server; the previous holder turns read-only on their next heartbeat. */
  const takeOver = useCallback(async () => {
    try {
      return await claim(true);
    } catch {
      return false;
    }
  }, [claim]);

  return { holder, readOnly: holder !== null, takeOver, heartbeat };
}
