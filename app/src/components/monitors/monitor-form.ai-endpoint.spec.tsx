import React from "react";
import { render, screen } from "@testing-library/react";
import { MonitorForm } from "./monitor-form";

jest.mock("./location-config-section", () => ({ LocationConfigSection: () => null }));
jest.mock("@/components/shared/test-selector", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/alerts/alert-settings", () => ({ AlertSettings: () => null }));
jest.mock("./ai-endpoint-fields", () => ({
  ...jest.requireActual("./ai-endpoint-fields"),
  AiEndpointFields: () => <div data-testid="ai-endpoint-fields" />,
}));
const mockParams = new URLSearchParams("type=ai_endpoint");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useSearchParams: () => mockParams,
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: { id: "p1", userRole: "project_editor" } }) }));
jest.mock("@/hooks/use-app-config", () => ({ useAppConfig: () => ({ maxMonitorNotificationChannels: 5 }) }));
jest.mock("@/hooks/use-locations", () => ({ useAvailableLocations: () => ({ locations: [], isLoading: false }) }));
jest.mock("@/hooks/use-tests", () => ({ useTest: () => ({ data: undefined }) }));

describe("monitor form opened as ?type=ai_endpoint", () => {
  it("keeps the AI Endpoint defaults after the URL-type resets run", async () => {
    // The wizard passes the stored type; the URL carries the UI type.
    render(<MonitorForm hideAlerts monitorType="http_request" aiEndpoint />);
    expect(await screen.findByTestId("ai-endpoint-fields")).toBeInTheDocument();
    expect(screen.getByLabelText(/Target|URL/i)).toHaveValue("https://api.openai.com/v1/chat/completions");
    // No Preset select any more, and the plain HTTP fields stay hidden
    expect(screen.queryByTestId("monitor-preset")).toBeNull();
    expect(screen.queryByText("HTTP Method")).toBeNull();
  });
});
