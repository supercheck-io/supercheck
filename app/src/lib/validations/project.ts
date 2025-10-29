import { z } from "zod"

export const createProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .max(20, "Project name must be 20 characters or less")
    .regex(/^[a-zA-Z0-9\s\-_]+$/, "Project name can only contain letters, numbers, spaces, hyphens, and underscores"),
  description: z
    .string()
    .min(1, "Project description is required")
    .max(100, "Project description must be 100 characters or less")
    .trim(),
})

export const updateProjectSchema = z.object({
  name: z
    .string()
    .min(1, "Project name is required")
    .max(20, "Project name must be 20 characters or less")
    .regex(/^[a-zA-Z0-9\s\-_]+$/, "Project name can only contain letters, numbers, spaces, hyphens, and underscores"),
  description: z
    .string()
    .min(1, "Project description is required")
    .max(100, "Project description must be 100 characters or less")
    .trim(),
})

export type CreateProjectFormData = z.infer<typeof createProjectSchema>
export type UpdateProjectFormData = z.infer<typeof updateProjectSchema> 