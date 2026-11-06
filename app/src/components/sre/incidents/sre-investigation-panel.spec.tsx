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
}));

import {
  createSreInvestigationReportSnapshot,
} from "@/actions/sre-investigation-reports";
import { DropdownMenu, DropdownMenuContent } from "@/components/ui/dropdown-menu";
import { SreInvestigationPanel, SreReportSnapshotMenuItem } from "./sre-investigation-panel";

// Live-source and note controls live in the run options popover.
const openOptions = () => fireEvent.click(screen.getByRole("button", { name: "Run options" }));

const mockCreateSnapshot = createSreInvestigationReportSnapshot as jest.Mock;

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
  });

  it("falls back to saved evidence if a previously selected live-source scope disappears", async () => {
    const props = { incidentId: "incident-1", hasPrimaryService: true, canInvestigate: true,
      canUseLiveConnectors: true, serviceMappingHref: "/incidents/incident-1?edit=service" };
    const { rerender } = render(<SreInvestigationPanel {...props} />);
    openOptions();
    fireEvent.click(screen.getByLabelText("Include live sources"));
    expect(screen.getByLabelText("Include live sources")).toBeChecked();
    rerender(<SreInvestigationPanel {...props} hasPrimaryService={false} />);
    expect(screen.getByLabelText("Include live sources")).not.toBeChecked();
    expect(screen.getByLabelText("Include live sources")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Run investigation" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/sre/investigate", expect.objectContaining({
      body: JSON.stringify({ incidentId: "incident-1", useLiveConnectors: false }),
    })));
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
    await waitFor(() => expect(mockInvalidateQueries).toHaveBeenCalledTimes(2));
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

    expect(screen.getByRole("button", { name: "Investigating..." })).toBeDisabled();
    // The Investigation tab's status line says it is running; the controls only mark themselves busy.
    expect(screen.getByTestId("investigation-controls")).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("renders the run button and options without embedded chat", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
        canInvestigate={true}
        canUseLiveConnectors={true}
      />,
    );

    expect(
      screen.getByRole("button", { name: /run investigation/i }),
    ).toBeInTheDocument();
    openOptions();
    expect(screen.getByLabelText("Include live sources")).toBeInTheDocument();
    // Tool counters and the saved-evidence hint are not part of the controls.
    expect(screen.queryByText("Investigation diagnostics")).not.toBeInTheDocument();
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
      />,
    );

    openOptions();
    fireEvent.click(screen.getByLabelText("Include live sources"));
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

  it("links optional live sources to their corrective workflow", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={false}
        serviceMappingHref="/org-admin?tab=services"
        canMapService={true}
        canUseLiveConnectors={true}
        canInvestigate={true}
      />,
    );

    openOptions();
    expect(screen.getByRole("link", { name: "Link service" })).toHaveAttribute(
      "href",
      "/org-admin?tab=services",
    );
  });

  it("does not render the result itself (the AI summary card owns it)", () => {
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

    expect(screen.queryByText("Latest result")).not.toBeInTheDocument();
    expect(screen.queryByText("Dependency latency is the leading hypothesis.")).not.toBeInTheDocument();
  });

  it("re-runs with the user's note as untrusted guidance", async () => {
    render(
      <SreInvestigationPanel
        incidentId="incident-1"
        hasPrimaryService={true}
        serviceMappingHref="/x"
        canInvestigate={true}
        latestInvestigation={{ id: "run-1", status: "completed", summary: "s", completedAt: "2026-06-24T12:00:00.000Z" }}
      />,
    );
    openOptions();
    const rerun = screen.getByRole("button", { name: "Re-run with my note" });
    expect(rerun).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Re-run with my note"), { target: { value: "check the CDN" } });
    fireEvent.click(rerun);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/sre/investigate",
        expect.objectContaining({
          body: JSON.stringify({ incidentId: "incident-1", useLiveConnectors: false, guidance: "check the CDN" }),
        }),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText("Re-run with my note")).toHaveValue(""));
  });

  it("saves a completed investigation snapshot from the overflow menu", async () => {
    const runId = "018f0000-0000-7000-8000-000000000009";
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <SreReportSnapshotMenuItem
            incidentId="018f0000-0000-7000-8000-000000000001"
            latestInvestigation={{ id: runId, status: "completed" }}
          />
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Save report snapshot" }));
    await waitFor(() =>
      expect(mockCreateSnapshot).toHaveBeenCalledWith({ investigationRunId: runId }),
    );
  });

  it("offers no snapshot item before an investigation completes", () => {
    render(
      <DropdownMenu open>
        <DropdownMenuContent>
          <SreReportSnapshotMenuItem incidentId="i" latestInvestigation={{ id: "r", status: "running" }} />
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.queryByRole("menuitem", { name: "Save report snapshot" })).not.toBeInTheDocument();
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
      screen.queryByLabelText("Include live sources"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Read-only access")).not.toBeInTheDocument();
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
    openOptions();
    expect(screen.getByLabelText("Include live sources")).toBeDisabled();
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
    openOptions();
    expect(
      screen.queryByLabelText("Include live sources"),
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
      screen.queryByLabelText("Include live sources"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Read-only access")).not.toBeInTheDocument();
  });
});
