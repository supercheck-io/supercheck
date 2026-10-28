import { z } from "zod";

/** The worker fires on `count === threshold`, so a fractional, zero or negative value silently never alerts. */
export const alertThresholdSchema = z.number().int().min(1).max(100);

/** Error message for the first invalid failure/recovery threshold in a raw alertConfig, else null. Absent means default. */
export function alertThresholdError(alertConfig: unknown): string | null {
  if (!alertConfig || typeof alertConfig !== "object") return null;
  for (const key of ["failureThreshold", "recoveryThreshold"] as const) {
    const value = (alertConfig as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && !alertThresholdSchema.safeParse(value).success) {
      return `alertConfig.${key} must be an integer between 1 and 100`;
    }
  }
  return null;
}
