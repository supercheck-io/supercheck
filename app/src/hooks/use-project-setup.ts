"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserPersona } from "@/db/schema/project-setup";
import type {
  SetupResponse,
  SetupUpdateRequest,
  UserPreferencesDto,
} from "@/lib/setup/types";

export const PROJECT_SETUP_QUERY_KEY = ["project-setup"] as const;
export const getProjectSetupQueryKey = (projectId: string | null | undefined) =>
  [...PROJECT_SETUP_QUERY_KEY, projectId ?? "none"] as const;
export const USER_PREFERENCES_QUERY_KEY = ["user-preferences"] as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      (body as { error?: string }).error ?? `Request failed (${response.status})`,
    ) as Error & { status?: number; body?: unknown };
    error.status = response.status;
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

/** Setup state + checklist for a project; disabled until a project id is known. */
export function useProjectSetup(projectId: string | null | undefined) {
  return useQuery({
    queryKey: getProjectSetupQueryKey(projectId),
    queryFn: () => fetchProjectSetup(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 30_000,
    retry: 1,
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
