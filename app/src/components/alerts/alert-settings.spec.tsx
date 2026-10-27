import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { userRole: "project_admin" } }) }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ maxJobNotificationChannels: 5, maxMonitorNotificationChannels: 5 }) }));
jest.mock("@/components/ui/info-tip", () => ({ InfoTip: ({ label }: { label: string }) => <button aria-label={label} type="button" /> }));
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

  it("job mode forces success alerts on, so auto-resolve ignores alertOnRecovery", () => {
    // config normalisation sets alertOnSuccess=true for jobs, so the hint state is unreachable there.
    render(<AlertSettings value={{ ...base, alertOnSuccess: false, alertOnRecovery: false }} context="job" />);
    expect(screen.getByLabelText(/Resolve automatically on recovery/)).toBeEnabled();
    expect(screen.queryByText("Turn on recovery alerts to auto-resolve")).not.toBeInTheDocument();
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
