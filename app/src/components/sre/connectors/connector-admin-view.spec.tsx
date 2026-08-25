import { fireEvent, render, screen } from "@testing-library/react";

import {
  getPrivateAgentConnectorJobResult,
  searchSreConnectorEvidence,
} from "@/actions/sre-connectors";

import { ConnectorAdminView } from "./connector-admin-view";
import { SRE_CONNECTOR_CATALOG } from "./connector-catalog";

if (!globalThis.ResizeObserver) {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver =
    ResizeObserverMock as unknown as typeof ResizeObserver;
}

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
  it("keeps implemented connector options in the shared setup catalog", () => {
    const addableTypes = SRE_CONNECTOR_CATALOG.filter(
      (item) => item.addable,
    ).map((item) => item.value);

    expect(addableTypes).toEqual(
      expect.arrayContaining([
        "sentry",
        "datadog",
        "elasticsearch",
        "tempo",
        "aws_cloudwatch",
        "gitlab",
        "pagerduty",
        "opsgenie",
      ]),
    );
  });

  it("keeps connector setup closed until the user explicitly opens it", () => {
    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[]}
        setupOptions={{ services: [], privateAgents: [] }}
        initialBindings={[]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: /setup guide/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("dialog", { name: "Add connector" }),
    ).not.toBeInTheDocument();
  });

  it("opens the responsive three-stage connector setup", () => {
    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[]}
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
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: /add connector/i })[0],
    );

    const dialog = screen.getByRole("dialog", { name: "Add connector" });
    expect(dialog).toHaveClass("w-[calc(100vw-1rem)]");
    expect(dialog).toHaveClass("sm:max-w-none");
    expect(dialog).toHaveClass("xl:min-w-[80rem]");
    expect(screen.getByText("Connection")).toBeInTheDocument();
    expect(
      screen.getByText("Endpoint and read-only access"),
    ).toBeInTheDocument();
    expect(screen.getByText("Service scope")).toBeInTheDocument();
    expect(
      screen.getByText(/read-only, bounded, service-scoped, redacted/i),
    ).toBeInTheDocument();
  });

  function openConnectorActions(name: string) {
    fireEvent.keyDown(
      screen.getByRole("button", { name: `Open actions for ${name}` }),
      {
        key: "Enter",
        code: "Enter",
      },
    );
  }

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
            services: [
              { id: "018f0000-0000-7000-8000-000000000003", name: "checkout" },
            ],
            createdAt: new Date("2026-06-28T10:00:00.000Z"),
            updatedAt: new Date("2026-06-28T10:00:00.000Z"),
          },
        ]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Context links" }),
    ).toBeInTheDocument();
    expect(screen.getByText("PagerDuty primary")).toBeInTheDocument();
    expect(screen.getByText(/webhook alerts/i)).toBeInTheDocument();
    expect(screen.queryByText(/routing key/i)).not.toBeInTheDocument();
  });

  it("shows operational connector details without endpoint or credential values", () => {
    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[connector]}
        setupOptions={{ services: [], privateAgents: [] }}
        initialBindings={[]}
        bindingSetupOptions={{
          notificationProviders: [],
          connectors: [],
          services: [],
        }}
      />,
    );

    expect(screen.getByText("Private Agent")).toBeInTheDocument();
    expect(screen.getByText("1 service")).toBeInTheDocument();
    expect(screen.getByText("low")).toBeInTheDocument();
    expect(
      screen.getByTitle(connector.lastValidatedAt.toLocaleString()),
    ).toBeInTheDocument();
    expect(screen.queryByText(connector.endpointUrl)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/access key|credential value/i),
    ).not.toBeInTheDocument();
  });

  it("opens connector-specific evidence search guidance", async () => {
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
      />,
    );

    openConnectorActions("CloudWatch prod");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /search evidence/i }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Search connector evidence",
    });
    expect(dialog).toHaveClass("max-w-2xl");
    expect(screen.getByText("Bounded search")).toBeInTheDocument();
    expect(screen.getByLabelText("Alarm or metric query")).toBeInTheDocument();
    expect(screen.queryByText("Active alarms")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Window"));
    expect(screen.getByRole("option", { name: "1 hour" })).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "4 hours" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "24 hours" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "1 hour" }));

    fireEvent.click(screen.getByRole("button", { name: /query examples/i }));
    expect(screen.getByText("Active alarms")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("prefix:checkout state:ALARM"),
    ).toBeInTheDocument();
    expect(screen.getByText(/up to 100 rows/i)).toBeInTheDocument();
  });

  it("requires an explicit namespace for Kubernetes evidence searches", async () => {
    const kubernetesConnector = {
      ...connector,
      name: "Kubernetes prod",
      type: "kubernetes" as const,
      endpointUrl: "https://kubernetes.default.svc",
    };

    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[kubernetesConnector]}
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
      />,
    );

    openConnectorActions("Kubernetes prod");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /search evidence/i }),
    );

    const namespace = screen.getByLabelText("Namespace");
    const submit = screen.getByRole("button", { name: "Search evidence" });
    expect(namespace).toBeRequired();
    expect(submit).toBeDisabled();

    fireEvent.change(namespace, { target: { value: "supercheck" } });
    expect(submit).toBeEnabled();
  });

  it("explains failed Private Agent jobs without implying they are pending", async () => {
    jest.mocked(searchSreConnectorEvidence).mockResolvedValueOnce({
      success: true,
      message: "Queued Private Agent connector search",
      privateAgentJobId: "018f0000-0000-7000-8000-000000000040",
      evidence: [],
      truncated: false,
    });
    jest.mocked(getPrivateAgentConnectorJobResult).mockResolvedValueOnce({
      success: true,
      job: {
        id: "018f0000-0000-7000-8000-000000000040",
        status: "failed",
        connectorId: connector.id,
        connectorName: "Kubernetes prod",
        evidence: [],
        truncated: false,
        errorCode: "HTTP 401",
        resultHash: null,
        createdAt: "2026-07-21T09:59:59.000Z",
        startedAt: "2026-07-21T10:00:00.000Z",
        completedAt: "2026-07-21T10:00:01.000Z",
        durationMs: 1000,
      },
    });

    const kubernetesConnector = {
      ...connector,
      name: "Kubernetes prod",
      type: "kubernetes" as const,
      endpointUrl: "https://kubernetes.default.svc",
    };

    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[kubernetesConnector]}
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
      />,
    );

    openConnectorActions("Kubernetes prod");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /search evidence/i }),
    );
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "supercheck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search evidence" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "View job result" }),
    );

    expect(
      await screen.findByText(
        "The job failed before any evidence was returned. Review the sanitized error above.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/job has not completed yet/i),
    ).not.toBeInTheDocument();
  });

  it("builds typed CloudWatch metric queries in the evidence search dialog", async () => {
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
      />,
    );

    openConnectorActions("CloudWatch prod");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /search evidence/i }),
    );
    expect(screen.queryByLabelText("Metric namespace")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /build a query/i }));
    fireEvent.change(screen.getByLabelText("Metric namespace"), {
      target: { value: "AWS/ApplicationELB" },
    });
    fireEvent.change(screen.getByLabelText("Metric name"), {
      target: { value: "TargetResponseTime" },
    });
    fireEvent.change(screen.getByLabelText("Dimensions"), {
      target: { value: "LoadBalancer=app/checkout" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Use built query" }));

    expect(
      screen.getByDisplayValue(
        "namespace:AWS/ApplicationELB metric:TargetResponseTime dimension:LoadBalancer=app/checkout stat:Average period:60",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Metric namespace")).not.toBeInTheDocument();
  });

  it("initializes Tempo builder state without values from another connector", async () => {
    const tempoConnector = {
      ...connector,
      id: "018f0000-0000-7000-8000-000000000030",
      name: "Tempo prod",
      type: "tempo" as const,
      endpointUrl: "http://tempo.observability.svc:3200",
    };

    render(
      <ConnectorAdminView
        loadError={null}
        initialConnectors={[tempoConnector]}
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
      />,
    );

    openConnectorActions("Tempo prod");
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /search evidence/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /build a query/i }));

    expect(screen.getByLabelText("TraceQL")).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Service" })).toHaveValue(
      "checkout",
    );
  });

  it("disables evidence search for collaboration connectors without live adapters", async () => {
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
      />,
    );

    openConnectorActions("Jira incidents");
    expect(
      await screen.findByRole("menuitem", { name: /search evidence/i }),
    ).toHaveAttribute("aria-disabled", "true");
  });
});
