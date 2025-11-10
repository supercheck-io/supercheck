import { logs, SeverityNumber } from '@opentelemetry/api-logs';
import type { SupercheckContext } from './trace-helpers';
import { getCurrentTraceId, getCurrentSpanId } from './trace-helpers';

const MAX_LOG_ATTR_LENGTH = 4000;

export interface TelemetryLogOptions {
  message: string;
  severity?: SeverityNumber;
  ctx?: SupercheckContext;
  attributes?: Record<string, string | number | boolean | undefined>;
  error?: unknown;
}

function sanitizeValue(value: unknown): string | number | boolean {
  if (typeof value === 'string') {
    return value.length > MAX_LOG_ATTR_LENGTH
      ? `${value.slice(0, MAX_LOG_ATTR_LENGTH)}…`
      : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return JSON.stringify(value).slice(0, MAX_LOG_ATTR_LENGTH);
}

export function emitTelemetryLog({
  message,
  severity = SeverityNumber.INFO,
  ctx,
  attributes,
  error,
}: TelemetryLogOptions): void {
  try {
    const logger = logs.getLogger('supercheck-worker');
    const logAttributes: Record<string, string | number | boolean> = {};

    // Automatically include trace context for log correlation
    const traceId = getCurrentTraceId();
    const spanId = getCurrentSpanId();
    if (traceId) logAttributes['trace_id'] = traceId;
    if (spanId) logAttributes['span_id'] = spanId;

    if (ctx?.runId) logAttributes['sc.run_id'] = ctx.runId;
    if (ctx?.testId) logAttributes['sc.test_id'] = ctx.testId;
    if (ctx?.testName) logAttributes['sc.test_name'] = ctx.testName;
    if (ctx?.jobId) logAttributes['sc.job_id'] = ctx.jobId;
    if (ctx?.monitorId) logAttributes['sc.monitor_id'] = ctx.monitorId;
    if (ctx?.projectId) logAttributes['sc.project_id'] = ctx.projectId;
    if (ctx?.organizationId) logAttributes['sc.organization_id'] =
      ctx.organizationId;
    if (ctx?.runType) logAttributes['sc.run_type'] = ctx.runType;

    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        if (value === undefined) {
          return;
        }
        logAttributes[key] = sanitizeValue(value);
      });
    }

    if (error instanceof Error) {
      logAttributes['error.message'] = sanitizeValue(error.message);
      if (error.stack) {
        logAttributes['error.stack'] = sanitizeValue(error.stack);
      }
      logAttributes['error.type'] = error.name;
    } else if (typeof error === 'string') {
      logAttributes['error.message'] = sanitizeValue(error);
    }

    const severityText =
      SeverityNumber[severity] ?? SeverityNumber[SeverityNumber.INFO];

    logger.emit({
      body: message,
      severityNumber: severity,
      severityText: typeof severityText === 'string' ? severityText : 'INFO',
      attributes: logAttributes,
    });
  } catch {
    // Avoid throwing if logging fails
  }
}
