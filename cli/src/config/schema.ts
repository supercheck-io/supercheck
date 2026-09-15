import { z } from 'zod'

// --- Leaf schemas ---

export const tagDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  color: z.string().optional(),
})

export const variableDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  key: z.string().min(1),
  value: z.string(),
  isSecret: z.boolean().default(false),
  description: z.string().optional(),
})

export const notificationProviderDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['email', 'slack', 'webhook', 'telegram', 'discord', 'teams']),
  config: z.record(z.unknown()),
})

// --- Alert Config ---

/** Base alert configuration shared by monitors and jobs. */
export const alertConfigSchema = z.object({
  enabled: z.boolean().optional(),
  notificationProviders: z.array(z.string()).optional(),
  alertOnFailure: z.boolean().optional(),
  alertOnSuccess: z.boolean().optional(),
  alertOnTimeout: z.boolean().optional(),
  alertOnRecovery: z.boolean().optional(),
  alertOnSslExpiration: z.boolean().optional(),
  failureThreshold: z.number().int().positive().optional(),
  recoveryThreshold: z.number().int().positive().optional(),
  customMessage: z.string().optional(),
}).passthrough()

// --- Playwright & k6 ---

export const playwrightTestConfigSchema = z.object({
  testMatch: z.string().default('_supercheck_/playwright/**/*.pw.ts'),
  browser: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
})

export const k6TestConfigSchema = z.object({
  testMatch: z.string().default('_supercheck_/k6/**/*.k6.ts'),
})

export const testsConfigSchema = z.object({
  playwright: playwrightTestConfigSchema.optional(),
  k6: k6TestConfigSchema.optional(),
})

// --- Monitors ---

export const monitorDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  type: z.enum(['http_request', 'website', 'ping_host', 'port_check', 'synthetic_test']),
  target: z.string().optional(),
  frequencyMinutes: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  alertConfig: alertConfigSchema.optional(),
  tags: z.array(z.string()).optional(),
})

// --- Jobs ---

export const jobDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  jobType: z.enum(['playwright', 'k6']).optional(),
  tests: z.array(z.string()).min(1),
  cronSchedule: z.string().optional(),
  status: z.string().optional(),
  alertConfig: alertConfigSchema.optional(),
  tags: z.array(z.string()).optional(),
})

// --- Status Pages ---

export const statusPageComponentDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  monitors: z.array(z.string()).optional(),
  position: z.number().int().min(0).optional(),
})

export const statusPageDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  subdomain: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  description: z.string().optional(),
  headline: z.string().optional(),
  supportUrl: z.string().optional(),
  language: z.string().min(2).max(10).optional(),
  components: z.array(statusPageComponentDefinitionSchema).optional(),
  branding: z.object({
    bodyBackgroundColor: z.string().optional(),
    fontColor: z.string().optional(),
    greens: z.string().optional(),
    reds: z.string().optional(),
  }).optional(),
  notifications: z.object({
    allowEmailSubscribers: z.boolean().default(true),
    allowWebhookSubscribers: z.boolean().default(false),
    allowRssFeed: z.boolean().default(true),
  }).optional(),
})

// --- Project, API, Defaults ---

export const projectConfigSchema = z.object({
  organization: z.string().min(1),
  project: z.string().min(1),
})

export const apiConfigSchema = z.object({
  baseUrl: z.string().url().default('https://app.supercheck.io'),
})

export const defaultsConfigSchema = z.object({
  runLocation: z.string().optional(),
  timeout: z.number().int().positive().optional(),
})

// --- Root config ---

export const supercheckConfigSchema = z.object({
  schemaVersion: z.literal('1.0'),
  project: projectConfigSchema,
  api: apiConfigSchema.optional(),
  defaults: defaultsConfigSchema.optional(),
  tests: testsConfigSchema.optional(),
  monitors: z.union([
    z.string(),
    z.array(monitorDefinitionSchema),
  ]).optional(),
  statusPages: z.union([
    z.string(),
    z.array(statusPageDefinitionSchema),
  ]).optional(),
  jobs: z.array(jobDefinitionSchema).optional(),
  notificationProviders: z.array(notificationProviderDefinitionSchema).optional(),
  variables: z.array(variableDefinitionSchema).optional(),
  tags: z.array(tagDefinitionSchema).optional(),
})

// --- Inferred types ---

export type AlertConfig = z.infer<typeof alertConfigSchema>
export type SupercheckConfig = z.infer<typeof supercheckConfigSchema>
export type SupercheckUserConfig = z.input<typeof supercheckConfigSchema>
export type ProjectConfig = z.infer<typeof projectConfigSchema>
export type ApiConfig = z.infer<typeof apiConfigSchema>
export type DefaultsConfig = z.infer<typeof defaultsConfigSchema>
export type TestsConfig = z.infer<typeof testsConfigSchema>
export type PlaywrightTestConfig = z.infer<typeof playwrightTestConfigSchema>
export type K6TestConfig = z.infer<typeof k6TestConfigSchema>
export type MonitorDefinition = z.infer<typeof monitorDefinitionSchema>
export type JobDefinition = z.infer<typeof jobDefinitionSchema>
export type StatusPageDefinition = z.infer<typeof statusPageDefinitionSchema>
export type StatusPageComponentDefinition = z.infer<typeof statusPageComponentDefinitionSchema>
export type NotificationProviderDefinition = z.infer<typeof notificationProviderDefinitionSchema>
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>
export type TagDefinition = z.infer<typeof tagDefinitionSchema>
