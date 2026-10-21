// DTO for data passed in a monitor execution job
// This should reflect the data needed from the 'monitors' table in schema.ts

import {
  MonitorType,
  MonitorConfig,
  MonitoringLocation,
} from '../../db/schema';

// Re-export types for compatibility
export { MonitorType, MonitorConfig };

export class MonitorJobDataDto {
  monitorId: string; // From monitors.id
  type: MonitorType; // From monitors.type
  target: string; // From monitors.target
  config?: MonitorConfig; // From monitors.config
  frequencyMinutes?: number; // From monitors.frequencyMinutes, for scheduling decisions
  executionLocation?: MonitoringLocation;
  executionGroupId?: string;
  expectedLocations?: MonitoringLocation[];
  aggregationOnly?: boolean;
  /** Set by the app when MISSING_CYCLE_CLOSURE_ENABLED persisted a cycle row for executionGroupId. */
  monitorCycle?: boolean;
}
