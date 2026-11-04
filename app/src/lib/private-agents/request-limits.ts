import type { DeviceAuthLimit } from "@/lib/auth/device-auth-rate-limit";

// Buckets are per 10-minute window (see allowDeviceAuthRequest). "unknown" IPs share one generous bucket.
export const PRIVATE_AGENT_LIMITS = {
  exchangePerIp: (ip: string): DeviceAuthLimit => ({
    scope: "pa-exchange-ip",
    subject: ip,
    max: ip === "unknown" ? 600 : 30,
  }),
  // Keyed with the IP so a third party who knows an agent ID cannot lock out its real exchange. Callers whose IP
  // cannot be resolved share one bucket per agent, so it is as generous as the per-IP "unknown" bucket.
  exchangePerAgent: (agentId: string, ip: string): DeviceAuthLimit => ({
    scope: "pa-exchange-agent",
    subject: `${agentId}:${ip}`,
    max: ip === "unknown" ? 600 : 20,
  }),
  heartbeatPerCredential: (credentialId: string): DeviceAuthLimit => ({
    scope: "pa-heartbeat-credential",
    subject: credentialId,
    max: 600,
  }),
} as const;

// 100 evidence items at their schema maxima are about 400 KB; leave headroom, not an open door.
export const MAX_PRIVATE_AGENT_RESULT_BYTES = 1024 * 1024;

/** Reads a JSON body while enforcing the cap on the stream, so chunked bodies cannot skip Content-Length. */
export async function readCappedJson(
  request: Request,
  maxBytes: number,
): Promise<{ tooLarge: true } | { tooLarge: false; data: unknown }> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true };

  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  try {
    return { tooLarge: false, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { tooLarge: false, data: null };
  }
}
