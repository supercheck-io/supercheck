import { z } from "zod";

export const variableSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string().optional(),
  isSecret: z.string(), // Transformed from boolean to string for faceted filtering
  type: z.enum(["variable", "secret", "file"]).default("variable"),
  // File-type variable fields
  fileName: z.string().nullable().optional(),
  fileSize: z.number().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  storagePath: z.string().nullable().optional(),
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Variable = z.infer<typeof variableSchema>;