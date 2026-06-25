import {
  buildPrivateAgentRegistrationMetadata,
  getPrivateAgentRegistrationTokenExpiresAt,
  incrementPrivateAgentRegistrationAttempts,
  markPrivateAgentRegistrationExchanged,
  PRIVATE_AGENT_REGISTRATION_TOKEN_TTL_MS,
} from "./registration-token";

describe("Private Agent registration token metadata", () => {
  const now = new Date("2026-06-22T10:00:00.000Z");

  it("stores a short-lived registration token expiry without dropping existing metadata", () => {
    const metadata = buildPrivateAgentRegistrationMetadata({ network: "prod" }, now);

    expect(metadata).toMatchObject({
      network: "prod",
      registrationTokenIssuedAt: now.toISOString(),
      registrationExchangeAttempts: 0,
      registrationTokenExchangedAt: null,
    });
    expect(getPrivateAgentRegistrationTokenExpiresAt(metadata)?.toISOString()).toBe(
      new Date(now.getTime() + PRIVATE_AGENT_REGISTRATION_TOKEN_TTL_MS).toISOString()
    );
  });

  it("records failed attempts and successful exchange state", () => {
    const issued = buildPrivateAgentRegistrationMetadata({}, now);
    const failed = incrementPrivateAgentRegistrationAttempts(issued, now, "invalid_token");
    const exchanged = markPrivateAgentRegistrationExchanged(failed, new Date("2026-06-22T10:01:00.000Z"));

    expect(failed).toMatchObject({
      registrationExchangeAttempts: 1,
      registrationTokenLastFailureReason: "invalid_token",
    });
    expect(exchanged).toMatchObject({
      registrationExchangeAttempts: 2,
      registrationTokenExchangedAt: "2026-06-22T10:01:00.000Z",
      registrationTokenLastFailureAt: null,
      registrationTokenLastFailureReason: null,
    });
  });
});
