import { render, screen } from "@testing-library/react";

import { getMonitorStatusConfig, MonitorStatusIndicator } from "./monitor-status-indicator";

describe("MonitorStatusIndicator", () => {
  it.each([
    ["up", "Up"],
    ["down", "Down"],
    ["paused", "Paused"],
    ["pending", "Pending"],
    ["maintenance", "Maintenance"],
    ["error", "Error"],
    ["UP", "Up"],
    ["something-new", "Unknown"],
  ])("labels %s as %s", (status, label) => {
    render(<MonitorStatusIndicator monitorId="m-1" status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("gives each known status its own tone", () => {
    expect(getMonitorStatusConfig("up").tone).toBe("success");
    expect(getMonitorStatusConfig("down").tone).toBe("danger");
    expect(getMonitorStatusConfig("maintenance").tone).toBe("indigo");
  });
});
