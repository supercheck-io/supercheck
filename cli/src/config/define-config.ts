import type { SupercheckUserConfig } from './schema.js'

/**
 * Type-safe helper for authoring supercheck.config.ts files.
 * Provides full IntelliSense and compile-time validation.
 *
 * @example
 * ```typescript
 * // supercheck.config.ts
 * import { defineConfig } from '@supercheck/cli'
 *
 * export default defineConfig({
 *   schemaVersion: '1.0',
 *   project: {
 *     organization: 'acme-inc',
 *     project: 'web-app',
 *   },
 * })
 * ```
 */
export function defineConfig(config: SupercheckUserConfig): SupercheckUserConfig {
  return config
}
