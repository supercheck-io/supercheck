import {
  SRE_CONNECTOR_TYPES,
  isLiveSearchConnectorType,
} from "./connector-capabilities";
import { connectorCredentialRequirementError } from "./connector-credential-requirements";
import {
  RETIRED_CONNECTOR_TYPES,
  isRetiredConnectorType,
  retiredConnectorExplanation,
} from "./retired-connectors";
import { SRE_CONNECTOR_CATALOG } from "@/components/sre/connectors/connector-catalog";

describe("retired connector types", () => {
  it.each(RETIRED_CONNECTOR_TYPES)(
    "%s is not in the catalog, not addable and not live",
    (type) => {
      expect(
        SRE_CONNECTOR_CATALOG.find((item) => item.value === type),
      ).toBeUndefined();
      expect(isLiveSearchConnectorType(type)).toBe(false);
      expect(isRetiredConnectorType(type)).toBe(true);
      expect(retiredConnectorExplanation(type).length).toBeGreaterThan(20);
    },
  );

  it("keeps the stored type union parseable for existing rows", () => {
    for (const type of RETIRED_CONNECTOR_TYPES) {
      expect(SRE_CONNECTOR_TYPES).toContain(type);
    }
  });

  it("keeps hidden database types non-addable and adds the knowledge connectors", () => {
    for (const type of [
      "appdynamics",
      "postgresql",
      "mysql",
      "mongodb",
      "redis",
      "clickhouse",
    ]) {
      expect(
        SRE_CONNECTOR_CATALOG.find((item) => item.value === type)?.addable,
      ).toBe(false);
    }
    for (const type of ["jira", "confluence", "notion"]) {
      expect(
        SRE_CONNECTOR_CATALOG.find((item) => item.value === type)?.addable,
      ).toBe(true);
      expect(isLiveSearchConnectorType(type as "jira")).toBe(true);
    }
  });
});

describe("knowledge credential requirements", () => {
  it("requires a token and a sane email", () => {
    expect(
      connectorCredentialRequirementError("jira", { email: "a@b.co" }),
    ).toContain("API token");
    expect(
      connectorCredentialRequirementError("confluence", {
        secret: "t",
        email: "nope",
      }),
    ).toContain("valid email");
    expect(
      connectorCredentialRequirementError("jira", {
        secret: "t",
        email: "a@b.co",
      }),
    ).toBeNull();
    expect(
      connectorCredentialRequirementError("jira", { secret: "pat" }),
    ).toBeNull();
    expect(
      connectorCredentialRequirementError("notion", { secret: " " }),
    ).toContain("integration token");
    expect(
      connectorCredentialRequirementError("notion", { secret: "x" }),
    ).toBeNull();
  });
});
