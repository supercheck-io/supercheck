import { render, screen } from "@testing-library/react";
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
});
