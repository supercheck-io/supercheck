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
