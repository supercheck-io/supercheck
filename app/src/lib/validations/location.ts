import { z } from "zod";

/**
 * Location code validation:
 * - 2-50 characters (runtime tables like runs.location use varchar(50))
 * - Lowercase letters, numbers, hyphens only
 * - Must start and end with alphanumeric
 * - No consecutive hyphens
 */
export const locationCodeSchema = z
  .string()
  .min(2, "Location code must be at least 2 characters")
  .max(50, "Location code must be at most 50 characters")
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
    "Must start and end with a letter or number, and contain only lowercase letters, numbers, and hyphens"
  )
  .refine((val) => !val.includes("--"), "No consecutive hyphens allowed");

/** Codes reserved for system use — cannot be used as location codes */
const RESERVED_CODES = new Set([
  "global",
  "all",
  "default",
  "none",
  "any",
  "local",
]);

export const createLocationSchema = z.object({
  code: locationCodeSchema.refine(
    (val) => !RESERVED_CODES.has(val),
    "This code is reserved for system use"
  ),
  name: z.string().min(1, "Name is required").max(100),
  region: z.string().max(100).optional(),
  flag: z.string().max(10).optional(),
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  region: z.string().max(100).optional().nullable(),
  flag: z.string().max(10).optional().nullable(),
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional()
    .nullable(),
  isEnabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});
// Note: `code` is intentionally NOT in updateLocationSchema — it's immutable.

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
