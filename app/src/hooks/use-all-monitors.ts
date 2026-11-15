"use client";

import { useQuery } from "@tanstack/react-query";

import { useProjectContext } from "@/hooks/use-project-context";

/** All monitors in the project, page by page (at most 2,000): the API caps a page at 100. Names and ids only. */
export async function fetchAllMonitors(): Promise<Array<{ id: string; name: string }>> {
  const all: Array<{ id: string; name: string }> = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(`/api/monitors?page=${page}&limit=100`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { data: Array<{ id: string; name: string }>; pagination?: { hasNextPage?: boolean } };
    all.push(...body.data.map(({ id, name }) => ({ id, name })));
    if (!body.pagination?.hasNextPage) break;
  }
  return all;
}

/** For pickers: every monitor's id and name, loaded only while `enabled`. */
export function useAllMonitors(enabled: boolean) {
  const { projectId } = useProjectContext();
  return useQuery({ queryKey: ["monitors", "picker", projectId], queryFn: fetchAllMonitors, enabled: enabled && Boolean(projectId), staleTime: 60_000 });
}
