import { NextRequest } from "next/server";
import { denyDeviceGrant } from "@/lib/auth/device-authorization";
import {
  allowDeviceAuthRequest,
  DEVICE_AUTH_LIMITS,
} from "@/lib/auth/device-auth-rate-limit";
import {
  deviceJson,
  guardDeviceAuthEnabled,
  readDeviceBody,
} from "@/lib/auth/device-http";
import { requireAuth } from "@/lib/rbac/middleware";
import { requireSameOriginRequest } from "@/lib/security/same-origin";
import { logAuditEvent } from "@/lib/audit-logger";
import { getClientIP } from "@/lib/session-security";
import { createLogger } from "@/lib/logger/pino-config";

const logger = createLogger({ module: "device-auth" });

const REASON_STATUS = {
  invalid_code: 404,
  not_pending: 409,
  expired: 410,
  too_many_attempts: 429,
  forbidden: 403,
} as const;

/** POST /api/auth/device/deny — terminal denial; a denied grant cannot be approved later. */
export async function POST(request: NextRequest) {
  const disabled = guardDeviceAuthEnabled();
  if (disabled) return disabled;

  const crossOrigin = requireSameOriginRequest(request);
  if (crossOrigin) return crossOrigin;

  let userId: string;
  try {
    ({ userId } = await requireAuth());
  } catch {
    return deviceJson({ error: "authentication_required" }, 401);
  }

  const ip = getClientIP(request.headers);
  if (
    !(await allowDeviceAuthRequest([
      DEVICE_AUTH_LIMITS.verifyPerUser(userId),
      DEVICE_AUTH_LIMITS.verifyPerIp(ip),
    ]))
  ) {
    return deviceJson({ error: "rate_limited" }, 429, { "Retry-After": "60" });
  }

  const body = await readDeviceBody(request);
  if (!body || !body.user_code) {
    return deviceJson({ error: "invalid_request" }, 400);
  }

  try {
    const result = await denyDeviceGrant({ userCode: body.user_code });
    if (!result.ok) {
      return deviceJson({ error: result.reason }, REASON_STATUS[result.reason]);
    }
    await logAuditEvent({
      userId,
      action: "device_authorization_denied",
      resource: "device_authorization",
      success: true,
    });
    logger.info({ event: "device_denied", userId }, "Device authorization denied");
    return deviceJson({ success: true });
  } catch (error) {
    logger.error({ err: error }, "Device deny failed");
    return deviceJson({ error: "server_error" }, 500);
  }
}
