import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MonitorForm } from "./monitor-form";

let testType = "agent";
const alertProps: { current?: { value: { failureThreshold: number; incidentSeverity?: string }; agentTest: boolean; onChange: (c: unknown) => void } } = {};

jest.mock("./location-config-section", () => ({ LocationConfigSection: () => null }));
jest.mock("@/components/shared/test-selector", () => ({
  __esModule: true,
  default: ({ onTestsSelected }: { onTestsSelected: (t: unknown[]) => void }) => (
    <button type="button" onClick={() => onTestsSelected([{ id: "t1", name: "Bot", type: testType }])}>
      pick test
    </button>
  ),
}));
jest.mock("@/components/alerts/alert-settings", () => ({
  AlertSettings: (props: never) => {
    alertProps.current = props;
    return <div data-testid="alert-settings" />;
  },
}));
const mockParams = new URLSearchParams("type=synthetic_test&tab=alerts");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => mockParams,
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p1", userRole: "project_editor" } }) }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ maxMonitorNotificationChannels: 5 }) }));
jest.mock("@/hooks/use-locations", () => ({ useAvailableLocations: () => ({ locations: [], isLoading: false }) }));
jest.mock("@/hooks/use-tests", () => ({
  useTest: (id: string | null) => ({ data: id ? { id, title: "Bot", name: "Bot", type: testType, tags: [] } : undefined }),
}));

const props = { hideAlerts: false, monitorType: "synthetic_test" as const };
// A new monitor reaches the alert step after the first form submit.
async function openAlertsOnCreate() {
  render(<MonitorForm {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "pick test" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Bot check" } });
  fireEvent.click(screen.getByRole("button", { name: /Create|Next/ }));
  await screen.findByTestId("alert-settings");
}

describe("monitor form on an agent test", () => {
  beforeEach(() => {
    alertProps.current = undefined;
  });

  it("defaults a new monitor to 3 failures and sev3 and shows the agent warning", async () => {
    await openAlertsOnCreate();
    expect(alertProps.current?.agentTest).toBe(true);
    expect(alertProps.current?.value).toMatchObject({ failureThreshold: 3, incidentSeverity: "sev3" });
  });

  it("keeps other test types at their normal defaults", async () => {
    testType = "browser";
    await openAlertsOnCreate();
    expect(alertProps.current?.agentTest).toBe(false);
    expect(alertProps.current?.value.failureThreshold).toBe(1);
    expect(alertProps.current?.value.incidentSeverity).toBeUndefined();
    testType = "agent";
  });

  it("leaves a stored monitor untouched on edit", async () => {
    render(<MonitorForm {...props} editMode id="m1" initialData={{ type: "synthetic_test", syntheticConfig_testId: "t1" } as never} alertConfig={{ enabled: true, failureThreshold: 1 } as never} />);
    fireEvent.click(screen.getByRole("button", { name: /Configure Alerts/ }));
    await screen.findByTestId("alert-settings");
    expect(alertProps.current?.value.failureThreshold).toBe(1);
    expect(alertProps.current?.value.incidentSeverity).toBeUndefined();
  });
});
