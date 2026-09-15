import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import { SreMessageContent } from "./sre-message-content";

jest.mock("recharts", () => {
  const passthrough = ({
    children,
    dataKey,
    fill,
    stroke,
  }: {
    children?: ReactNode;
    dataKey?: string;
    fill?: string;
    stroke?: string;
  }) => <div data-chart-prop={dataKey ?? fill ?? stroke}>{children}</div>;

  return {
    Area: passthrough,
    AreaChart: passthrough,
    Bar: passthrough,
    BarChart: passthrough,
    Brush: passthrough,
    CartesianGrid: passthrough,
    Legend: passthrough,
    Line: passthrough,
    LineChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

describe("SreMessageContent", () => {
  it("renders common Copilot markdown without exposing raw markers", () => {
    render(
      <SreMessageContent
        content={"## Root cause\n1. **API** returned `500`\n- Check logs"}
      />,
    );

    expect(screen.getByText("Root cause")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("Check logs")).toBeInTheDocument();
    expect(screen.queryByText("**API**")).not.toBeInTheDocument();
  });

  it("renders markdown tables", () => {
    render(
      <SreMessageContent
        content={
          "| Service | Status |\n| --- | --- |\n| checkout-api | failing |"
        }
      />,
    );

    expect(
      screen.getByRole("columnheader", { name: "Service" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("cell", { name: "checkout-api" }),
    ).toBeInTheDocument();
  });

  it("keeps escaped query pipes inside the same table cell", () => {
    render(<SreMessageContent content={'| Source | Query |\n| --- | --- |\n| Loki | `{service="checkout"} \\|= "error"` |'} />);
    expect(screen.getByRole("cell", { name: '{service="checkout"} |= "error"' })).toBeInTheDocument();
    expect(screen.getAllByRole("cell")).toHaveLength(2);
  });

  it("does not turn a missing chart observation into zero", () => {
    render(<SreMessageContent content={["```chart", JSON.stringify({ type: "line", title: "Errors", xKey: "time", series: [{ key: "errors", label: "Error count" }], data: [{ time: "10:00", errors: 5 }, { time: "10:01" }] }), "```"].join("\n")} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders validated chart blocks", () => {
    render(
      <SreMessageContent
        content={[
          "```chart",
          JSON.stringify({
            type: "bar",
            title: "Error rate",
            sources: [
              {
                label: "Prometheus",
                type: "prometheus",
                evidenceIds: ["ev-prometheus-errors"],
              },
            ],
            xKey: "minute",
            series: [{ key: "errors", label: "Errors" }],
            data: [{ minute: "10:00", errors: 5 }],
          }),
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("Error rate")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("Prometheus")).toBeInTheDocument();
    expect(screen.getByText("prometheus")).toBeInTheDocument();
    expect(screen.getByText("1 evidence")).toBeInTheDocument();
    expect(
      screen
        .getByText("Prometheus")
        .closest(
          "[title='Prometheus · prometheus · Evidence: ev-prometheus-errors']",
        ),
    ).toBeInTheDocument();
  });

  it("renders area chart metadata and dense data controls", () => {
    render(
      <SreMessageContent
        content={[
          "```chart",
          JSON.stringify({
            type: "area",
            title: "Cluster memory",
            description: "Recent Kubernetes node memory pressure.",
            xKey: "minute",
            series: [{ key: "memory", label: "Memory %" }],
            data: Array.from({ length: 13 }, (_, index) => ({
              minute: `10:${String(index).padStart(2, "0")}`,
              memory: 70 + index,
            })),
          }),
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("Cluster memory")).toBeInTheDocument();
    expect(
      screen.getByText("Recent Kubernetes node memory pressure."),
    ).toBeInTheDocument();
    expect(screen.getByText("Memory %")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
  });

  it("windows 10,000-line outputs instead of creating 10,000 DOM rows", async () => {
    const heightSpy = jest
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(384);
    const widthSpy = jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(800);
    const content = Array.from(
      { length: 10_000 },
      (_, index) => `2026-08-18T00:00:00Z log line ${index + 1}`,
    ).join("\n");

    const renderStartedAt = performance.now();
    const { container } = render(<SreMessageContent content={content} />);
    expect(performance.now() - renderStartedAt).toBeLessThan(500);

    expect(
      screen.getByRole("region", {
        name: "Large Copilot output, 10000 lines",
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      const renderedRows = container.querySelectorAll("[data-index]");
      expect(renderedRows.length).toBeGreaterThan(0);
      expect(renderedRows.length).toBeLessThan(100);
    });
    heightSpy.mockRestore();
    widthSpy.mockRestore();
  });
});
