import { z } from "zod";

import { keySchema } from "@/lib/validations/variable";
import { SETUP_STEP_KEYS } from "./persona";

/**
 * The setup draft holds non-secret choices only (spec 6). Every level is `.strict()`, so an
 * unknown key (a token pasted into the wrong field, an old client) is rejected, and stored URLs
 * keep only origin + path: no query, fragment or userinfo.
 */
export const MAX_DRAFT_BYTES = 32 * 1024;

/** Per-field limits, shared by the server schema below and the setup UI, so both reject the same values. */
export const SETUP_LIMITS = { maxPages: 20, maxUrlChars: 2048, maxNameChars: 255, maxModelChars: 200, maxChannels: 10 } as const;

/** Non-secret query parameters an AI endpoint URL may keep (Azure OpenAI needs api-version). Every other parameter can carry a key. */
export const AI_ENDPOINT_QUERY_ALLOWLIST = ["api-version"] as const;
const SAFE_QUERY_VALUE = /^[A-Za-z0-9._-]{1,40}$/;

/** Origin + path of an http(s) URL, plus any allow-listed non-secret query params; null when it is not one. */
export function stripUrl(raw: string, keepParams: readonly string[] = []): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const kept = new URLSearchParams();
  for (const key of keepParams) {
    const value = url.searchParams.get(key);
    if (value !== null && SAFE_QUERY_VALUE.test(value)) kept.set(key, value);
  }
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ""}`;
}

function urlSchema(opts: { keepParams?: readonly string[]; httpsOnly?: boolean } = {}) {
  return z
    .string()
    .max(SETUP_LIMITS.maxUrlChars)
    .transform((value, ctx) => {
      const stripped = stripUrl(value, opts.keepParams);
      if (!stripped || (opts.httpsOnly && !stripped.startsWith("https:"))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: opts.httpsOnly ? "Must be an https URL" : "Must be an http(s) URL" });
        return z.NEVER;
      }
      return stripped;
    });
}

export const setupUrlSchema = urlSchema();
export const aiEndpointUrlSchema = urlSchema({ keepParams: AI_ENDPOINT_QUERY_ALLOWLIST });
/** Matches the monitor validation: an MCP target must be https. */
export const mcpUrlSchema = urlSchema({ httpsOnly: true });
const safeUrl = setupUrlSchema;

/** First error message of `schema` for `value`, or null when it passes. The UI uses this with the schemas the server uses. */
export function schemaError(schema: z.ZodTypeAny, value: unknown): string | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? "Invalid value");
}

/** Secret NAMES only, same rule as project variables; a pasted key cannot match it. "" = not set. */
export const secretNameSchema = keySchema;
const secretName = keySchema.or(z.literal(""));
const uuid = z.string().uuid();
export const setupNameSchema = z.string().trim().min(1, "Required").max(SETUP_LIMITS.maxNameChars);
export const setupModelSchema = z.string().trim().min(1, "Required").max(SETUP_LIMITS.maxModelChars);
const name = setupNameSchema;

/** Created item ids per review item key, so Retry and re-run never duplicate (D11, D10). */
const created = z.record(z.string().max(120), uuid).refine((value) => Object.keys(value).length <= 100, {
  message: "Too many created items",
});

const appStep = z
  .object({
    url: safeUrl.optional(),
    /** The (stripped) URL the latest scan was submitted for: a redirect to another domain still belongs to it. */
    scannedUrl: safeUrl.optional(),
    /** Name of the project secret holding the test account (the value is never here). */
    testAccountSecret: secretName.optional(),
  })
  .strict();

const alertsStep = z
  .object({
    /** Providers saved at entry time (D8): ids only, never webhook URLs. */
    providerIds: z.array(uuid).max(SETUP_LIMITS.maxChannels).default([]),
    repeatUntilAck: z
      .object({ enabled: z.boolean(), repeatMinutes: z.number().int().min(5).max(1440) })
      .strict()
      .optional(),
    warnings: z.boolean().optional(),
  })
  .strict();

const monitorsStep = z
  .object({
    pages: z.array(z.object({ url: safeUrl, name }).strict()).max(SETUP_LIMITS.maxPages).default([]),
    frequencyMinutes: z.number().int().min(1).max(1440).optional(),
    heartbeat: z.object({ name, frequencyMinutes: z.number().int().min(1).max(44640) }).strict().optional(),
    aiEndpoint: z
      .object({ name, url: aiEndpointUrlSchema, model: setupModelSchema, secretKey: keySchema })
      .strict()
      .optional(),
    mcpMonitor: z
      .object({ name, url: mcpUrlSchema, secretKey: secretName.optional() })
      .strict()
      .optional(),
  })
  .strict();

const statusPageStep = z
  .object({
    name: name.optional(),
    publish: z.boolean().optional(),
    optOut: z.boolean().optional(),
  })
  .strict();

const requirementItem = { title: z.string().trim().min(1).max(500), description: z.string().max(2000).optional() };

const priorityEnum = z.enum(["low", "medium", "high"]).optional();

const testsStep = z
  .object({
    requirements: z.array(z.object({ ...requirementItem, priority: priorityEnum }).strict()).max(50).default([]),
    /** The AI suggestions, ticked or not: a run costs a credit and a daily slot, so leaving the step must not lose them. */
    suggestions: z
      .array(z.object({ ...requirementItem, priority: priorityEnum }).strict())
      .max(10)
      .optional(),
  })
  .strict();

const aiSreStep = z
  .object({
    connectorIds: z.array(uuid).max(20).default([]),
    services: z.array(z.object({ name: z.string().trim().min(1).max(100) }).strict()).max(20).default([]),
  })
  .strict();

export const setupDraftSchema = z
  .object({
    app: appStep.optional(),
    alerts: alertsStep.optional(),
    monitors: monitorsStep.optional(),
    statusPage: statusPageStep.optional(),
    tests: testsStep.optional(),
    aiSre: aiSreStep.optional(),
    created: created.optional(),
    /** Steps the user pressed Continue on; drafts saved before this existed have none. */
    completed: z.array(z.enum(SETUP_STEP_KEYS)).max(SETUP_STEP_KEYS.length).optional(),
  })
  .strict();

export type SetupDraft = z.infer<typeof setupDraftSchema>;

export type DraftParseResult = { success: true; data: SetupDraft } | { success: false; error: string };

/** Validate an untrusted draft: size cap first, then the strict allowlist. */
export function parseSetupDraft(input: unknown): DraftParseResult {
  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(input ?? {})).length;
  } catch {
    return { success: false, error: "Draft is not valid JSON" };
  }
  if (size > MAX_DRAFT_BYTES) return { success: false, error: "Draft is larger than 32 KB" };
  const parsed = setupDraftSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { success: false, error: `${issue.path.join(".") || "draft"}: ${issue.message}` };
  }
  return { success: true, data: parsed.data };
}
