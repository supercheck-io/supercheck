import { startTransition } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { createSreIncidentFromAlert } from "@/actions/sre-incidents";
import type { AlertHistory } from "@/components/alerts/schema";

import { SreAlertsView } from "./sre-alerts-view";

const push = jest.fn();
const refresh = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

jest.mock("@/actions/sre-incidents", () => ({
  createSreIncidentFromAlert: jest.fn(),
}));

let mockRole = "project_editor";
let mockProjectLoading = false;
let mockProjectError: string | null = null;
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ currentProject: { userRole: mockRole }, loading: mockProjectLoading, error: mockProjectError }),
}));

function alertFixture(
  index: number,
  overrides: Partial<AlertHistory> = {},
): AlertHistory {
  return {
    id: `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    targetType: "job",
    targetId: `job-${index}`,
    targetName: `Checkout Job ${index}`,
    type: "job_failed",
    message: `Job "Checkout Job ${index}" has failed.`,
    status: "sent",
    timestamp: new Date(
      `2026-07-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    ).toISOString(),
    notificationProvider: "email",
    ...overrides,
  };
}

describe("SreAlertsView", () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockRole = "project_editor";
    mockProjectLoading = false;
    mockProjectError = null;
    push.mockReset();
  });

  it("hydrates the loading snapshot even when the browser cache already has alerts", async () => {
    const container = document.createElement("div");
    container.innerHTML = renderToString(<SreAlertsView alerts={[]} isLoading />);
    document.body.appendChild(container);
    const recoverableError = jest.fn();
    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(container, <SreAlertsView alerts={[alertFixture(1)]} isLoading />, {
          onRecoverableError: recoverableError,
        });
      });
      expect(within(container).getByRole("heading", { name: "Alert signals" })).toBeInTheDocument();
      expect(recoverableError).not.toHaveBeenCalled();
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it("excludes notification delivery failures from signals and paginates results", () => {
    const alerts = [
      ...Array.from({ length: 13 }, (_, index) => alertFixture(index + 1)),
      alertFixture(20, {
        targetName: "Notification failure should stay in history",
        status: "failed",
        type: "job_failed",
        message: "Email notification delivery failed.",
      }),
      alertFixture(21, {
        targetName: "Successful job should stay in history",
        type: "job_success",
        message: "Job completed successfully.",
      }),
    ];

    render(<SreAlertsView alerts={alerts} isLoading={false} />);

    expect(screen.getByText("Alert signals")).toBeInTheDocument();
    expect(screen.getByText("Total 13 signals")).toBeInTheDocument();
    expect(screen.getByText("Rows per page")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Investigate" })).toHaveLength(
      12,
    );
    expect(
      screen.queryByText("Notification failure should stay in history"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Successful job should stay in history"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("table")).getAllByRole("row")[1],
    ).not.toHaveClass("h-[72px]");
  });

  it("opens the incident after promoting an alert signal", async () => {
    jest.mocked(createSreIncidentFromAlert).mockResolvedValue({
      success: true,
      incident: {
        id: "018f0000-0000-7000-8000-000000000099",
        incidentNumber: 42,
        title: "Checkout Job 1: Job Failed",
      },
      existing: false,
      message: "Incident #42 created",
    });

    render(<SreAlertsView alerts={[alertFixture(1)]} isLoading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        "/incidents/018f0000-0000-7000-8000-000000000099",
      );
      expect(refresh).toHaveBeenCalled();
    });
  });
  it("groups repeated deliveries and investigates the newest alert regardless of input order", async () => {
    jest
      .mocked(createSreIncidentFromAlert)
      .mockResolvedValue({
        success: true,
        incident: {
          id: "incident-42",
          incidentNumber: 42,
          title: "Checkout failed",
        },
        existing: true,
        message: "Existing incident opened",
      });
    const alerts = [
      alertFixture(3, { targetId: "shared-job" }),
      alertFixture(1, { targetId: "shared-job" }),
      alertFixture(2, { targetId: "shared-job" }),
    ];
    render(<SreAlertsView alerts={alerts} isLoading={false} />);
    expect(screen.getByText("Total 1 signal")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Investigate" })).toHaveLength(
      1,
    );
    expect(
      within(screen.getByRole("table")).getByText("3"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    await waitFor(() =>
      expect(createSreIncidentFromAlert).toHaveBeenCalledWith({
        alertHistoryId: alerts[0].id,
      }),
    );
    expect(push).toHaveBeenCalledWith("/incidents/incident-42");
  });

  it("keeps different targets separate and hides creation from viewers", () => {
    mockRole = "project_viewer";
    render(
      <SreAlertsView
        alerts={[alertFixture(1), alertFixture(2)]}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Total 2 signals")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Investigate" }),
    ).not.toBeInTheDocument();
  });

  it("does not label a project read-only while its permissions load", () => {
    mockRole = "";
    mockProjectLoading = true;
    render(<SreAlertsView alerts={[alertFixture(1)]} isLoading={false} />);
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Investigate" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(createSreIncidentFromAlert).not.toHaveBeenCalled();
  });

  it("explains permission failures without labeling the project read-only", () => {
    mockProjectError = "Project fetch failed";
    render(<SreAlertsView alerts={[alertFixture(1)]} isLoading={false} />);
    expect(screen.getByText("Permissions unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Read-only")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Investigate" })).not.toBeInTheDocument();
  });

  it("keeps an incident badge when a newer duplicate delivery replaces the row", async () => {
    jest.mocked(createSreIncidentFromAlert).mockResolvedValue({
      success: true, incident: { id: "incident-42", incidentNumber: 42, title: "Checkout failed" },
      existing: true, message: "Existing incident opened",
    });
    const older = alertFixture(1, { targetId: "shared-job" });
    const { rerender } = render(<SreAlertsView alerts={[older]} isLoading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    expect(await screen.findByText("Incident #42")).toBeInTheDocument();
    rerender(<SreAlertsView alerts={[older, alertFixture(2, { targetId: "shared-job" })]} isLoading={false} />);
    expect(screen.getByText("Incident #42")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Investigate" })).not.toBeInTheDocument();
  });

  it.each(["denied", "disconnected"])("allows retry after incident creation is %s", async (failure) => {
    if (failure === "denied") {
      jest.mocked(createSreIncidentFromAlert).mockResolvedValue({ success: false, error: "Access denied" });
    } else {
      jest.mocked(createSreIncidentFromAlert).mockRejectedValue(new Error("Disconnected"));
    }
    render(<SreAlertsView alerts={[alertFixture(1)]} isLoading={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Investigate" })).toBeEnabled());
    expect(screen.queryByRole("button", { name: "Opening..." })).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("keeps Opening on the triggering row until the routing transition finishes", async () => {
    let finishNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => { finishNavigation = resolve; });
    push.mockImplementation(() => startTransition(async () => { await navigation; }));
    jest.mocked(createSreIncidentFromAlert).mockResolvedValue({
      success: true, incident: { id: "incident-42", incidentNumber: 42, title: "Checkout failed" },
      existing: true, message: "Existing incident opened",
    });
    render(<SreAlertsView alerts={[alertFixture(1), alertFixture(2)]} isLoading={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Investigate" })[0]);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Opening..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Investigate" })).toBeDisabled();
    expect(screen.queryByText("Incident #42")).not.toBeInTheDocument();
    await act(async () => { finishNavigation(); });
    expect(await screen.findByText("Incident #42")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Investigate" })).toBeEnabled();
  });
});
