import { NextRequest } from "next/server";
import {
  DEVICE_CLIENT_ID,
  createDeviceGrant,
  sanitizeClientMetadata,
} from "@/lib/auth/device-authorization";
import {
  allowDeviceAuthRequest,
  DEVICE_AUTH_LIMITS,
} from "@/lib/auth/device-auth-rate-limit";
import {
  deviceBaseUrl,
  deviceJson,
  guardDeviceAuthEnabled,
  readDeviceBody,
} from "@/lib/auth/device-http";
import { getClientIP } from "@/lib/session-security";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "device-auth" });

/**
 * POST /api/auth/device/code — RFC 8628 §3.1 device authorization request.
 * Public endpoint. Never returns an API key; approval happens in the browser.
 */
export async function POST(request: NextRequest) {
  const disabled = guardDeviceAuthEnabled();
  if (disabled) return disabled;

  const ip = getClientIP(request.headers);
  if (!(await allowDeviceAuthRequest([
      DEVICE_AUTH_LIMITS.codeIssuePerIp(ip),
      DEVICE_AUTH_LIMITS.codeIssueGlobal(),
    ]))) {
    return deviceJson({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }

  const body = await readDeviceBody(request);
  if (!body) return deviceJson({ error: "invalid_request" }, 400);
  if (body.client_id !== DEVICE_CLIENT_ID) {
    return deviceJson({ error: "invalid_client" }, 401);
  }

  try {
    const grant = await createDeviceGrant({
      clientId: DEVICE_CLIENT_ID,
      metadata: sanitizeClientMetadata(
        {
          clientName: body.client_name,
          cliVersion: body.cli_version,
          hostname: body.hostname,
        },
        ip,
      ),
    });
    const base = deviceBaseUrl(request);
    logger.info({ event: "device_code_issued" }, "Device code issued");
    return deviceJson({
      device_code: grant.deviceCode,
      user_code: grant.userCode,
      verification_uri: `${base}/device`,
      verification_uri_complete: `${base}/device?code=${encodeURIComponent(grant.userCode)}`,
      expires_in: grant.expiresIn,
      interval: grant.interval,
    });
  } catch (error) {
    logger.error({ err: error }, "Failed to issue device code");
    return deviceJson({ error: "server_error" }, 500);
  }
}
