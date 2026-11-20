import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { userRole: "project_admin" } }) }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ maxJobNotificationChannels: 5, maxMonitorNotificationChannels: 5 }) }));
jest.mock("@/components/ui/info-popover", () => ({ InfoPopover: ({ label }: { label: string }) => <button aria-label={label} type="button" /> }));
jest.mock("@/components/alerts/notification-provider-form", () => ({ NotificationProviderForm: () => null }));
jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

import { AlertSettings } from "./alert-settings";

const base = {
  enabled: true,
  notificationProviders: ["p1"],
  alertOnFailure: true,
  alertOnRecovery: true,
  failureThreshold: 1,
  recoveryThreshold: 1,
};

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => [] }) as never;
});

describe("AlertSettings incidents block", () => {
  it("defaults incidents and auto-resolve to on", () => {
    render(<AlertSettings value={base} />);
    expect(screen.getByLabelText("Open an incident when this alerts")).toBeChecked();
    expect(screen.getByLabelText(/Resolve automatically on recovery/)).toBeChecked();
    expect(screen.getByLabelText("About incidents")).toBeInTheDocument();
  });

  it("emits incidentEnabled=false when switched off and hides the other options", () => {
    const onChange = jest.fn();
    render(<AlertSettings value={base} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Open an incident when this alerts"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ incidentEnabled: false }));
  });

  it("emits autoResolveIncident=false", () => {
    const onChange = jest.fn();
    render(<AlertSettings value={base} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Resolve automatically on recovery/));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ autoResolveIncident: false }));
  });

  it("disables auto-resolve with a hint when recovery alerts are off", () => {
    render(<AlertSettings value={{ ...base, alertOnRecovery: false }} />);
    expect(screen.getByLabelText(/Resolve automatically on recovery/)).toBeDisabled();
    expect(screen.getByText("Turn on recovery alerts to auto-resolve")).toBeInTheDocument();
  });

  it("shows a stored severity", () => {
    render(<AlertSettings value={{ ...base, incidentSeverity: "sev1" }} />);
    expect(screen.getByLabelText("Severity")).toHaveTextContent("SEV1");
  });
});

describe("AlertSettings incidents block (extended)", () => {
  beforeAll(() => {
    // Radix Select needs pointer-capture and scroll APIs jsdom lacks.
    Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
    Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
    Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
    Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
  });

  it("hides severity and auto-resolve when incidents are off", () => {
    render(<AlertSettings value={{ ...base, incidentEnabled: false }} />);
    expect(screen.getByLabelText("Open an incident when this alerts")).not.toBeChecked();
    expect(screen.queryByLabelText("Severity")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Resolve automatically on recovery/)).not.toBeInTheDocument();
  });

  it("changes incidentSeverity from the select and clears it for Auto", () => {
    const onChange = jest.fn();
    const view = render(<AlertSettings value={base} onChange={onChange} />);
    expect(screen.getByLabelText("Severity")).toHaveTextContent("Auto");
    fireEvent.keyDown(screen.getByLabelText("Severity"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "SEV2" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ incidentSeverity: "sev2" }));
    view.unmount();

    const again = jest.fn();
    render(<AlertSettings value={{ ...base, incidentSeverity: "sev1" }} onChange={again} />);
    fireEvent.keyDown(screen.getByLabelText("Severity"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Auto" }));
    expect(again).toHaveBeenCalledWith(expect.objectContaining({ incidentSeverity: undefined }));
  });

  it("job mode honours a stored alertOnSuccess=false and lets it be unchecked", () => {
    const onChange = jest.fn();
    render(<AlertSettings value={{ ...base, alertOnSuccess: false, alertOnRecovery: false }} context="job" onChange={onChange} />);
    expect(screen.getByLabelText(/Job success/)).not.toBeChecked();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ alertOnSuccess: true }));
    expect(screen.getByLabelText(/Resolve automatically on recovery/)).toBeDisabled();
  });

  it("job mode defaults success alerts on for a new job", () => {
    render(<AlertSettings value={base} context="job" />);
    expect(screen.getByLabelText(/Job success/)).toBeChecked();
  });

  it("enables auto-resolve in job mode when success alerts are on", () => {
    render(<AlertSettings value={{ ...base, alertOnSuccess: true, alertOnRecovery: false }} context="job" />);
    expect(screen.getByLabelText(/Resolve automatically on recovery/)).toBeEnabled();
    expect(screen.queryByText("Turn on recovery alerts to auto-resolve")).not.toBeInTheDocument();
  });

  it("keeps the other config keys intact when toggling", () => {
    const onChange = jest.fn();
    const value = { ...base, incidentSeverity: "sev3" as const, autoResolveIncident: true, failureThreshold: 4 };
    const view = render(<AlertSettings value={value} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Open an incident when this alerts"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ...value, incidentEnabled: false }));
    view.unmount();
    render(<AlertSettings value={value} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Resolve automatically on recovery/));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ ...value, autoResolveIncident: false }));
  });
});

