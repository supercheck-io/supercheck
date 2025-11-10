/**
 * Execution Log Processor
 *
 * Filters logs to only emit test/job/monitor execution-related logs.
 * This removes noise from infrastructure operations (S3, Redis, DB, etc.)
 * and focuses on what users care about: their test executions.
 *
 * Logs are included if they meet ANY of these criteria:
 * 1. Have execution context (sc.run_id, sc.job_id, sc.monitor_id)
 * 2. Come from execution services (ExecutionService, K6ExecutionService)
 * 3. Come from external instrumented applications (have traceparent correlation)
 * 4. Are ERROR level (always show errors for debugging)
 */

import {
  LogRecordProcessor,
  LogRecord,
  ReadableLogRecord,
} from '@opentelemetry/sdk-logs';
import { SeverityNumber } from '@opentelemetry/api-logs';

/**
 * Configuration for execution log filtering
 */
export interface ExecutionLogFilterConfig {
  /**
   * If true, filter logs to only show execution-related logs
   * @default true
   */
  enableFiltering: boolean;

  /**
   * Always allow ERROR and FATAL logs regardless of context
   * @default true
   */
  alwaysShowErrors: boolean;

  /**
   * Service/context names that should always be included
   * @default ['ExecutionService', 'K6ExecutionService', 'PlaywrightExecutor', 'TestRunner']
   */
  allowedContexts: string[];

  /**
   * Attributes that indicate this is an execution log
   * If ANY of these attributes are present, the log is included
   * @default ['sc.run_id', 'sc.job_id', 'sc.monitor_id', 'sc.test_id']
   */
  executionAttributes: string[];

  /**
   * If true, logs from external apps (with traceparent but no sc.* attributes) are included
   * @default true
   */
  includeExternalAppLogs: boolean;
}

const DEFAULT_CONFIG: ExecutionLogFilterConfig = {
  enableFiltering: true,
  alwaysShowErrors: true,
  allowedContexts: [
    'ExecutionService',
    'K6ExecutionService',
    'K6JobExecutionProcessor',
    'PlaywrightJobExecutionProcessor',
    'PlaywrightExecutor',
    'TestRunner',
  ],
  executionAttributes: ['sc.run_id', 'sc.job_id', 'sc.monitor_id', 'sc.test_id'],
  includeExternalAppLogs: true,
};

/**
 * Custom LogRecordProcessor that filters logs to only show execution-related logs
 */
export class ExecutionLogProcessor implements LogRecordProcessor {
  private readonly config: ExecutionLogFilterConfig;
  private readonly wrappedProcessor: LogRecordProcessor;

  constructor(
    wrappedProcessor: LogRecordProcessor,
    config?: Partial<ExecutionLogFilterConfig>,
  ) {
    this.wrappedProcessor = wrappedProcessor;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Determine if a log record should be included based on filtering rules
   */
  private shouldIncludeLog(logRecord: ReadableLogRecord): boolean {
    // If filtering is disabled, include everything
    if (!this.config.enableFiltering) {
      return true;
    }

    const attributes = logRecord.attributes || {};

    // Always show ERROR and FATAL logs for debugging
    if (this.config.alwaysShowErrors) {
      const severity = logRecord.severityNumber;
      if (
        severity !== undefined &&
        severity >= SeverityNumber.ERROR
      ) {
        return true;
      }
    }

    // Check if log has execution context attributes
    const hasExecutionContext = this.config.executionAttributes.some(
      (attr) => attributes[attr] !== undefined,
    );
    if (hasExecutionContext) {
      return true;
    }

    // Check if log comes from an allowed context/service
    const context = attributes['context'] as string | undefined;
    const service = attributes['service.name'] as string | undefined;
    const source = context || service;

    if (source && this.config.allowedContexts.some((ctx) => source.includes(ctx))) {
      return true;
    }

    // Check if this is from an external instrumented app
    // External apps will have trace_id (correlation) but may not have sc.* attributes initially
    if (this.config.includeExternalAppLogs) {
      const hasTraceContext = attributes['trace_id'] !== undefined;
      const isExternalApp =
        hasTraceContext &&
        !attributes['service.name']?.toString().includes('supercheck-worker');

      if (isExternalApp) {
        return true;
      }
    }

    // Check for K6 specific logs (from K6 stdout/stderr)
    if (attributes['k6.run_id'] || attributes['k6.source']) {
      return true;
    }

    // Check for Playwright specific logs
    if (attributes['playwright.run_id'] || attributes['playwright.test_id']) {
      return true;
    }

    // Default: exclude the log
    return false;
  }

  onEmit(logRecord: LogRecord): void {
    // Only forward to wrapped processor if log should be included
    if (this.shouldIncludeLog(logRecord)) {
      this.wrappedProcessor.onEmit(logRecord);
    }
    // Otherwise, silently drop the log
  }

  async forceFlush(): Promise<void> {
    return this.wrappedProcessor.forceFlush();
  }

  async shutdown(): Promise<void> {
    return this.wrappedProcessor.shutdown();
  }
}

/**
 * Create a filtered log processor
 * Wraps a BatchLogRecordProcessor with execution log filtering
 */
export function createExecutionLogProcessor(
  wrappedProcessor: LogRecordProcessor,
  config?: Partial<ExecutionLogFilterConfig>,
): ExecutionLogProcessor {
  return new ExecutionLogProcessor(wrappedProcessor, config);
}
