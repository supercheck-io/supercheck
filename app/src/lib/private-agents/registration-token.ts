export const PRIVATE_AGENT_REGISTRATION_TOKEN_TTL_MS = 15 * 60_000;

type PrivateAgentMetadata = Record<string, unknown>;

export function buildPrivateAgentRegistrationMetadata(metadata: unknown, now = new Date()): PrivateAgentMetadata {
  const current = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as PrivateAgentMetadata : {};
  const issuedAt = now.toISOString();

  return {
    ...current,
    registrationTokenIssuedAt: issuedAt,
    registrationTokenExpiresAt: new Date(now.getTime() + PRIVATE_AGENT_REGISTRATION_TOKEN_TTL_MS).toISOString(),
    registrationExchangeAttempts: 0,
    registrationTokenExchangedAt: null,
    registrationTokenLastFailureAt: null,
    registrationTokenLastFailureReason: null,
  };
}

export function getPrivateAgentRegistrationTokenExpiresAt(metadata: unknown): Date | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const expiresAt = (metadata as PrivateAgentMetadata).registrationTokenExpiresAt;
  if (typeof expiresAt !== "string") {
    return null;
  }

  const parsed = new Date(expiresAt);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function incrementPrivateAgentRegistrationAttempts(
  metadata: unknown,
  now = new Date(),
  failureReason?: string
): PrivateAgentMetadata {
  const current = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as PrivateAgentMetadata : {};
  const currentAttempts = typeof current.registrationExchangeAttempts === "number" ? current.registrationExchangeAttempts : 0;

  return {
    ...current,
    registrationExchangeAttempts: currentAttempts + 1,
    registrationTokenLastFailureAt: failureReason ? now.toISOString() : current.registrationTokenLastFailureAt ?? null,
    registrationTokenLastFailureReason: failureReason ?? current.registrationTokenLastFailureReason ?? null,
  };
}

export function markPrivateAgentRegistrationExchanged(metadata: unknown, now = new Date()): PrivateAgentMetadata {
  return {
    ...incrementPrivateAgentRegistrationAttempts(metadata, now),
    registrationTokenExchangedAt: now.toISOString(),
    registrationTokenLastFailureAt: null,
    registrationTokenLastFailureReason: null,
  };
}
