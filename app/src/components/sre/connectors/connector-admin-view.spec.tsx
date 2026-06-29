import { fireEvent, render, screen } from "@testing-library/react";

import { ConnectorAdminView } from "./connector-admin-view";

jest.mock("@/actions/sre-integration-bindings", () => ({
  createSreIntegrationBinding: jest.fn(),
  disableSreIntegrationBinding: jest.fn(),
}));

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
  it("renders existing AI SRE context links without exposing secrets", () => {
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
        initialBindings={[
          {
            id: "018f0000-0000-7000-8000-000000000010",
            integrationKey: "pagerduty",
            correlationStrategy: "dedup_key",
            enabled: true,
            notificationProvider: {
              id: "018f0000-0000-7000-8000-000000000011",
              name: "PagerDuty primary",
              type: "webhook",
            },
            externalConnector: {
              id: "018f0000-0000-7000-8000-000000000012",
              name: "PagerDuty read-only",
              type: "pagerduty",
              status: "valid",
            },
            services: [{ id: "018f0000-0000-7000-8000-000000000003", name: "checkout" }],
            createdAt: new Date("2026-06-28T10:00:00.000Z"),
            updatedAt: new Date("2026-06-28T10:00:00.000Z"),
          },
        ]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />
    );

    expect(screen.getByText("AI SRE context links")).toBeInTheDocument();
    expect(screen.getByText("PagerDuty primary")).toBeInTheDocument();
    expect(screen.getByText(/webhook alerts/i)).toBeInTheDocument();
    expect(screen.queryByText(/routing key/i)).not.toBeInTheDocument();
  });

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
        initialBindings={[]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />
    );

    fireEvent.click(screen.getByLabelText("Search evidence for CloudWatch prod"));

    expect(screen.getByText("AWS CloudWatch query guide")).toBeInTheDocument();
    expect(screen.getByText("Active alarms")).toBeInTheDocument();
    expect(screen.getByDisplayValue("prefix:checkout state:ALARM")).toBeInTheDocument();
    expect(screen.getByText(/100 rows, 10s timeout/i)).toBeInTheDocument();
  });

  it("builds typed CloudWatch metric queries in the evidence search dialog", () => {
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
        initialBindings={[]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />
    );

    fireEvent.click(screen.getByLabelText("Search evidence for CloudWatch prod"));
    fireEvent.change(screen.getByLabelText("Metric namespace"), {
      target: { value: "AWS/ApplicationELB" },
    });
    fireEvent.change(screen.getByLabelText("Metric name"), {
      target: { value: "TargetResponseTime" },
    });
    fireEvent.change(screen.getByLabelText("Dimensions"), {
      target: { value: "LoadBalancer=app/checkout" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Build query" }));

    expect(
      screen.getByDisplayValue(
        "namespace:AWS/ApplicationELB metric:TargetResponseTime dimension:LoadBalancer=app/checkout stat:Average period:60",
      ),
    ).toBeInTheDocument();
  });

  it("disables evidence search for collaboration connectors without live adapters", () => {
    const jiraConnector = {
      ...connector,
      id: "018f0000-0000-7000-8000-000000000020",
      name: "Jira incidents",
      type: "jira" as const,
      executionMode: "direct" as const,
      privateAgent: null,
      endpointUrl: "https://example.atlassian.net",
      latestPrivateAgentJob: null,
    };

    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[jiraConnector]}
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
        initialBindings={[]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />
    );

    expect(screen.getByLabelText("Search evidence for Jira incidents")).toBeDisabled();
  });
});
