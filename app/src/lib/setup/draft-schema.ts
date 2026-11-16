import { z } from "zod";

import { keySchema } from "@/lib/validations/variable";

/**
 * The setup draft holds non-secret choices only (spec 6). Every level is `.strict()`, so an
 * unknown key (a token pasted into the wrong field, an old client) is rejected, and stored URLs
 * keep only origin + path: no query, fragment or userinfo.
 */
export const MAX_DRAFT_BYTES = 32 * 1024;

/** Origin + path of an http(s) URL; null when it is not one. */
export function stripUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return `${url.origin}${url.pathname}`;
}

const safeUrl = z
  .string()
  .max(2048)
  .transform((value, ctx) => {
    const stripped = stripUrl(value);
    if (!stripped) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be an http(s) URL" });
      return z.NEVER;
    }
    return stripped;
  });

/** Secret NAMES only, same rule as project variables; a pasted key cannot match it. "" = not set. */
const secretName = keySchema.or(z.literal(""));
const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(255);

/** Created item ids per review item key, so Retry and re-run never duplicate (D11, D10). */
const created = z.record(z.string().max(120), uuid).refine((value) => Object.keys(value).length <= 100, {
  message: "Too many created items",
});

const appStep = z
  .object({
    url: safeUrl.optional(),
    /** Name of the project secret holding the test account (the value is never here). */
    testAccountSecret: secretName.optional(),
  })
  .strict();

const alertsStep = z
  .object({
    /** Providers saved at entry time (D8): ids only, never webhook URLs. */
    providerIds: z.array(uuid).max(10).default([]),
    repeatUntilAck: z
      .object({ enabled: z.boolean(), repeatMinutes: z.number().int().min(5).max(1440) })
      .strict()
      .optional(),
    warnings: z.boolean().optional(),
  })
  .strict();

const monitorsStep = z
  .object({
    pages: z.array(z.object({ url: safeUrl, name }).strict()).max(20).default([]),
    frequencyMinutes: z.number().int().min(1).max(1440).optional(),
    heartbeat: z.object({ name, frequencyMinutes: z.number().int().min(1).max(44640) }).strict().optional(),
    aiEndpoint: z
      .object({ name, url: safeUrl, model: z.string().trim().min(1).max(200), secretKey: keySchema })
      .strict()
      .optional(),
    mcpMonitor: z
      .object({ name, url: safeUrl, secretKey: secretName.optional() })
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

const testsStep = z
  .object({
    requirements: z.array(z.object(requirementItem).strict()).max(50).default([]),
    /** The AI suggestions, ticked or not: a run costs a credit and a daily slot, so leaving the step must not lose them. */
    suggestions: z
      .array(z.object({ ...requirementItem, priority: z.enum(["low", "medium", "high"]).optional() }).strict())
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