describe("AlertSettings paging-only hint", () => {
  const providers = (rows: unknown[]) => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => rows }) as never;
  };

  it("warns when every chosen channel is a paging service", async () => {
    providers([{ id: "p1", name: "PD", type: "webhook", config: { preset: "pagerduty" } }]);
    render(<AlertSettings value={base} />);
    expect(await screen.findByTestId("paging-only-hint")).toHaveTextContent("Add an email or chat channel");
  });

  it("stays quiet when a chat channel is also chosen", async () => {
    providers([
      { id: "p1", name: "PD", type: "webhook", config: { preset: "pagerduty" } },
      { id: "p2", name: "Ops", type: "slack", config: {} },
    ]);
    render(<AlertSettings value={{ ...base, notificationProviders: ["p1", "p2"] }} />);
    await screen.findByText("slack");
    expect(screen.queryByTestId("paging-only-hint")).toBeNull();
  });
});

describe("AlertSettings warnings group (B24)", () => {
  it("lists the heartbeat warning kinds with the caption and help text", () => {
    render(<AlertSettings value={base} monitorType="heartbeat" />);
    const group = screen.getByTestId("alert-warnings-group");
    expect(group).toHaveTextContent("Warnings notify your channels. They never open an incident.");
    expect(screen.getByLabelText("Ping is late")).not.toBeChecked();
    expect(screen.getByRole("link", { name: "About warnings" })).toHaveAttribute(
      "href",
      "https://supercheck.io/docs/app/communicate/alerts#warnings",
    );
    expect(screen.getByLabelText("Ping is late")).toHaveAccessibleDescription(
      "Notify when a ping has not arrived on time but the grace period has not ended.",
    );
  });

  it("is hidden for monitor types without warning kinds and for jobs", () => {
    const { rerender } = render(<AlertSettings value={base} monitorType="http_request" />);
    expect(screen.queryByTestId("alert-warnings-group")).toBeNull();
    rerender(<AlertSettings value={base} context="job" monitorType="heartbeat" />);
    expect(screen.queryByTestId("alert-warnings-group")).toBeNull();
  });

  it("lists the MCP warnings on by default, and the AI endpoint warnings only for the preset", () => {
    const { rerender } = render(<AlertSettings value={base} monitorType="mcp_server" />);
    expect(screen.getByLabelText("Tools changed")).toBeChecked();
    expect(screen.getByLabelText("MCP slow")).toBeChecked();
    expect(screen.queryByLabelText("Model changed")).toBeNull();
    rerender(<AlertSettings value={{ ...base, warnings: { mcp_tools_changed: false } }} monitorType="mcp_server" />);
    expect(screen.getByLabelText("Tools changed")).not.toBeChecked();
    rerender(<AlertSettings value={base} monitorType="http_request" aiEndpoint />);
    for (const label of ["Slow first token", "Model changed", "Tokens high"]) expect(screen.getByLabelText(label)).toBeChecked();
    expect(screen.queryByLabelText("Tools changed")).toBeNull();
  });

  it("lists the agent warning only for a synthetic monitor on an agent test", () => {
    const { rerender } = render(<AlertSettings value={base} monitorType="synthetic_test" />);
    expect(screen.queryByTestId("alert-warning-agent_run_failed")).toBeNull();
    rerender(<AlertSettings value={base} monitorType="synthetic_test" agentTest />);
    expect(screen.getByTestId("alert-warning-agent_run_failed")).toBeChecked();
  });

  it("emits the toggled warning and keeps the other alert settings", () => {
    const onChange = jest.fn();
    render(<AlertSettings value={base} monitorType="heartbeat" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Ping is late"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ warnings: { heartbeat_late: true }, notificationProviders: ["p1"] }),
    );
  });

  it("shows a stored warning as checked and turns it off again", () => {
    const onChange = jest.fn();
    render(<AlertSettings value={{ ...base, warnings: { heartbeat_late: true } }} monitorType="heartbeat" onChange={onChange} />);
    expect(screen.getByLabelText("Ping is late")).toBeChecked();
    fireEvent.click(screen.getByLabelText("Ping is late"));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ warnings: { heartbeat_late: false } }));
  });

  it("hides thresholds for heartbeat (one missed run is one failure) and names the failure alert", () => {
    render(<AlertSettings value={base} monitorType="heartbeat" />);
    expect(screen.queryByText("Failure Threshold")).toBeNull();
    expect(screen.getByLabelText("Alert when a run is missed or fails")).toBeChecked();
  });

  it("keeps thresholds for other monitors", () => {
    render(<AlertSettings value={base} monitorType="website" />);
    expect(screen.getByText("Failure Threshold")).toBeInTheDocument();
    expect(screen.getByLabelText("Alert on failure")).toBeInTheDocument();
  });

  it("counts an enabled warning as an alert type, only for a type that has it", () => {
    const warningOnly = { ...base, alertOnFailure: false, alertOnRecovery: false, warnings: { heartbeat_late: true } };
    const { rerender } = render(<AlertSettings value={warningOnly} monitorType="heartbeat" />);
    expect(screen.queryByText("At least one alert type must be selected when alerts are enabled")).toBeNull();
    rerender(<AlertSettings value={{ ...warningOnly, warnings: { heartbeat_late: false } }} monitorType="heartbeat" />);
    expect(screen.getByText("At least one alert type must be selected when alerts are enabled")).toBeInTheDocument();
    rerender(<AlertSettings value={warningOnly} monitorType="http_request" />);
    expect(screen.getByText("At least one alert type must be selected when alerts are enabled")).toBeInTheDocument();
  });
});
