const DEFAULT_CORS_ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://demo.supercheck.dev",
  "https://supercheck.io",
  "https://supercheck.pages.dev",
  "https://docs.supercheck.io",
  "https://www.supercheck.io",
  "https://app.supercheck.io",
] as const;

type ExactOriginPattern = {
  type: "exact";
  origin: string;
};

type WildcardOriginPattern = {
  type: "wildcard";
  protocol: string;
  hostnameSuffix: string;
  port: string;
};

export type CorsOriginPattern = ExactOriginPattern | WildcardOriginPattern;

type CorsEnv = {
  APP_URL?: string;
  TRUSTED_ORIGINS?: string;
  CORS_ALLOWED_ORIGINS?: string;
};

const WILDCARD_HOSTNAME_PLACEHOLDER = "wildcard-subdomain";
const WILDCARD_HOSTNAME_PREFIX = `${WILDCARD_HOSTNAME_PLACEHOLDER}.`;

function splitOriginList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseOriginUrl(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function normalizeOrigin(origin: string): string | null {
  return parseOriginUrl(origin)?.origin ?? null;
}

function parseWildcardOriginPattern(origin: string): WildcardOriginPattern | null {
  const normalizedOrigin = origin.replace(
    /^(https?):\/\/\*\./i,
    (_match, protocol: string) =>
      `${protocol.toLowerCase()}://${WILDCARD_HOSTNAME_PREFIX}`
  );
  if (normalizedOrigin === origin) {
    return null;
  }

  const parsedOrigin = parseOriginUrl(normalizedOrigin);
  if (!parsedOrigin) {
    return null;
  }

  const normalizedHostname = parsedOrigin.hostname.toLowerCase();
  if (!normalizedHostname.startsWith(WILDCARD_HOSTNAME_PREFIX)) {
    return null;
  }

  const hostnameSuffix = normalizedHostname.slice(
    WILDCARD_HOSTNAME_PREFIX.length
  );
  if (!hostnameSuffix || hostnameSuffix.includes("*")) {
    return null;
  }

  return {
    type: "wildcard",
    protocol: parsedOrigin.protocol.toLowerCase(),
    hostnameSuffix,
    port: parsedOrigin.port,
  };
}

export function parseCorsOriginPattern(origin: string): CorsOriginPattern | null {
  const trimmedOrigin = origin.trim();
  if (!trimmedOrigin) {
    return null;
  }

  if (trimmedOrigin.includes("*")) {
    return parseWildcardOriginPattern(trimmedOrigin);
  }

  const normalizedOrigin = normalizeOrigin(trimmedOrigin);
  if (!normalizedOrigin) {
    return null;
  }

  return {
    type: "exact",
    origin: normalizedOrigin,
  };
}

export function getAllowedCorsOriginPatterns(
  env?: CorsEnv
): CorsOriginPattern[] {
  const resolvedEnv = env ?? process.env;
  const configuredOrigins = [
    ...DEFAULT_CORS_ALLOWED_ORIGINS,
    ...(resolvedEnv.APP_URL ? [resolvedEnv.APP_URL] : []),
    ...splitOriginList(resolvedEnv.TRUSTED_ORIGINS),
    ...splitOriginList(resolvedEnv.CORS_ALLOWED_ORIGINS),
  ];

  const patterns: CorsOriginPattern[] = [];
  const seen = new Set<string>();

  for (const configuredOrigin of configuredOrigins) {
    const pattern = parseCorsOriginPattern(configuredOrigin);
    if (!pattern) {
      continue;
    }

    const key =
      pattern.type === "exact"
        ? `exact:${pattern.origin}`
        : `wildcard:${pattern.protocol}//*.${pattern.hostnameSuffix}:${pattern.port}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    patterns.push(pattern);
  }

  return patterns;
}

export function isCorsOriginAllowed(
  origin: string,
  allowedOrigins: CorsOriginPattern[]
): boolean {
  let requestOrigin: URL;

  try {
    requestOrigin = new URL(origin);
  } catch {
    return false;
  }

  const normalizedOrigin = requestOrigin.origin;
  const normalizedHostname = requestOrigin.hostname.toLowerCase();

  for (const allowedOrigin of allowedOrigins) {
    if (allowedOrigin.type === "exact") {
      if (allowedOrigin.origin === normalizedOrigin) {
        return true;
      }

      continue;
    }

    if (allowedOrigin.protocol !== requestOrigin.protocol) {
      continue;
    }

    if (allowedOrigin.port !== requestOrigin.port) {
      continue;
    }

    if (
      normalizedHostname !== allowedOrigin.hostnameSuffix &&
      normalizedHostname.endsWith(`.${allowedOrigin.hostnameSuffix}`)
    ) {
      return true;
    }
  }

  return false;
}
