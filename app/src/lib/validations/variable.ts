import { z } from "zod";

export const createVariableSchema = z.object({
  key: z
    .string()
    .min(4, "Variable name must be at least 4 characters")
    .max(20, "Variable name must be at most 20 characters")
    .regex(/^[A-Z][A-Z0-9_]*$/, "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores")
    .refine((key) => !key.startsWith('SUPERCHECK_'), "Variable names cannot start with SUPERCHECK_ (reserved)")
    .refine((key) => !['PATH', 'HOME', 'USER', 'NODE_ENV', 'PORT'].includes(key), "Cannot use system reserved variable names"),
  value: z
    .string()
    .min(1, "Value is required")
    .max(10000, "Value must be less than 10000 characters"),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(300, "Description must be at most 300 characters"),
  isSecret: z.boolean().default(false),
});

export const updateVariableSchema = z.object({
  key: z
    .string()
    .min(4, "Variable name must be at least 4 characters")
    .max(20, "Variable name must be at most 20 characters")
    .regex(/^[A-Z][A-Z0-9_]*$/, "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores")
    .refine((key) => !key.startsWith('SUPERCHECK_'), "Variable names cannot start with SUPERCHECK_ (reserved)")
    .refine((key) => !['PATH', 'HOME', 'USER', 'NODE_ENV', 'PORT'].includes(key), "Cannot use system reserved variable names")
    .optional(),
  value: z
    .string()
    .min(1, "Value is required")
    .max(10000, "Value must be less than 10000 characters")
    .optional(),
  description: z
    .string()
    .min(20, "Description must be at least 20 characters")
    .max(300, "Description must be at most 300 characters")
    .optional(),
  isSecret: z.boolean().optional(),
});

export type CreateVariableFormData = z.infer<typeof createVariableSchema>;
export type UpdateVariableFormData = z.infer<typeof updateVariableSchema>;