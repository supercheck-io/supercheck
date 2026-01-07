import { z } from "zod";

// Schema for tags (matching tests pattern)
const tagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});

// Schema for requirements matching the database schema and server action types
export const requirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  priority: z.enum(["low", "medium", "high"]).nullable(),
  tags: z.array(tagSchema).default([]), // Array of tags like tests
  externalId: z.string().nullable(),
  externalUrl: z.string().nullable(),
  externalProvider: z.string().nullable(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
  // Source document reference
  sourceDocumentId: z.string().nullable().optional(),
  sourceDocumentName: z.string().nullable().optional(),
  sourceSection: z.string().nullable().optional(),
  // Coverage from snapshot
  coverageStatus: z.enum(["covered", "failing", "missing"]),
  linkedTestCount: z.number(),
  passedTestCount: z.number(),
  failedTestCount: z.number(),
});

export type Requirement = z.infer<typeof requirementSchema>;
export type Tag = z.infer<typeof tagSchema>;

// Coverage status labels and colors
export const coverageStatusConfig = {
  covered: { label: "Covered", color: "text-green-500", bgColor: "bg-green-500/10", icon: "✓" },
  failing: { label: "Failing", color: "text-red-500", bgColor: "bg-red-500/10", icon: "✕" },
  missing: { label: "Missing", color: "text-gray-400", bgColor: "bg-gray-500/10", icon: "○" },
} as const;
