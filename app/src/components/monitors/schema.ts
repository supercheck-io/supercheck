import { z } from "zod";

// Schema for monitors matching the database schema
export const monitorSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().nullable().optional(),
  createdByUserId: z.string().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  type: z.enum([
    "http_request",
    "website",
    "ping_host",
    "port_check",
    "synthetic_test",
  ]).default("http_request"),
  target: z.string(), // URL, IP, domain, etc.
  frequencyMinutes: z.number().default(5),
  enabled: z.boolean().default(true),
  status: z.enum(["up", "down", "paused", "pending", "maintenance", "error"]).default("pending"),
  config: z.any().optional(),
  alertConfig: z.object({
    enabled: z.boolean(),
    notificationProviders: z.array(z.string()),
    alertOnFailure: z.boolean(),
    alertOnRecovery: z.boolean().optional(),
    alertOnSslExpiration: z.boolean().optional(),
    alertOnSuccess: z.boolean().optional(),
    alertOnTimeout: z.boolean().optional(),
    failureThreshold: z.number(),
    recoveryThreshold: z.number(),
    customMessage: z.string().optional(),
  }).optional(),
  lastCheckAt: z.string().nullable().optional(),
  lastStatusChangeAt: z.string().nullable().optional(),
  mutedUntil: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  projectName: z.string().optional(),
  
  // Legacy fields for backward compatibility
  url: z.string().optional(),
  timeout: z.number().optional(),
  expectedStatus: z.number().optional(),
  expectedResponseBody: z.string().optional(),
  port: z.number().optional(),
  lastCheckedAt: z.string().optional(),
  responseTime: z.number().optional(),
  uptime: z.string().or(z.number()).optional(),
  active: z.boolean().optional(),
});

export type Monitor = z.infer<typeof monitorSchema>; 