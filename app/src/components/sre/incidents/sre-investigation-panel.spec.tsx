import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
}));

import { SreInvestigationPanel } from "./sre-investigation-panel";

describe("SreInvestigationPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ summary: "Root cause summary updated" }),
    }) as unknown as typeof fetch;
  });

  it("renders a simplified investigation action panel without embedded chat", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        serviceMappingHref="/org-admin?tab=services"
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
          body: JSON.stringify({
            incidentId: "018f0000-0000-7000-8000-000000000001",
            useLiveConnectors: true,
          }),
        }),
      );
    });
  });

  it("links missing readiness requirements to the corrective workflow", () => {
    const incidentId = "018f0000-0000-7000-8000-000000000001";
    render(
      <SreInvestigationPanel
        incidentId={incidentId}
        hasPrimaryService={false}
        serviceMappingHref="/org-admin?tab=services"
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
});
