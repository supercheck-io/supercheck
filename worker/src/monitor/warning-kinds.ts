/**
 * Mirror of app/src/lib/alerts/warning-kinds.ts (warning-kinds-parity.spec.ts keeps them equal).
 * A warning (alert type `monitor_warning`) notifies non-preset channels and never opens an incident.
 */
export const WARNING_KINDS = {
  heartbeat_late: {
    monitorTypes: ['heartbeat'],
    label: 'Ping is late',
    help: 'Notify when a ping has not arrived on time but the grace period has not ended.',
    defaultOn: false,
  },
} as const;

export type WarningKind = keyof typeof WARNING_KINDS;

export function isWarningKind(kind: string): kind is WarningKind {
  return Object.keys(WARNING_KINDS).includes(kind);
}

export function warningTitle(kind: WarningKind, monitorName: string): string {
  switch (kind) {
    case 'heartbeat_late':
      return `Late ping - ${monitorName}`;
  }
}

/** `ssl_renewed` and `monitor_warning` notify only: no incident triage, no incident open/resolve. */
export function isInformationalAlertType(type: string): boolean {
  return type === 'ssl_renewed' || type === 'monitor_warning';
}
