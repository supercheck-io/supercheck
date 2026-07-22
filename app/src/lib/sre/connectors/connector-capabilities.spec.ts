import {
  connectorRequiresCredentials,
  OPTIONAL_CREDENTIAL_CONNECTOR_TYPES,
} from "./connector-capabilities";

describe("connector credential requirements", () => {
  it.each(OPTIONAL_CREDENTIAL_CONNECTOR_TYPES)(
    "allows %s to validate an intentionally unauthenticated endpoint",
    (connectorType) => {
      expect(connectorRequiresCredentials(connectorType)).toBe(false);
    },
  );

  it.each(["github", "kubernetes", "sentry", "aws_cloudwatch"] as const)(
    "requires credentials for %s",
    (connectorType) => {
      expect(connectorRequiresCredentials(connectorType)).toBe(true);
    },
  );

  it("keeps webhook credential handling optional", () => {
    expect(connectorRequiresCredentials("webhook")).toBe(false);
  });
});
