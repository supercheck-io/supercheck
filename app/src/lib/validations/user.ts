import { z } from "zod";

export const createUserSchema = z.object({
  name: z
    .string()
    .min(1, "Name is required")
    .min(2, "Name must be at least 2 characters")
    .max(100, "Name must be 100 characters or less")
    .regex(
      /^[a-zA-Z\s\-']+$/,
      "Name can only contain letters, spaces, hyphens, and apostrophes"
    ),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(255, "Email must be 255 characters or less"),
  password: z
    .string()
    .min(1, "Password is required")
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be 128 characters or less")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
});

export type CreateUserFormData = z.infer<typeof createUserSchema>;

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
