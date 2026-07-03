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
  }) => (
    <div data-chart-prop={dataKey ?? fill ?? stroke}>
      {children}
    </div>
  );

  return {
    Bar: passthrough,
    BarChart: passthrough,
    CartesianGrid: passthrough,
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
    render(<SreMessageContent content={"## Root cause\n1. **API** returned `500`\n- Check logs"} />);

    expect(screen.getByText("Root cause")).toBeInTheDocument();
    expect(screen.getByText("API")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("Check logs")).toBeInTheDocument();
    expect(screen.queryByText("**API**")).not.toBeInTheDocument();
  });

  it("renders markdown tables", () => {
    render(<SreMessageContent content={"| Service | Status |\n| --- | --- |\n| checkout-api | failing |"} />);

    expect(screen.getByRole("columnheader", { name: "Service" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "checkout-api" })).toBeInTheDocument();
  });

  it("renders validated chart blocks", () => {
    render(
      <SreMessageContent
        content={[
          "```chart",
          JSON.stringify({
            type: "bar",
            title: "Error rate",
            xKey: "minute",
            series: [{ key: "errors", label: "Errors" }],
            data: [{ minute: "10:00", errors: 5 }],
          }),
          "```",
        ].join("\n")}
      />
    );

    expect(screen.getByText("Error rate")).toBeInTheDocument();
  });
});
