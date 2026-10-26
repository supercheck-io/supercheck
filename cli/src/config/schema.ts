import { z } from 'zod'

// --- Leaf schemas ---

export const tagDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(3).max(20),
  color: z.string().optional(),
}).strict()

export const variableDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  key: z.string().min(4).max(20),
  value: z.string(),
  isSecret: z.boolean().default(false),
  description: z.string().optional(),
}).strict()

export const notificationProviderDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1),
  type: z.enum(['email', 'slack', 'webhook', 'telegram', 'discord', 'teams']),
  config: z.record(z.unknown()),
}).strict()

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
}).strict()

export const k6TestConfigSchema = z.object({
  testMatch: z.string().default('_supercheck_/k6/**/*.k6.ts'),
}).strict()

export const testsConfigSchema = z.object({
  playwright: playwrightTestConfigSchema.optional(),
  k6: k6TestConfigSchema.optional(),
}).strict()

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
}).strict()

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
}, {
  errorMap: (issue, ctx) => {
    if (issue.code === 'unrecognized_keys' && issue.keys.includes('tags')) {
      const name = (ctx.data as { name?: unknown } | undefined)?.name
      return { message: `Jobs do not support tags; remove \`tags\` from job "${typeof name === 'string' ? name : '?'}"` }
    }
    return { message: ctx.defaultError }
  },
}).strict()

// --- Status Pages ---

/** Mirrors the server's support contact rule: empty (clears it), an email address, or an http(s)/mailto URL. */
function isSupportContact(value: string): boolean {
  if (value === '' || /^[^\s@:]+@[^\s@]+\.[^\s@]+$/.test(value)) return true
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export const statusPageComponentDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  monitors: z.array(z.string()).max(100).optional(),
  position: z.number().int().min(0).max(1000).optional(),
}).strict()

const hexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Expected a #RRGGBB hex color')

export const statusPageBrandingSchema = z.object({
  bodyBackgroundColor: hexColor.optional(),
  fontColor: hexColor.optional(),
  lightFontColor: hexColor.optional(),
  greens: hexColor.optional(),
  yellows: hexColor.optional(),
  oranges: hexColor.optional(),
  blues: hexColor.optional(),
  reds: hexColor.optional(),
  borderColor: hexColor.optional(),
  graphColor: hexColor.optional(),
  linkColor: hexColor.optional(),
  noData: hexColor.optional(),
}).strict()

/** No defaults: an absent flag means "leave the remote value alone". */
export const statusPageNotificationsSchema = z.object({
  allowPageSubscribers: z.boolean().optional(),
  allowEmailSubscribers: z.boolean().optional(),
  allowWebhookSubscribers: z.boolean().optional(),
  allowSlackSubscribers: z.boolean().optional(),
  allowIncidentSubscribers: z.boolean().optional(),
  allowRssFeed: z.boolean().optional(),
}).strict()

export const statusPageDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  name: z.string().min(1).max(255),
  /** Read-only: written by `pull`, never compared and never sent (the server generates it). */
  subdomain: z.string().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  description: z.string().max(2000).optional(),
  headline: z.string().max(255).optional(),
  supportUrl: z.string().trim().max(500).refine(isSupportContact, 'Expected an email address or an http(s)/mailto URL').optional(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Z]{2})?$/, 'Expected a language code such as "en" or "pt-BR"').optional(),
  timezone: z.string().max(50).optional(),
  customDomain: z.string().max(255).regex(/^$|^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, 'Expected a domain such as status.example.com').optional(),
  components: z.array(statusPageComponentDefinitionSchema).optional(),
  branding: statusPageBrandingSchema.optional(),
  notifications: statusPageNotificationsSchema.optional(),
}).strict()

// --- Requirements ---

export const requirementDefinitionSchema = z.object({
  /** Database UUID. Present for existing resources, omitted for new ones. */
  id: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(10).optional(),
  externalId: z.string().max(255).optional(),
  /** "" clears it. */
  externalUrl: z.string().url().or(z.literal('')).optional(),
  /** Linked tests, referenced the same way as a job's `tests` (file path, filename or UUID). */
  tests: z.array(z.string()).max(100).optional(),
}).strict()

// --- Project, API, Defaults ---

export const projectConfigSchema = z.object({
  organization: z.string().min(1),
  project: z.string().min(1),
}).strict()

export const apiConfigSchema = z.object({
  baseUrl: z.string().url().default('https://app.supercheck.io'),
}).strict()

export const defaultsConfigSchema = z.object({
  runLocation: z.string().optional(),
  timeout: z.number().int().positive().optional(),
}).strict()

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
  requirements: z.array(requirementDefinitionSchema).optional(),
  notificationProviders: z.array(notificationProviderDefinitionSchema).optional(),
  variables: z.array(variableDefinitionSchema).optional(),
  tags: z.array(tagDefinitionSchema).optional(),
}).strict()

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
export type RequirementDefinition = z.infer<typeof requirementDefinitionSchema>
export type StatusPageDefinition = z.infer<typeof statusPageDefinitionSchema>
export type StatusPageComponentDefinition = z.infer<typeof statusPageComponentDefinitionSchema>
export type NotificationProviderDefinition = z.infer<typeof notificationProviderDefinitionSchema>
export type VariableDefinition = z.infer<typeof variableDefinitionSchema>
export type TagDefinition = z.infer<typeof tagDefinitionSchema>
