"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { UserPersona } from "@/db/schema/project-setup";
import type {
  SetupResponse,
  SetupSummary,
  SetupUpdateRequest,
  UserPreferencesDto,
} from "@/lib/setup/types";

export const PROJECT_SETUP_QUERY_KEY = ["project-setup"] as const;
export const getProjectSetupQueryKey = (projectId: string | null | undefined) =>
  [...PROJECT_SETUP_QUERY_KEY, projectId ?? "none"] as const;
export const getProjectSetupSummaryQueryKey = (projectId: string | null | undefined) =>
  [...getProjectSetupQueryKey(projectId), "summary"] as const;
export const USER_PREFERENCES_QUERY_KEY = ["user-preferences"] as const;

// Setup state and the persona flag decide where /setup sends the user. The saved query cache is written on a
// throttle, so a reload right after a write restored the old value and bounced between /setup, /setup/welcome and "/".
const MEMORY_ONLY = { persist: false } as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      (body as { error?: string }).error ?? `Request failed (${response.status})`,
    ) as Error & { status?: number; body?: unknown; retryAfter?: number };
    error.status = response.status;
    error.retryAfter = Number(response.headers?.get("Retry-After")) || undefined;
    error.body = body;
    throw error;
  }
  return body as T;
}

export async function fetchProjectSetup(projectId: string): Promise<SetupResponse> {
  return readJson(await fetch(`/api/projects/${projectId}/setup`, { cache: "no-store" }));
}

export async function updateProjectSetup(
  projectId: string,
  body: SetupUpdateRequest,
): Promise<SetupResponse> {
  return readJson(
    await fetch(`/api/projects/${projectId}/setup`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

/** Store a full setup response and the sidebar summary derived from it, so both stay in step after a write. */
export function setProjectSetupData(queryClient: QueryClient, projectId: string, res: SetupResponse) {
  // A write does not recompute the plan lock (null): keep what the last full read said.
  const previous = queryClient.getQueryData<SetupResponse>(getProjectSetupQueryKey(projectId));
  const aiTestsLocked = res.aiTestsLocked ?? previous?.aiTestsLocked ?? null;
  queryClient.setQueryData(getProjectSetupQueryKey(projectId), { ...res, aiTestsLocked });
  const summary: SetupSummary = { status: res.state.status, done: res.checklist.done, total: res.checklist.total, projectEmpty: res.projectEmpty };
  queryClient.setQueryData(getProjectSetupSummaryQueryKey(projectId), summary);
}

/** Setup state + checklist for a project; disabled until a project id is known. */
export function useProjectSetup(projectId: string | null | undefined) {
  return useQuery({
    queryKey: getProjectSetupQueryKey(projectId),
    queryFn: () => fetchProjectSetup(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: 1,
    meta: MEMORY_ONLY,
  });
}

/** Light read for the sidebar: status, counts and whether the project is empty. */
export function useProjectSetupSummary(projectId: string | null | undefined) {
  return useQuery({
    queryKey: getProjectSetupSummaryQueryKey(projectId),
    queryFn: async (): Promise<SetupSummary> => readJson(await fetch(`/api/projects/${projectId}/setup?summary=1`, { cache: "no-store" })),
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: 1,
    meta: MEMORY_ONLY,
  });
}

export async function fetchUserPreferences(): Promise<UserPreferencesDto> {
  return readJson(await fetch("/api/me/preferences", { cache: "no-store" }));
}

export function useUserPreferences() {
  return useQuery({
    queryKey: USER_PREFERENCES_QUERY_KEY,
    queryFn: fetchUserPreferences,
    staleTime: 5 * 60_000,
    retry: 1,
    meta: MEMORY_ONLY,
  });
}

export function useSavePersona() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (persona: UserPersona | null) =>
      readJson<UserPreferencesDto>(
        await fetch("/api/me/preferences", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ persona }),
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(USER_PREFERENCES_QUERY_KEY, data),
  });
}
