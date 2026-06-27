import { fireEvent, render, screen } from "@testing-library/react";

import { ConnectorAdminView } from "./connector-admin-view";

jest.mock("@/actions/sre-connectors", () => ({
  disableSreConnector: jest.fn(),
  getPrivateAgentConnectorJobResult: jest.fn(),
  searchSreConnectorEvidence: jest.fn(),
  validateSreConnector: jest.fn(),
}));

const connector = {
  id: "018f0000-0000-7000-8000-000000000001",
  name: "CloudWatch prod",
  type: "aws_cloudwatch" as const,
  status: "valid" as const,
  riskLevel: "low" as const,
  executionMode: "private_agent" as const,
  privateAgent: {
    id: "018f0000-0000-7000-8000-000000000002",
    name: "prod-vpc-agent",
    status: "connected",
    lastHeartbeatAt: new Date("2026-06-27T10:00:00.000Z"),
  },
  scopedServiceIds: ["018f0000-0000-7000-8000-000000000003"],
  hasCredentials: true,
  defaultTimeWindowMinutes: 60,
  outputLimits: { maxRows: 100, maxBytes: 1_048_576, maxSeconds: 10 },
  endpointUrl: "https://monitoring.us-east-1.amazonaws.com",
  latestPrivateAgentJob: null,
  lastValidatedAt: new Date("2026-06-27T10:00:00.000Z"),
  lastValidationStatus: "valid",
  lastValidationError: null,
  createdAt: new Date("2026-06-27T09:00:00.000Z"),
  updatedAt: new Date("2026-06-27T10:00:00.000Z"),
};

describe("ConnectorAdminView", () => {
  it("opens connector-specific evidence search guidance", () => {
    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[connector]}
        setupOptions={{
          services: [
            {
              id: "018f0000-0000-7000-8000-000000000003",
              name: "checkout",
              environment: "prod",
              ownerTeam: "payments",
            },
          ],
          privateAgents: [],
        }}
      />
    );

    fireEvent.click(screen.getByLabelText("Search evidence for CloudWatch prod"));

    expect(screen.getByText("AWS CloudWatch query guide")).toBeInTheDocument();
    expect(screen.getByText("Active alarms")).toBeInTheDocument();
    expect(screen.getByDisplayValue("prefix:checkout state:ALARM")).toBeInTheDocument();
    expect(screen.getByText(/100 rows, 10s timeout/i)).toBeInTheDocument();
  });
});
