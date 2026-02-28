import { z } from "zod";

/**
 * Schema for banning a user with a required reason
 */
export const banUserSchema = z.object({
  reason: z
    .string()
    .min(1, "Ban reason is required")
    .min(20, "Ban reason must be at least 20 characters")
    .max(500, "Ban reason must be 500 characters or less")
    .refine(
      (val) => val.trim().length >= 20,
      "Ban reason must contain meaningful content (at least 20 characters after trimming)"
    ),
});

export type BanUserFormData = z.infer<typeof banUserSchema>;
