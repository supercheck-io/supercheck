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
  mcp_tools_changed: {
    monitorTypes: ['mcp_server'],
    label: 'Tools changed',
    help: "Notify when the server's tool list, a tool description or an input schema changes.",
    defaultOn: true,
  },
  mcp_slow: {
    monitorTypes: ['mcp_server'],
    label: 'MCP slow',
    help: 'Notify when checks are slower than Slow after (ms) for 3 checks in a row. Sends nothing until that limit is set.',
    defaultOn: true,
  },
  ai_slow_first_token: {
    monitorTypes: ['http_request'],
    aiEndpointOnly: true,
    label: 'Slow first token',
    help: 'Notify when the first token is slower than Warn first token (ms) for 3 checks in a row. Sends nothing until that limit is set.',
    defaultOn: true,
  },
  ai_model_changed: {
    monitorTypes: ['http_request'],
    aiEndpointOnly: true,
    label: 'Model changed',
    help: 'Notify when the reply comes from a different model than the last check.',
    defaultOn: true,
  },
  ai_tokens_high: {
    monitorTypes: ['http_request'],
    aiEndpointOnly: true,
    label: 'Tokens high',
    help: 'Notify when a reply uses more tokens than Warn total tokens. Sends nothing until that limit is set.',
    defaultOn: true,
  },
  agent_run_failed: {
    monitorTypes: ['synthetic_test'],
    agentTestOnly: true,
    label: 'Single failed agent run',
    help: 'An agent test run failed before the failure threshold; no incident.',
    defaultOn: true,
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
    case 'mcp_tools_changed':
      return `Tools changed - ${monitorName}`;
    case 'mcp_slow':
      return `MCP server slow - ${monitorName}`;
    case 'ai_slow_first_token':
      return `Slow first token - ${monitorName}`;
    case 'ai_model_changed':
      return `Model changed - ${monitorName}`;
    case 'ai_tokens_high':
      return `High token use - ${monitorName}`;
    case 'agent_run_failed':
      return `Agent run failed - ${monitorName}`;
  }
}

/** `ssl_renewed` and `monitor_warning` notify only: no incident triage, no incident open/resolve. */
export function isInformationalAlertType(type: string): boolean {
  return type === 'ssl_renewed' || type === 'monitor_warning';
}
