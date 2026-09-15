import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockInvalidateQueries = jest.fn().mockResolvedValue(undefined);

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
}));

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
}));

jest.mock("@/actions/sre-investigation-reports", () => ({
  createSreInvestigationReportSnapshot: jest.fn(),
  saveSreInvestigationReportFeedback: jest.fn(),
}));

import {
  createSreInvestigationReportSnapshot,
  saveSreInvestigationReportFeedback,
} from "@/actions/sre-investigation-reports";
import { SreInvestigationPanel } from "./sre-investigation-panel";

const mockCreateSnapshot = createSreInvestigationReportSnapshot as jest.Mock;
const mockSaveFeedback = saveSreInvestigationReportFeedback as jest.Mock;

describe("SreInvestigationPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ summary: "Root cause summary updated" }),
    }) as unknown as typeof fetch;
    mockCreateSnapshot.mockResolvedValue({
      success: true,
      snapshotId: "018f0000-0000-7000-8000-000000000010",
      createdAt: "2026-06-24T12:00:00.000Z",
      reused: false,
    });
    mockSaveFeedback.mockResolvedValue({ success: true });
  });

  it("shows an actionable connection error and refreshes server state", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    render(
      <SreInvestigationPanel
        incidentId="incident-1"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin"
        canInvestigate={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run investigation" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "may still be running",
    );
    await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalledTimes(3));
  });

  it("disables another run when the server reports an active investigation", () => {
    render(
      <SreInvestigationPanel
        incidentId="incident-1"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin"
        canInvestigate={true}
        latestInvestigation={{
          id: "run-1",
          status: "running",
          summary: null,
          completedAt: null,
        }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Run investigation" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Investigation in progress",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders a simplified investigation action panel without embedded chat", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        canUseLiveConnectors={true}
        evidenceReferences={[
          {
            id: "ev-monitor-timeout",
            title: "Monitor timeout",
            evidenceType: "event",
          },
        ]}
        toolMetrics={{ total: 3, errors: 1, averageDurationMs: 240 }}
      />,
    );

    expect(screen.getByText("Investigation")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /run investigation/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Use live connector tools"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stored evidence")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
    expect(screen.getByText("240 ms")).toBeInTheDocument();
    expect(screen.queryByText("Conversation")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Optional context attachment"),
    ).not.toBeInTheDocument();
  });

  it("runs the investigation with the selected connector setting", async () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        canUseLiveConnectors={true}
        evidenceReferences={[
          {
            id: "ev-monitor-timeout",
            title: "Monitor timeout",
            evidenceType: "event",
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Use live connector tools"));
    fireEvent.click(screen.getByRole("button", { name: /run investigation/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/sre/investigate",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "x-project-id": "project-1" }),
          body: JSON.stringify({
            incidentId: "018f0000-0000-7000-8000-000000000001",
            useLiveConnectors: true,
          }),
        }),
      );
    });
  });

  it("treats HTTP 202 as an accepted start, not a completed result", async () => {
    const { toast } = jest.requireMock("sonner") as {
      toast: { success: jest.Mock };
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 202,
      json: async () => ({
        success: true,
        accepted: true,
        investigationRunId: "run-1",
      }),
    });

    render(
      <SreInvestigationPanel
        incidentId="incident-1"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin"
        canInvestigate={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Run investigation" }));

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Investigation started",
        expect.objectContaining({
          description: expect.stringMatching(/when the run completes/i),
        }),
      ),
    );
    expect(toast.success).not.toHaveBeenCalledWith(
      "Investigation completed",
      expect.anything(),
    );
  });

  it("links missing readiness requirements to the corrective workflow", () => {
    const incidentId = "018f0000-0000-7000-8000-000000000001";
    render(
      <SreInvestigationPanel
        incidentId={incidentId}
        hasPrimaryService={false}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        evidenceReferences={[]}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Generate brief" }),
    ).toHaveAttribute("href", `/incidents/${incidentId}?tab=brief`);
    expect(screen.getByRole("link", { name: "Map service" })).toHaveAttribute(
      "href",
      "/org-admin?tab=services",
    );
  });

  it("renders the latest investigation result persistently", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        latestInvestigation={{
          id: "018f0000-0000-7000-8000-000000000009",
          status: "completed",
          summary: "Dependency latency is the leading hypothesis.",
          completedAt: "2026-06-24T12:00:00.000Z",
        }}
      />,
    );

    expect(screen.getByText("Latest result")).toBeInTheDocument();
    expect(
      screen.getByText("Dependency latency is the leading hypothesis."),
    ).toBeInTheDocument();
  });

  it("saves a completed investigation snapshot and then feedback", async () => {
    const runId = "018f0000-0000-7000-8000-000000000009";
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        latestInvestigation={{
          id: runId,
          status: "completed",
          summary: "Dependency latency is the leading hypothesis.",
          completedAt: "2026-06-24T12:00:00.000Z",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Save report snapshot" }),
    );
    await waitFor(() =>
      expect(mockCreateSnapshot).toHaveBeenCalledWith({
        investigationRunId: runId,
      }),
    );

    fireEvent.change(screen.getByLabelText("Notes (optional)"), {
      target: { value: "Validated against the deployment timeline." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save feedback" }));
    await waitFor(() =>
      expect(mockSaveFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          reportSnapshotId: "018f0000-0000-7000-8000-000000000010",
          notes: "Validated against the deployment timeline.",
        }),
      ),
    );
  });

  it("does not expose snapshot mutation controls to viewers", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={false}
        latestInvestigation={{
          id: "018f0000-0000-7000-8000-000000000009",
          status: "completed",
          summary: "Dependency latency is the leading hypothesis.",
          completedAt: "2026-06-24T12:00:00.000Z",
        }}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Save report snapshot" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Run investigation" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Use live connector tools"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Read-only access")).toBeInTheDocument();
  });

  it("shows a persistent disabled state when investigation is not enabled", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        canUseLiveConnectors={true}
        investigationEnabled={false}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "Investigation is unavailable",
    );
    expect(
      screen.getByRole("button", { name: "Run investigation" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Use live connector tools")).toBeDisabled();
  });

  it("keeps investigation available without exposing live sources when connector permission is missing", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        canUseLiveConnectors={false}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Run investigation" }),
    ).toBeEnabled();
    expect(
      screen.queryByLabelText("Use live connector tools"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/role does not permit live connector queries/i),
    ).toBeInTheDocument();
  });

  it("hides mutation controls when permission props are omitted", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
      />,
    );

    expect(
      screen.queryByRole("button", { name: /run investigation/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Use live connector tools"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Read-only access")).toBeInTheDocument();
  });

  it("enforces the ten-item rejected hypothesis limit before submission", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        latestInvestigation={{
          id: "018f0000-0000-7000-8000-000000000009",
          status: "completed",
          summary: "Dependency latency is the leading hypothesis.",
          completedAt: "2026-06-24T12:00:00.000Z",
        }}
        latestReportSnapshot={{
          id: "018f0000-0000-7000-8000-000000000010",
          title: "Investigation report",
          createdAt: "2026-06-24T12:00:00.000Z",
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText(/Rejected hypotheses/), {
      target: {
        value: Array.from(
          { length: 11 },
          (_, index) => `Hypothesis ${index + 1}`,
        ).join("\n"),
      },
    });

    expect(screen.getByText(/11 of 10 hypotheses/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save feedback" }),
    ).toBeDisabled();
  });
});
