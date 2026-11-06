const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Says which live signals mark a service unhealthy, naming only the non-zero ones. */
export function describeServiceSignals(input: {
  activeIncidents: number;
  firingAlerts: number;
  critical: boolean;
}): string {
  const parts = [
    input.activeIncidents > 0 ? plural(input.activeIncidents, "active incident") : null,
    input.firingAlerts > 0 ? plural(input.firingAlerts, "firing alert") : null,
  ].filter(Boolean);
  const verb = input.activeIncidents + input.firingAlerts === 1 ? "is" : "are";
  return `${parts.join(" and ")} ${verb} linked to this service${input.critical ? "; at least one is SEV1 or SEV2" : ""}.`;
}
