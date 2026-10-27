import {
  connectorRequiresCredentials,
  isLiveSearchConnectorType,
  OPTIONAL_CREDENTIAL_CONNECTOR_TYPES,
  SRE_CONNECTOR_TYPES,
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

});

describe("connector catalog", () => {
  it("only lists types the investigation agent can search or call", () => {
    for (const type of SRE_CONNECTOR_TYPES) {
      if (type === "supercheck_native") continue;
      expect(isLiveSearchConnectorType(type)).toBe(true);
    }
  });
});
