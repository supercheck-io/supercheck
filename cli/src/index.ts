/**
 * @supercheck/cli — Public API
 *
 * This module exports the defineConfig helper and all types
 * needed by users authoring supercheck.config.ts files.
 */

export { defineConfig } from './config/define-config.js'

export type {
  SupercheckConfig,
  AlertConfig,
  ProjectConfig,
  ApiConfig,
  DefaultsConfig,
  TestsConfig,
  PlaywrightTestConfig,
  K6TestConfig,
  MonitorDefinition,
  JobDefinition,
  StatusPageDefinition,
  StatusPageComponentDefinition,
  NotificationProviderDefinition,
  VariableDefinition,
  TagDefinition,
} from './config/schema.js'
