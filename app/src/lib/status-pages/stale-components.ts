export interface ComponentMonitorFreshness {
  componentId: string;
  enabled: boolean;
  status: string | null;
  frequencyMinutes: number;
  lastCheckAt: Date | null;
  createdAt: Date | null;
}

const MIN_STALE_MS = 15 * 60_000;

/**
 * Components whose every linked, running monitor has missed several checks, so the stored
 * status is stale. Uses only check times, so the public page never reveals why checks stopped.
 * Paused and disabled monitors are ignored; a never-checked monitor counts from its creation.
 */
export function staleComponentIds(links: ComponentMonitorFreshness[], now = Date.now()): Set<string> {
  const fresh = new Set<string>();
  const stale = new Set<string>();
  for (const link of links) {
    // Paused and disabled monitors say nothing about freshness, either way.
    if (!link.enabled || link.status === "paused") continue;
    const since = link.lastCheckAt ?? link.createdAt;
    if (!since) continue;
    const overdue = now - since.getTime() > Math.max(3 * link.frequencyMinutes * 60_000, MIN_STALE_MS);
    (overdue ? stale : fresh).add(link.componentId);
  }
  return new Set([...stale].filter((id) => !fresh.has(id)));
}
