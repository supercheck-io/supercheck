import { render, screen } from "@testing-library/react";

jest.mock("recharts", () => {
  const React = jest.requireActual("react");
  const passthrough = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return {
    CartesianGrid: passthrough,
    Line: passthrough,
    LineChart: passthrough,
    ResponsiveContainer: passthrough,
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

import { SreIncidentAnalytics } from "./sre-incident-analytics";

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

    expect(screen.getByText("Incident trends")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("1h 35m")).toBeInTheDocument();
    expect(screen.getByText("checkout-api")).toBeInTheDocument();
  });
});
