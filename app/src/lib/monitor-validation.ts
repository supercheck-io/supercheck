import { z } from "zod";
import { HEARTBEAT_MAX_GRACE_MINUTES } from "@/lib/heartbeat/state";

const monitorTypeSchema = z.enum([
  "http_request",
  "website",
  "ping_host",
  "port_check",
  "synthetic_test",
  "mcp_server",
  "heartbeat",
]);

const hostnamePattern =
  /^(?=.{1,253}\.?$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.?$/;

type MonitorValidationInput = {
  type: unknown;
  target: unknown;
  config: unknown;
  /** The config the client sent, if any. Unsupported keys are rejected there only, so a stored legacy key never blocks an unrelated edit. */
  incomingConfig?: unknown;
};

export type MonitorValidationResult =
  | { success: true }
  | { success: false; error: string; details: string };

function invalid(error: string, details: string): MonitorValidationResult {
  return { success: false, error, details };
}

/** Names the field a schema issue is about; a missing field reads "<path> is required". */
function issueDetail(prefix: string, value: unknown, issue: z.core.$ZodIssue): string {
  const path = [prefix, ...issue.path.map(String)].join(".");
  const actual = issue.path.reduce<unknown>((node, key) => (isRecord(node) ? node[String(key)] : undefined), value);
  return issue.code === "invalid_type" && actual === undefined ? `${path} is required` : `${path}: ${issue.message}`;
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

/** Documented in the types but read by no probe: accepting them would give a monitor that silently ignores them. */
const UNEVALUATED_CONFIG_KEYS = [
  "responseBodyJsonPath",
  "checkExpiration",
  "daysUntilExpirationWarning",
  "checkRevocation",
  "sslCheckOnStatusChange",
] as const;

const HTTP_METHODS: string[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

/** Same grammar the worker evaluates: "200", "200-299" or "2xx", comma-separated. Empty means the 2xx default. */
function isValidStatusCodes(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.trim() === "") return true;
  return value.split(",").every((raw) => {
    const part = raw.trim();
    const range = /^([1-5]\d\d)\s*-\s*([1-5]\d\d)$/.exec(part);
    return range
      ? Number(range[1]) <= Number(range[2])
      : /^[1-5]\d\d$/.test(part) || /^[1-5]xx$/i.test(part);
  });
}

function validateLocationPolicy(config: Record<string, unknown>): MonitorValidationResult {
  const location = config.locationConfig;
  if (!isRecord(location)) return { success: true };
  const { threshold, strategy } = location;
  // threshold 0 would mark a monitor up with every region down; above 100 it could never be up.
  if (threshold !== undefined && (typeof threshold !== "number" || !Number.isInteger(threshold) || threshold < 1 || threshold > 100)) {
    return invalid("Invalid monitor configuration", "config.locationConfig.threshold must be an integer between 1 and 100");
  }
  if (strategy !== undefined && strategy !== "all" && strategy !== "majority" && strategy !== "any") {
    return invalid("Invalid monitor configuration", 'config.locationConfig.strategy must be "all", "majority" or "any"');
  }
  return { success: true };
}

// Same header-name rule as the MCP connector's buildAuthHeaders.
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;
/** Shared with the monitor form, so it rejects exactly what the API rejects. */
export const FORBIDDEN_KEY_HEADERS = new Set(["host", "content-length", "content-type", "accept", "transfer-encoding", "connection", "cookie", "mcp-session-id", "mcp-protocol-version", "mcp-method", "mcp-name"]);
const secretName = z.string().trim().min(1).max(255);

const aiEndpointSchema = z
  .object({
    secretKey: secretName.optional(),
    keyHeader: z
      .string()
      .regex(HEADER_NAME, "must be a valid header name")
      .refine((name) => !FORBIDDEN_KEY_HEADERS.has(name.toLowerCase()), "header name is not allowed")
      .optional(),
    model: z.string().trim().min(1).max(200),
    prompt: z.string().min(1).max(2000).optional(),
    maxTokens: z.number().int().min(1).max(512).optional(),
    expectText: z.string().max(500).optional(),
    firstTokenTimeoutMs: z.number().int().min(500).max(60000).optional(),
    warnFirstTokenMs: z.number().int().min(100).max(60000).optional(),
    warnTotalTokens: z.number().int().min(1).max(1_000_000).optional(),
  })
  .strict();

const headerName = z
  .string()
  .regex(HEADER_NAME, "must be a valid header name")
  .refine((name) => !FORBIDDEN_KEY_HEADERS.has(name.toLowerCase()), "header name is not allowed");

export const MCP_TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const MCP_MAX_ARGUMENT_BYTES = 8 * 1024;

const mcpSchema = z
  .object({
    auth: z
      .object({
        type: z.enum(["none", "bearer", "header"]),
        secretKey: secretName.optional(),
        headerName: headerName.optional(),
      })
      .strict()
      .superRefine((auth, ctx) => {
        if (auth.type === "none") {
          if (auth.secretKey !== undefined || auth.headerName !== undefined) {
            ctx.addIssue({ code: "custom", path: ["type"], message: "secretKey and headerName need a login type" });
          }
          return;
        }
        if (auth.secretKey === undefined) ctx.addIssue({ code: "custom", path: ["secretKey"], message: "is required" });
        if (auth.type === "header" && auth.headerName === undefined) {
          ctx.addIssue({ code: "custom", path: ["headerName"], message: "is required for a custom header" });
        }
        if (auth.type === "bearer" && auth.headerName !== undefined) {
          ctx.addIssue({ code: "custom", path: ["headerName"], message: "is only used with a custom header" });
        }
      }),
    protocol: z.enum(["auto", "2025", "2026"]).optional(),
    requiredTools: z.array(z.string().regex(MCP_TOOL_NAME, "must be a tool name of 1-128 characters")).max(50).optional(),
    toolCall: z
      .object({
        name: z.string().regex(MCP_TOOL_NAME, "must be a tool name of 1-128 characters"),
        arguments: z
          .record(z.string(), z.unknown())
          .refine((args) => Buffer.byteLength(JSON.stringify(args)) <= MCP_MAX_ARGUMENT_BYTES, "must be at most 8 KiB")
          .optional(),
        expectText: z.string().max(500).optional(),
      })
      .strict()
      .optional(),
    slowMs: z.number().int().min(100).max(60000).optional(),
  })
  .strict();

/** Default whole-check deadline the worker applies to an MCP check when none is set. */
export const MCP_DEFAULT_TIMEOUT_SECONDS = 30;

function validateMcp(monitorType: string, config: Record<string, unknown>, target: string): MonitorValidationResult {
  if (monitorType !== "mcp_server") {
    return config.mcp == null ? { success: true } : invalid("Invalid monitor configuration", "config.mcp is only supported on mcp_server monitors");
  }
  if (config.mcp == null) {
    return invalid("Invalid monitor configuration", 'config.mcp is required for mcp_server monitors, at least config.mcp.auth (for example {"type":"none"})');
  }
  const parsed = mcpSchema.safeParse(config.mcp);
  if (!parsed.success) return invalid("Invalid monitor configuration", issueDetail("config.mcp", config.mcp, parsed.error.issues[0]));
  let url: URL;
  try {
    url = new URL(target.trim());
  } catch {
    return invalid("Invalid monitor target", "target must be a valid HTTPS URL");
  }
  const internal = process.env.ALLOW_INTERNAL_TARGETS === "true";
  if (url.protocol !== "https:" && !(internal && url.protocol === "http:")) {
    return invalid("Invalid monitor target", "target must be a valid HTTPS URL");
  }
  if (url.username || url.password || url.hash) {
    return invalid("Invalid monitor target", "target must not contain credentials or a fragment");
  }
  const timeout = config.timeoutSeconds;
  if (timeout !== undefined && (typeof timeout !== "number" || timeout < 5 || timeout > 60)) {
    return invalid("Invalid monitor configuration", "config.timeoutSeconds must be between 5 and 60 for MCP monitors");
  }
  return { success: true };
}

/** Request fields the AI endpoint preset replaces; none may be set beside it. */
const AI_CONFLICTING_KEYS = ["method", "headers", "body", "keywordInBody", "expectedStatusCodes"] as const;

/** The protocol the URL parser (and so the worker) will use; "http:api.example.com" is http too. */
function parsedProtocol(target: string): string | null {
  try {
    return new URL(target.trim()).protocol;
  } catch {
    return null;
  }
}

/** Total time limit the worker applies to an AI endpoint check when none is set. */
export const AI_DEFAULT_TIMEOUT_SECONDS = 60;

function validateAiEndpoint(monitorType: string, config: Record<string, unknown>): MonitorValidationResult {
  if (config.aiEndpoint == null) return { success: true };
  if (monitorType !== "http_request") {
    return invalid("Invalid monitor configuration", "config.aiEndpoint is only supported on http_request monitors");
  }
  const parsed = aiEndpointSchema.safeParse(config.aiEndpoint);
  if (!parsed.success) return invalid("Invalid monitor configuration", issueDetail("config.aiEndpoint", config.aiEndpoint, parsed.error.issues[0]));
  const auth = isRecord(config.auth) && config.auth.type !== "none" ? config.auth : null;
  const conflict = AI_CONFLICTING_KEYS.find((key) => config[key] != null && config[key] !== "") ?? (auth ? "auth" : undefined);
  if (conflict) {
    return invalid("Invalid monitor configuration", `config.${conflict} cannot be set together with config.aiEndpoint`);
  }
  const timeout = config.timeoutSeconds;
  if (timeout !== undefined && (typeof timeout !== "number" || timeout < 5 || timeout > 120)) {
    return invalid("Invalid monitor configuration", "config.timeoutSeconds must be between 5 and 120 for the AI endpoint preset");
  }
  const firstToken = parsed.data.firstTokenTimeoutMs;
  if (firstToken !== undefined && firstToken > (timeout ?? AI_DEFAULT_TIMEOUT_SECONDS) * 1000) {
    return invalid("Invalid monitor configuration", "config.aiEndpoint.firstTokenTimeoutMs cannot exceed the total timeout (config.timeoutSeconds)");
  }
  return { success: true };
}

function validateAuthSecret(config: Record<string, unknown>): MonitorValidationResult {
  const auth = config.auth;
  if (!isRecord(auth) || auth.secretKey === undefined) return { success: true };
  if (!secretName.safeParse(auth.secretKey).success) {
    return invalid("Invalid monitor configuration", "config.auth.secretKey must be a secret name of 1-255 characters");
  }
  if (auth.type !== "bearer" && auth.type !== "basic") {
    return invalid("Invalid monitor configuration", "config.auth.secretKey needs auth type bearer or basic");
  }
  if (auth.type === "basic" && (typeof auth.username !== "string" || auth.username.trim() === "")) {
    return invalid("Invalid monitor configuration", "config.auth.username is required for basic auth with a secret");
  }
  if (auth.token || auth.password) {
    return invalid("Invalid monitor configuration", "config.auth.secretKey cannot be combined with an inline token or password");
  }
  return { success: true };
}

/** Matches the monitors.target varchar(2048) column. */
export const MAX_TARGET_LENGTH = 2048;

export function validateMonitorConfiguration({
  type,
  target,
  config,
  incomingConfig,
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

  if (typeof target === "string") {
    if (target.length > MAX_TARGET_LENGTH) {
      return invalid("Invalid monitor target", `target must be at most ${MAX_TARGET_LENGTH} characters`);
    }
    if (/[\x00-\x1f\x7f]/.test(target)) {
      return invalid("Invalid monitor target", "target must not contain control characters");
    }
  }

  const timeoutResult = validateTimeout(monitorConfig);
  if (!timeoutResult.success) return timeoutResult;

  const unevaluated = isRecord(incomingConfig)
    ? UNEVALUATED_CONFIG_KEYS.find((key) => incomingConfig[key] != null)
    : undefined;
  if (unevaluated) {
    return invalid("Invalid monitor configuration", `config.${unevaluated} is not supported: no check evaluates it`);
  }

  const locationResult = validateLocationPolicy(monitorConfig);
  if (!locationResult.success) return locationResult;

  if (monitorType === "heartbeat") {
    // Nothing is probed: the job pings us. The target column stays empty for this type only.
    if (target !== undefined && target !== null && target !== "") {
      return invalid("Invalid monitor target", "target must be empty for heartbeat monitors");
    }
    const heartbeat = monitorConfig.heartbeat;
    if (heartbeat !== undefined && heartbeat !== null) {
      const grace = isRecord(heartbeat) ? heartbeat.graceMinutes : undefined;
      if (
        !isRecord(heartbeat) ||
        (grace !== undefined && (typeof grace !== "number" || !Number.isInteger(grace) || grace < 1 || grace > HEARTBEAT_MAX_GRACE_MINUTES))
      ) {
        return invalid(
          "Invalid monitor configuration",
          `config.heartbeat.graceMinutes must be a whole number between 1 and ${HEARTBEAT_MAX_GRACE_MINUTES}`,
        );
      }
    }
    return { success: true };
  }
  if (isRecord(incomingConfig) && incomingConfig.heartbeat != null) {
    return invalid("Invalid monitor configuration", "config.heartbeat is only supported on heartbeat monitors");
  }

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
    !hostnamePattern.test(target) && !z.ipv6().safeParse(target).success
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

  const aiResult = validateAiEndpoint(monitorType, monitorConfig);
  if (!aiResult.success) return aiResult;
  const mcpResult = validateMcp(monitorType, monitorConfig, target);
  if (!mcpResult.success) return mcpResult;
  const authSecretResult = validateAuthSecret(monitorConfig);
  if (!authSecretResult.success) return authSecretResult;

  // A project secret goes only over TLS; self-hosted internal model servers (ALLOW_INTERNAL_TARGETS) are exempt.
  const sendsSecret =
    (isRecord(monitorConfig.aiEndpoint) && typeof monitorConfig.aiEndpoint.secretKey === "string") ||
    (isRecord(monitorConfig.auth) && typeof monitorConfig.auth.secretKey === "string");
  if (
    sendsSecret &&
    typeof target === "string" &&
    parsedProtocol(target) === "http:" &&
    process.env.ALLOW_INTERNAL_TARGETS !== "true"
  ) {
    return invalid(
      "Invalid monitor target",
      "target must use https when a project secret is sent",
    );
  }

  if (monitorType === "http_request" || monitorType === "website") {
    // Only keys the client sent, so a stored legacy value never blocks an unrelated edit.
    const sent = isRecord(incomingConfig) ? incomingConfig : {};
    const { method, expectedStatusCodes } = sent;
    // The worker upper-cases the method and treats a blank one as GET, so both stay valid here.
    if (
      method != null &&
      method !== "" &&
      (typeof method !== "string" || !HTTP_METHODS.includes(method.toUpperCase()))
    ) {
      return invalid(
        "Invalid monitor configuration",
        `config.method must be one of ${HTTP_METHODS.join(", ")}`,
      );
    }
    if (expectedStatusCodes != null && !isValidStatusCodes(expectedStatusCodes)) {
      return invalid(
        "Invalid monitor configuration",
        'config.expectedStatusCodes must be a comma-separated list of codes, ranges or wildcards, e.g. "200-299,301,4xx"',
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
