import { useQuery } from "@tanstack/react-query";

export const PROJECT_SECRETS_QUERY_KEY = ["project-secret-names"] as const;

type VariableRow = { key: string; isSecret?: boolean; type?: string };

/** Names (never values) of the project's secret variables, from the existing variables route. */
async function fetchSecretNames(projectId: string): Promise<string[]> {
  const response = await fetch(`/api/projects/${projectId}/variables`);
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.success) throw new Error(body?.error || "The secrets could not be loaded.");
  return (body.data as VariableRow[])
    .filter((v) => v.isSecret === true || v.type === "secret")
    .map((v) => v.key)
    .sort((a, b) => a.localeCompare(b));
}

export function useProjectSecretNames(projectId: string | null | undefined) {
  return useQuery({
    queryKey: [...PROJECT_SECRETS_QUERY_KEY, projectId],
    queryFn: () => fetchSecretNames(projectId as string),
    enabled: Boolean(projectId),
    staleTime: 30_000,
  });
}
