import { z } from "zod";

export const variableSchema = z.object({
  id: z.string(),
  key: z.string(),
  value: z.string().optional(),
  isSecret: z.string(), // Transformed from boolean to string for faceted filtering
  description: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Variable = z.infer<typeof variableSchema>;