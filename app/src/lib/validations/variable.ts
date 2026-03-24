import { z } from "zod";

/** Allowed variable types following the GitLab CI/CD pattern */
export const variableTypes = ["variable", "secret", "file"] as const;
export type VariableType = (typeof variableTypes)[number];

/** Max file size for file-type variables: 5 MB */
export const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Allowed MIME types for file-type variables (text-based files only) */
export const ALLOWED_FILE_MIME_TYPES = [
  "text/csv",
  "application/json",
  "text/plain",
  "text/tab-separated-values",
  "application/xml",
  "text/xml",
  "text/yaml",
  "application/x-yaml",
] as const;

/** Map file extensions to MIME types for fallback when browser doesn't provide one */
const EXTENSION_TO_MIME: Record<string, string> = {
  ".csv": "text/csv",
  ".json": "application/json",
  ".txt": "text/plain",
  ".tsv": "text/tab-separated-values",
  ".xml": "application/xml",
  ".yaml": "text/yaml",
  ".yml": "text/yaml",
};

/** Resolve MIME type from file.type or fall back to extension-based lookup.
 *  Always prefer the extension mapping when the extension is known, because
 *  browsers report non-canonical MIME types (e.g. application/vnd.ms-excel
 *  for .csv files) that would be rejected by ALLOWED_FILE_MIME_TYPES. */
export function resolveFileMimeType(file: { name: string; type: string }): string | null {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  // If the extension maps to a known MIME type, always use it
  if (EXTENSION_TO_MIME[ext]) return EXTENSION_TO_MIME[ext];
  // Fall back to browser-reported type (skip useless octet-stream)
  if (file.type && file.type !== "application/octet-stream") return file.type;
  return null;
}

export const keySchema = z
  .string()
  .min(4, "Variable name must be at least 4 characters")
  .max(20, "Variable name must be at most 20 characters")
  .regex(/^[A-Z][A-Z0-9_]*$/, "Variable name must start with a letter and contain only uppercase letters, numbers, and underscores")
  .refine((key) => !key.startsWith('SUPERCHECK_'), "Variable names cannot start with SUPERCHECK_ (reserved)")
  .refine((key) => !['PATH', 'HOME', 'USER', 'NODE_ENV', 'PORT'].includes(key), "Cannot use system reserved variable names");

export const createVariableSchema = z.object({
  key: keySchema,
  value: z
    .string()
    .min(1, "Value is required")
    .max(10000, "Value must be less than 10000 characters"),
  description: z
    .string()
    .max(300, "Description must be at most 300 characters")
    .optional(),
  isSecret: z.boolean().default(false),
});

/** Schema for creating a file-type variable (validated separately since file comes via FormData) */
export const createFileVariableSchema = z.object({
  key: keySchema,
  description: z
    .string()
    .max(300, "Description must be at most 300 characters")
    .optional(),
  type: z.literal("file"),
  fileName: z.string().min(1, "File name is required").max(255),
  fileSize: z.number().int().min(1, "File cannot be empty").max(MAX_FILE_SIZE, `File must be less than ${MAX_FILE_SIZE / (1024 * 1024)}MB`),
  mimeType: z.string().max(255).refine(
    (type) => (ALLOWED_FILE_MIME_TYPES as readonly string[]).includes(type),
    { message: `File type not allowed. Supported types: ${ALLOWED_FILE_MIME_TYPES.join(", ")}` }
  ),
});

export const updateVariableSchema = z.object({
  key: keySchema.optional(),
  value: z
    .string()
    .min(1, "Value is required")
    .max(10000, "Value must be less than 10000 characters")
    .optional(),
  description: z
    .string()
    .max(300, "Description must be at most 300 characters")
    .optional(),
  isSecret: z.boolean().optional(),
});

export type CreateVariableFormData = z.infer<typeof createVariableSchema>;
export type CreateFileVariableFormData = z.infer<typeof createFileVariableSchema>;
export type UpdateVariableFormData = z.infer<typeof updateVariableSchema>;