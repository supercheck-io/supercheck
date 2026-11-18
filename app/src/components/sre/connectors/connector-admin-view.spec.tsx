import { Profiler } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

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
    expect(dialog).toHaveClass("sm:max-w-3xl");
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
    expect(screen.getByText("PagerDuty primary (webhook)")).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
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

    expect(screen.getAllByText("Private Agent").length).toBeGreaterThan(0);
    expect(screen.getByText("prod-vpc-agent")).toBeInTheDocument();
    // Service scope and risk are hidden by default (available under View).
    expect(screen.queryByText("1 service")).not.toBeInTheDocument();
    // DateCell omits the year for current-year dates, so accept both forms.
    expect(screen.getByText(/^Jun 27(, 2026)?$/)).toBeInTheDocument();
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
      await screen.findByRole("menuitem", { name: /preview data/i }),
    );

    const dialog = screen.getByRole("dialog", {
      name: "Preview connector data",
    });
    expect(dialog).toHaveClass("max-w-2xl");
    expect(screen.getByText("Read-only query")).toBeInTheDocument();
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
    expect(screen.getByText(/up to 100 results/i)).toBeInTheDocument();
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
      await screen.findByRole("menuitem", { name: /preview data/i }),
    );

    const namespace = screen.getByLabelText("Namespace");
    const submit = screen.getByRole("button", { name: "Run query" });
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
      await screen.findByRole("menuitem", { name: /preview data/i }),
    );
    fireEvent.change(screen.getByLabelText("Namespace"), {
      target: { value: "supercheck" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run query" }));
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
      await screen.findByRole("menuitem", { name: /preview data/i }),
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
      await screen.findByRole("menuitem", { name: /preview data/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /build a query/i }));

    expect(screen.getByLabelText("TraceQL")).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "Service" })).toHaveValue(
      "checkout",
    );
  });

  it("opens the evidence search dialog when a connector row is clicked or activated by keyboard", async () => {
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

    const row = screen.getByText("CloudWatch prod").closest("tr") as HTMLElement;
    fireEvent.click(row);
    expect(
      await screen.findByRole("button", { name: "Run query" }),
    ).toBeInTheDocument();
  });

  it("keeps secondary toolbar actions in a More menu", async () => {
    const onOpenSavedQueries = jest.fn();
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
        onOpenSavedQueries={onOpenSavedQueries}
      />,
    );

    expect(screen.getByRole("button", { name: /add connector/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /setup guide/i })).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("button", { name: /more/i }), {
      key: "Enter",
      code: "Enter",
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /saved queries/i }));
    expect(onOpenSavedQueries).toHaveBeenCalled();
  });

  it("settles after mounting the table without re-render loops", async () => {
    const commits = jest.fn();
    render(
      <Profiler id="connectors" onRender={commits}>
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
        />
      </Profiler>,
    );
    await screen.findByText("CloudWatch prod");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const settled = commits.mock.calls.length;
    expect(settled).toBeLessThan(15);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(commits.mock.calls.length).toBe(settled);
  });

  describe("preview dialog", () => {
    const services = [
      { id: "svc-1", name: "Checkout", otelServiceName: "checkout-otel", environment: null, ownerTeam: null },
      { id: "svc-2", name: "Payments", otelServiceName: null, environment: null, ownerTeam: null },
    ];
    const tempoConnector = {
      ...connector,
      id: "018f0000-0000-7000-8000-000000000050",
      name: "Tempo prod",
      type: "tempo" as const,
      scopedServiceIds: [],
      defaultTimeWindowMinutes: 1440,
    };

    beforeAll(() => {
      Element.prototype.scrollIntoView = jest.fn();
    });

    async function openPreview() {
      render(
        <ConnectorAdminView
          loadError={null}
          initialConnectors={[tempoConnector]}
          setupOptions={{ services, privateAgents: [] }}
          initialBindings={[]}
          bindingSetupOptions={{ notificationProviders: [], connectors: [], services: [] }}
        />,
      );
      openConnectorActions("Tempo prod");
      fireEvent.click(await screen.findByRole("menuitem", { name: /preview data/i }));
    }

    it("prefills a query from the service OTel name and follows service changes until edited", async () => {
      await openPreview();
      const query = screen.getByLabelText("Trace search");
      expect(query).toHaveValue('{ resource.service.name = "checkout-otel" && status = error }');
      expect(screen.getByLabelText("Window")).toHaveTextContent("1 hour");

      fireEvent.click(screen.getByLabelText("Service"));
      fireEvent.click(await screen.findByRole("option", { name: "Payments" }));
      expect(query).toHaveValue('{ resource.service.name = "Payments" && status = error }');

      fireEvent.change(query, { target: { value: "my own query" } });
      fireEvent.click(screen.getByLabelText("Service"));
      fireEvent.click(await screen.findByRole("option", { name: "Checkout" }));
      expect(query).toHaveValue("my own query");
    });

    it("offers to widen an empty search to 24 hours", async () => {
      await openPreview();
      const search = jest.mocked(searchSreConnectorEvidence);
      search.mockResolvedValue({ success: true, evidence: [], truncated: false, message: "Returned 0" });

      fireEvent.click(screen.getByRole("button", { name: "Run query" }));
      expect(await screen.findByText("No matching data in the last hour.")).toBeInTheDocument();
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ timeWindowMinutes: 60 }));

      const widen = screen.getByRole("button", { name: "Widen to 24 hours" });
      await waitFor(() => expect(widen).toBeEnabled());
      fireEvent.click(widen);
      expect(await screen.findByText("No matching data in the last 24 hours.")).toBeInTheDocument();
      expect(search).toHaveBeenLastCalledWith(expect.objectContaining({ timeWindowMinutes: 1440 }));
      expect(screen.queryByRole("button", { name: "Widen to 24 hours" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Edit query" }));
      expect(screen.getByLabelText("Trace search")).toHaveFocus();
    });

    it("links only http sources", async () => {
      await openPreview();
      jest.mocked(searchSreConnectorEvidence).mockResolvedValueOnce({
        success: true,
        truncated: false,
        message: "Returned 1",
        evidence: [
          {
            id: "e2",
            sourceUri: "javascript:alert(1)",
            title: "odd source",
            summary: "s",
            evidenceType: "log",
            observedAt: "2026-06-27T10:00:00.000Z",
            resultHash: "h",
          },
        ],
      });
      fireEvent.click(screen.getByRole("button", { name: "Run query" }));
      fireEvent.click(await screen.findByRole("button", { name: /odd source/ }));
      expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("shows a compact result list that expands and an inline error", async () => {
      await openPreview();
      const search = jest.mocked(searchSreConnectorEvidence);
      search.mockResolvedValueOnce({
        success: true,
        truncated: true,
        message: "Returned 1",
        evidence: [
          {
            id: "e1",
            sourceUri: "https://tempo.example/trace/1",
            title: "checkout failed",
            summary: "full summary text",
            evidenceType: "trace",
            observedAt: "2026-06-27T10:00:00.000Z",
            resultHash: "abcdef1234567890",
          },
        ],
      });
      fireEvent.click(screen.getByRole("button", { name: "Run query" }));
      expect(await screen.findByText(/Showing 1 result\. More matched/)).toBeInTheDocument();
      expect(screen.queryByText("full summary text")).not.toBeInTheDocument();
      expect(screen.queryByText("abcdef1234567890")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /checkout failed/ }));
      expect(screen.getByText("full summary text")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "https://tempo.example/trace/1" })).toBeInTheDocument();
      expect(screen.getByText("abcdef1234567890")).toBeInTheDocument();

      search.mockResolvedValueOnce({ success: false, error: "Query rejected by policy" });
      fireEvent.click(screen.getByRole("button", { name: "Run query" }));
      expect(await screen.findByText("Query rejected by policy")).toBeInTheDocument();
      expect(screen.queryByText("checkout failed")).not.toBeInTheDocument();
    });
  });
});
