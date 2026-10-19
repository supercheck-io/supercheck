export function matchesSubscriptionScope(
  subscriberId: string,
  incidentId: string,
  affectedComponentIds: Set<string>,
  componentSubscriptions: Array<{ subscriberId: string; componentId: string }>,
  incidentSubscriptions: Array<{ subscriberId: string; incidentId: string }>,
): boolean {
  const components = componentSubscriptions.filter(
    (s) => s.subscriberId === subscriberId,
  );
  const incidents = incidentSubscriptions.filter(
    (s) => s.subscriberId === subscriberId,
  );
  if (components.length === 0 && incidents.length === 0) return true;
  return (
    components.some((s) => affectedComponentIds.has(s.componentId)) ||
    incidents.some((s) => s.incidentId === incidentId)
  );
}
