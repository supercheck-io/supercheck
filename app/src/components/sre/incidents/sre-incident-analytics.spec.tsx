import { render, screen } from "@testing-library/react";

jest.mock("recharts", () => {
  const React = jest.requireActual("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    Area: passthrough,
    AreaChart: passthrough,
    Bar: passthrough,
    BarChart: passthrough,
    CartesianGrid: passthrough,
    Cell: passthrough,
    Line: passthrough,
    LineChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

import { SreIncidentAnalytics, formatTrendDate } from "./sre-incident-analytics";

describe("SreIncidentAnalytics", () => {
  it("renders bounded incident trends and service impact", () => {
    render(<SreIncidentAnalytics analytics={{
      windowDays: 30,
      summary: {
        created: 8,
        resolved: 6,
        resolutionRate: 75,
        averageResolutionMinutes: 95,
      },
      daily: [{ date: "2026-07-10", created: 2, resolved: 1 }],
      severities: [{ severity: "sev2", count: 3 }],
      topServices: [{ serviceId: "checkout", serviceName: "checkout-api", count: 4 }],
    }} />);

    expect(screen.getByText("Trends")).toBeInTheDocument();
    expect(screen.getByText("Of incidents created in the last 30 days")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("1h 35m")).toBeInTheDocument();
    expect(screen.getByText("Most affected services")).toBeInTheDocument();
    expect(screen.getByText("Severity")).toBeInTheDocument();
  });

  it("formats trend dates as MMM d without a timezone shift", () => {
    expect(formatTrendDate("2026-09-27")).toBe("Sep 27");
    expect(formatTrendDate("2026-10-01")).toBe("Oct 1");
    expect(formatTrendDate("not-a-date")).toBe("not-a-date");
  });
});
