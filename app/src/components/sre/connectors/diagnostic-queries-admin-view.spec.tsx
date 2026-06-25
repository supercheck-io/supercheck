import { fireEvent, render, screen } from "@testing-library/react";

import { DiagnosticQueriesAdminView } from "./diagnostic-queries-admin-view";

jest.mock("@/actions/sre-diagnostic-queries", () => ({
  createSreDiagnosticQuery: jest.fn(),
  disableSreDiagnosticQuery: jest.fn(),
}));

describe("DiagnosticQueriesAdminView", () => {
  it("renders and filters diagnostic queries", () => {
    render(
      <DiagnosticQueriesAdminView
        loadError={null}
        setupOptions={{ connectors: [{ id: "c1", name: "Prometheus", type: "prometheus", status: "valid" }] }}
        initialQueries={[
          {
            id: "q1",
            connectorId: "c1",
            connectorName: "Prometheus",
            connectorType: "prometheus",
            name: "Latency by route",
            queryType: "promql",
            template: "sum(rate(http_requests_total[5m]))",
            parameterSchema: {},
            allowlist: { metrics: ["http_requests_total"] },
            maxRows: 100,
            maxBytes: 1048576,
            maxSeconds: 10,
            status: "active",
            createdAt: new Date("2026-06-24T10:00:00Z"),
            updatedAt: new Date("2026-06-24T10:00:00Z"),
          },
        ]}
      />
    );

    expect(screen.getByText("Latency by route")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("Search query, connector, type..."), { target: { value: "postgres" } });

    expect(screen.queryByText("Latency by route")).not.toBeInTheDocument();
  });
});
