import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { useState } from "react";
import { disableSreDiagnosticQuery } from "@/actions/sre-diagnostic-queries";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
        setupOptions={{
          connectors: [
            {
              id: "c1",
              name: "Prometheus",
              type: "prometheus",
              status: "valid",
            },
          ],
        }}
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
      />,
    );

    expect(screen.getByText("Latency by route")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search saved queries"), {
      target: { value: "postgres" },
    });

    expect(screen.queryByText("Latency by route")).not.toBeInTheDocument();
  });

  it("keeps a disabled query disabled after its section closes and reopens", async () => {
    const query = {
      id: "q1",
      connectorId: "c1",
      connectorName: "Prometheus",
      connectorType: "prometheus" as const,
      name: "Latency by route",
      queryType: "promql" as const,
      template: "up",
      parameterSchema: {},
      allowlist: { metrics: ["up"] },
      maxRows: 100,
      maxBytes: 1048576,
      maxSeconds: 10,
      status: "active" as const,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const disabled = { ...query, status: "disabled" as const };
    jest
      .mocked(disableSreDiagnosticQuery)
      .mockResolvedValue({
        success: true,
        query: disabled,
        message: "Saved query disabled",
      });
    const changed = jest.fn();
    function Section() {
      const [queries, setQueries] = useState([query] as Array<
        typeof query | typeof disabled
      >);
      return (
        <Collapsible defaultOpen>
          <CollapsibleTrigger>Saved queries</CollapsibleTrigger>
          <CollapsibleContent>
            <DiagnosticQueriesAdminView
              initialQueries={queries}
              setupOptions={{
                connectors: [
                  {
                    id: "c1",
                    name: "Prometheus",
                    type: "prometheus",
                    status: "valid",
                  },
                ],
              }}
              loadError={null}
              onSetupChanged={() => {
                changed();
                setQueries([disabled]);
              }}
            />
          </CollapsibleContent>
        </Collapsible>
      );
    }
    render(<Section />);
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Open actions for Latency by route" }),
      { key: "Enter" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Disable" }));
    fireEvent.click(screen.getByRole("button", { name: "Disable query" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "Saved queries" }));
    expect(screen.queryByText("Latency by route")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Saved queries" }));
    expect(await screen.findByText("disabled")).toBeInTheDocument();
    fireEvent.keyDown(
      screen.getByRole("button", { name: "Open actions for Latency by route" }),
      { key: "Enter" },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Disable" }),
    ).toHaveAttribute("data-disabled");
  });

  it("applies connector-specific diagnostic adapter recipes", () => {
    render(
      <DiagnosticQueriesAdminView
        loadError={null}
        setupOptions={{
          connectors: [
            {
              id: "c1",
              name: "Prometheus",
              type: "prometheus",
              status: "valid",
            },
          ],
        }}
        initialQueries={[]}
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: /add query/i })[0]);

    expect(screen.getByText("Query templates")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /Prometheus HTTP 5xx rate/i }),
    );

    expect(
      screen.getByDisplayValue("Prometheus HTTP 5xx rate"),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        'sum(rate(http_requests_total{service="$service",status=~"5.."}[$window]))',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        (value) => value.includes('"window"') && value.includes('"15m"'),
      ),
    ).toBeInTheDocument();
  });

  it("does not offer disabled connectors for new recipes", () => {
    render(
      <DiagnosticQueriesAdminView
        loadError={null}
        setupOptions={{
          connectors: [
            {
              id: "c1",
              name: "Disabled Prometheus",
              type: "prometheus",
              status: "disabled",
            },
          ],
        }}
        initialQueries={[]}
      />,
    );

    expect(screen.getByText(/Add or enable an evidence connector/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add query" }),
    ).not.toBeInTheDocument();
  });
});
