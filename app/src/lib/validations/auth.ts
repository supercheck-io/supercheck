import { z } from "zod";

/**
 * Email validation schema for signup (invitation flow only)
 * No disposable email blocking since social-only signup prevents throwaway emails.
 * New users must sign up with GitHub or Google OAuth.
 */
export const signupEmailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .max(255, "Email must be 255 characters or less");

/**
 * Email validation schema for login (without disposable check)
 * We don't block disposable emails on login as they may have existing accounts
 */
export const loginEmailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email address")
  .max(255, "Email must be 255 characters or less");

/**
 * Password validation schema with strong requirements
 */
export const passwordSchema = z
  .string()
  .min(1, "Password is required")
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be 128 characters or less")
  .regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
    "Password must contain at least one uppercase letter, one lowercase letter, and one number"
  );

/**
 * Name validation schema
 */
export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must be 100 characters or less")
  .regex(
    /^[a-zA-Z\s\-']+$/,
    "Name can only contain letters, spaces, hyphens, and apostrophes"
  );

/**
 * Login form schema
 */
export const loginFormSchema = z.object({
  email: loginEmailSchema,
  password: z.string().min(1, "Password is required"),
});

/**
 * Signup form schema with all validations
 */
export const signupFormSchema = z.object({
  name: nameSchema,
  email: signupEmailSchema,
  password: passwordSchema,
});

export type LoginFormData = z.infer<typeof loginFormSchema>;
export type SignupFormData = z.infer<typeof signupFormSchema>;
