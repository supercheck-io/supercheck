import { NextRequest } from "next/server";
import {
  DEVICE_TOKEN_ERROR_STATUS,
  exchangeDeviceCode,
  hashDeviceCode,
} from "@/lib/auth/device-authorization";
import {
  allowDeviceAuthRequest,
  DEVICE_AUTH_LIMITS,
} from "@/lib/auth/device-auth-rate-limit";
import {
  deviceJson,
  guardDeviceAuthEnabled,
  readDeviceBody,
} from "@/lib/auth/device-http";
import { logAuditEvent } from "@/lib/audit-logger";
import { getClientIP } from "@/lib/session-security";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "device-auth" });
const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * POST /api/auth/device/token — RFC 8628 §3.4 device access token request.
 * Mints the project API key and consumes the grant in one transaction.
 */
export async function POST(request: NextRequest) {
  const disabled = guardDeviceAuthEnabled();
  if (disabled) return disabled;

  const body = await readDeviceBody(request);
  if (!body || !body.device_code || !body.client_id) {
    return deviceJson({ error: "invalid_request" }, 400);
  }
  if (body.grant_type !== DEVICE_GRANT_TYPE) {
    return deviceJson({ error: "unsupported_grant_type" }, 400);
  }

  const ip = getClientIP(request.headers);
  const allowed = await allowDeviceAuthRequest([
    DEVICE_AUTH_LIMITS.tokenPollPerDevice(hashDeviceCode(body.device_code)),
    DEVICE_AUTH_LIMITS.tokenPollPerIp(ip),
  ]);
  if (!allowed) {
    return deviceJson({ error: "slow_down", interval: 30 }, 429, {
      "Retry-After": "30",
    });
  }

  try {
    const result = await exchangeDeviceCode({
      deviceCode: body.device_code,
      clientId: body.client_id,
    });

    if (!result.ok) {
      return deviceJson(
        result.interval !== undefined
          ? { error: result.error, interval: result.interval }
          : { error: result.error },
        DEVICE_TOKEN_ERROR_STATUS[result.error],
      );
    }

    await logAuditEvent({
      userId: result.context.user.id,
      organizationId: result.context.organization.id,
      action: "cli_token_created",
      resource: "api_key",
      metadata: { via: "device_authorization", projectId: result.context.project.id },
      success: true,
    });
    logger.info(
      { event: "device_token_issued", projectId: result.context.project.id },
      "Device authorization exchanged for CLI key",
    );

    return deviceJson({
      access_token: result.accessToken,
      token_type: "Bearer",
      expires_in: result.expiresIn,
      context: result.context,
    });
  } catch (error) {
    logger.error({ err: error }, "Device token exchange failed");
    return deviceJson({ error: "server_error" }, 500);
  }
}
