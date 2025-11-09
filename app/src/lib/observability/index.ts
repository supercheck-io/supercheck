/**
 * Observability module exports - ClickHouse Direct Access
 */

// Export ClickHouse query functions as main API
export { searchTracesClickHouse as searchTraces, searchLogsClickHouse as searchLogs } from "./clickhouse-client";

// Export API functions from client
export {
  getTrace,
  getTraceByRunId,
  getServiceMetrics,
  queryMetrics,
} from "./client";

// Export utility functions from client
export {
  buildSpanTree,
  flattenSpanTree,
  findCriticalPath,
  buildFlamegraph,
  extractSuperCheckAttributes,
  extractHttpAttributes,
  extractDbAttributes,
  formatDuration,
  getTimeRangePreset,
  groupPlaywrightSteps,
  groupK6Scenarios,
} from "./client";
