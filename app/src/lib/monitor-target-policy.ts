import { isIP } from "node:net";
import { isPrivateHost } from "@/lib/url-validator";
import { isPrivateOrReservedAddress } from "@/lib/outbound-address-policy";
import { lookupBounded } from "@/lib/sre/connectors/endpoint-policy";
import type { MonitorValidationResult } from "@/lib/monitor-validation";

const HOST_TYPES = new Set(["http_request", "website", "ping_host", "port_check"]);
const DNS_TIMEOUT_MS = 3_000;

function targetHostname(type: string, target: string): string | null {
  if (type === "http_request" || type === "website") {
    try {
      return new URL(target).hostname;
    } catch {
      return null;
    }
  }
  return target.trim();
}

/**
 * Reject monitor targets that point at private, loopback or reserved addresses, so a monitor cannot
 * probe the platform's internal network. Same opt-out as the worker: only ALLOW_INTERNAL_TARGETS=true
 * allows them (self-hosted is not enough on its own). A name that does not resolve is accepted: the
 * worker reports it as down, and it re-vets the address it connects to, so DNS rebinding is covered there.
 */
export async function validateMonitorTargetAddress(input: {
  type: unknown;
  target: unknown;
}): Promise<MonitorValidationResult> {
  const { type, target } = input;
  if (typeof type !== "string" || !HOST_TYPES.has(type) || typeof target !== "string") {
    return { success: true };
  }
  if (process.env.ALLOW_INTERNAL_TARGETS === "true") return { success: true };

  const hostname = targetHostname(type, target)?.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  if (!hostname) return { success: true };

  const blocked: MonitorValidationResult = {
    success: false,
    error: "Invalid monitor target",
    details: "target must not point to a private, loopback or reserved network address",
  };
  if (isPrivateHost(hostname)) return blocked;
  if (isIP(hostname)) return { success: true };

  try {
    const addresses = await lookupBounded(hostname, AbortSignal.timeout(DNS_TIMEOUT_MS));
    if (addresses.some(({ address }) => isPrivateOrReservedAddress(address))) return blocked;
  } catch {
    // Unresolvable or slow DNS is not a policy failure.
  }
  return { success: true };
}
