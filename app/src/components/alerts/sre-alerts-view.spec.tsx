import {
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
    expect(
      screen.getAllByRole("button", { name: "Create incident" }),
    ).toHaveLength(12);
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
    fireEvent.click(screen.getByRole("button", { name: "Create incident" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(
        "/incidents/018f0000-0000-7000-8000-000000000099",
      );
      expect(refresh).toHaveBeenCalled();
    });
  });
});
