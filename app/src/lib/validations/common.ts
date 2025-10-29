import { z } from "zod"

// Common validation patterns
export const emailSchema = z
  .string()
  .min(1, "Email is required")
  .email("Please enter a valid email address")

export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "Password must contain at least one uppercase letter, one lowercase letter, and one number")

export const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name must be 100 characters or less")
  .regex(/^[a-zA-Z0-9\s\-_]+$/, "Name can only contain letters, numbers, spaces, hyphens, and underscores")

export const descriptionSchema = z
  .string()
  .min(1, "Description is required")
  .max(500, "Description must be 500 characters or less")
  .trim()

export const urlSchema = z
  .string()
  .min(1, "URL is required")
  .url("Please enter a valid URL")

export const cronExpressionSchema = z
  .string()
  .min(1, "Cron expression is required")
  .regex(/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/, "Please enter a valid cron expression")

// Common form schemas
export const createJobSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  script: z.string().min(1, "Script is required"),
  cronExpression: cronExpressionSchema,
  timeout: z.number().min(1, "Timeout must be at least 1 second").max(3600, "Timeout cannot exceed 1 hour"),
})

export const createMonitorSchema = z.object({
  name: nameSchema,
  description: descriptionSchema,
  url: urlSchema,
  interval: z.number().min(30, "Interval must be at least 30 seconds").max(86400, "Interval cannot exceed 24 hours"),
})

export type CreateJobFormData = z.infer<typeof createJobSchema>
export type CreateMonitorFormData = z.infer<typeof createMonitorSchema> 