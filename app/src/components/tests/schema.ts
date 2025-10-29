import { z } from "zod";

// Schema for tags
const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});

// Schema for tests matching the database schema
export const testSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  script: z.string().optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  type: z.enum(["browser", "api", "custom", "database"]).default("browser"),
  tags: z.array(tagSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type Test = z.infer<typeof testSchema>;
export type Tag = z.infer<typeof tagSchema>;
