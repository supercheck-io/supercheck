import { polarUsageService } from "@/lib/services/polar-usage.service";

/**
 * True when the organization's hard-stop overage cap is reached, so the worker skips new
 * browser (synthetic_test) checks. Other monitor types keep running. Never throws: a failed
 * lookup reports no hold, so a billing outage cannot change what a status page shows.
 */
export async function isSyntheticBillingHold(organizationId: string): Promise<boolean> {
  try {
    return (await polarUsageService.shouldBlockUsage(organizationId)).blocked;
  } catch {
    return false;
  }
}

/** A component is held only if every linked monitor is a held browser check. */
export function heldComponentIds(
  links: { componentId: string; monitorType: string }[],
): Set<string> {
  const types = new Map<string, Set<string>>();
  for (const link of links) {
    const set = types.get(link.componentId) ?? new Set<string>();
    set.add(link.monitorType);
    types.set(link.componentId, set);
  }
  return new Set([...types].filter(([, set]) => set.size === 1 && set.has("synthetic_test")).map(([id]) => id));
}
