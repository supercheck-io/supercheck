import { z } from "zod";

const monitorTypeSchema = z.enum([
  "http_request",
  "website",
  "ping_host",
  "port_check",
  "synthetic_test",
]);

const hostnamePattern =
  /^(?=.{1,253}\.?$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.?$/;

type MonitorValidationInput = {
  type: unknown;
  target: unknown;
  config: unknown;
};

export type MonitorValidationResult =
  | { success: true }
  | { success: false; error: string; details: string };

function invalid(error: string, details: string): MonitorValidationResult {
  return { success: false, error, details };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateTimeout(
  config: Record<string, unknown>,
): MonitorValidationResult {
  if (config.timeoutSeconds === undefined) return { success: true };

  const timeout = config.timeoutSeconds;
  if (
    typeof timeout !== "number" ||
    !Number.isFinite(timeout) ||
    timeout < 1 ||
    timeout > 3600
  ) {
    return invalid(
      "Invalid monitor configuration",
      "config.timeoutSeconds must be a number between 1 and 3600",
    );
  }

  return { success: true };
}

export function validateMonitorConfiguration({
  type,
  target,
  config,
}: MonitorValidationInput): MonitorValidationResult {
  const parsedType = monitorTypeSchema.safeParse(type);
  if (!parsedType.success) {
    return invalid(
      "Invalid monitor type",
      "type must be a supported monitor type",
    );
  }

  const monitorType = parsedType.data;
  const monitorConfig = config === undefined || config === null ? {} : config;
  if (!isRecord(monitorConfig)) {
    return invalid("Invalid monitor configuration", "config must be an object");
  }

  const timeoutResult = validateTimeout(monitorConfig);
  if (!timeoutResult.success) return timeoutResult;

  if (monitorType === "synthetic_test") {
    const testId = z.string().uuid().safeParse(monitorConfig.testId);
    if (!testId.success) {
      return invalid(
        "Invalid monitor configuration",
        "config.testId must be a valid test ID for synthetic monitors",
      );
    }
    return { success: true };
  }

  if (typeof target !== "string" || target.trim().length === 0) {
    return invalid(
      "Invalid monitor target",
      "target is required for this monitor type",
    );
  }

  if (monitorType === "http_request" || monitorType === "website") {
    try {
      const url = new URL(target);
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error();
    } catch {
      return invalid(
        "Invalid monitor target",
        "target must be a valid HTTP or HTTPS URL",
      );
    }
  }

  if (
    (monitorType === "ping_host" || monitorType === "port_check") &&
    !hostnamePattern.test(target)
  ) {
    return invalid(
      "Invalid monitor target",
      "target must be a valid hostname or IP address",
    );
  }

  if (monitorType === "port_check") {
    const { port, protocol } = monitorConfig;
    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      return invalid(
        "Invalid monitor configuration",
        "config.port must be an integer between 1 and 65535",
      );
    }
    if (protocol !== "tcp" && protocol !== "udp") {
      return invalid(
        "Invalid monitor configuration",
        'config.protocol must be either "tcp" or "udp"',
      );
    }
  }

  if (monitorType === "website") {
    const warningDays = monitorConfig.sslDaysUntilExpirationWarning;
    if (
      warningDays !== undefined &&
      (typeof warningDays !== "number" ||
        !Number.isInteger(warningDays) ||
        warningDays < 1 ||
        warningDays > 365)
    ) {
      return invalid(
        "Invalid monitor configuration",
        "config.sslDaysUntilExpirationWarning must be an integer between 1 and 365",
      );
    }
  }

  return { success: true };
}
