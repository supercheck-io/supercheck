import { Logger } from '@nestjs/common';

export type MonitorWarningKind =
  | 'mcp_tools_changed'
  | 'mcp_slow'
  | 'ai_slow_first_token'
  | 'ai_model_changed'
  | 'ai_tokens_high';

const logger = new Logger('MonitorWarning');

/**
 * The one place every MCP and AI endpoint warning leaves through. `episodeKey` starts with the kind
 * and names the detection (never a value), so the alert claim stays unique per detection.
 * shortcut: debug log only; becomes MonitorAlertService.sendWarning(monitorId, kind, reason, episodeKey)
 * after rebasing on the heartbeat/warning PR. `reason` is built from numbers and names, never secrets.
 */
export function dispatchMonitorWarning(
  monitorId: string,
  kind: MonitorWarningKind,
  reason: string,
  episodeKey: string,
): Promise<void> {
  logger.debug(
    `Warning ${kind} for monitor ${monitorId}: ${reason} (${episodeKey})`,
  );
  return Promise.resolve();
}
