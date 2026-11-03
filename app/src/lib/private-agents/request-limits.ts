import type { DeviceAuthLimit } from "@/lib/auth/device-auth-rate-limit";

// Buckets are per 10-minute window (see allowDeviceAuthRequest). "unknown" IPs share one generous bucket.
export const PRIVATE_AGENT_LIMITS = {
  exchangePerIp: (ip: string): DeviceAuthLimit => ({
    scope: "pa-exchange-ip",
    subject: ip,
    max: ip === "unknown" ? 600 : 30,
  }),
  exchangePerAgent: (agentId: string): DeviceAuthLimit => ({
    scope: "pa-exchange-agent",
    subject: agentId,
    max: 20,
  }),
  heartbeatPerCredential: (credentialId: string): DeviceAuthLimit => ({
    scope: "pa-heartbeat-credential",
    subject: credentialId,
    max: 600,
  }),
} as const;
