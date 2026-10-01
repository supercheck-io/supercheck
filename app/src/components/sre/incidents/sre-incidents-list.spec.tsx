import { fireEvent, render, screen, within } from "@testing-library/react";

import type { SreIncidentListItem } from "@/actions/sre-incidents";

import { SreIncidentsList } from "./sre-incidents-list";

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    refresh: jest.fn(),
  }),
}));

jest.mock("@/actions/sre-incidents", () => ({
  createManualSreIncident: jest.fn(),
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: jest.fn().mockResolvedValue(undefined),
  }),
}));

let mockRole = "project_editor";
let mockProjectLoading = false;
let mockProjectError: string | null = null;
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({
    projectId: "project-1",
    currentProject: { userRole: mockRole },
    loading: mockProjectLoading,
    error: mockProjectError,
  }),
}));

function incidentFixture(
  index: number,
  overrides: Partial<SreIncidentListItem> = {},
): SreIncidentListItem {
  return {
    id: `018f0000-0000-7000-8000-${String(index).padStart(12, "0")}`,
    incidentNumber: index,
    title: `Checkout incident ${index}`,
    severity: index % 2 === 0 ? "sev2" : "sev3",
    status: index % 2 === 0 ? "investigating" : "triggered",
    primaryServiceId:
      index % 2 === 0
        ? `018f0000-0000-7000-8001-${String(index).padStart(12, "0")}`
        : null,
    primaryServiceName: index % 2 === 0 ? "checkout-api" : null,
    alertCount: index,
    evidenceCount: index + 1,
    investigationCount: index % 2 === 0 ? 1 : 0,
    latestInvestigationStatus: index % 2 === 0 ? "completed" : null,
    latestInvestigationCompletedAt:
      index % 2 === 0
        ? new Date(
            `2026-07-03T${String(index % 24).padStart(2, "0")}:30:00.000Z`,
          )
        : null,
    latestInvestigationCreatedAt:
      index % 2 === 0
        ? new Date(
            `2026-07-03T${String(index % 24).padStart(2, "0")}:10:00.000Z`,
          )
        : null,
    createdAt: new Date(
      `2026-07-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    ),
    updatedAt: new Date(
      `2026-07-03T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    ),
    resolvedAt: null,
    ...overrides,
  };
}

describe("SreIncidentsList", () => {
  afterEach(() => {
    mockRole = "project_editor";
    mockProjectLoading = false;
    mockProjectError = null;
  });

  it("disables creation while permissions load and enables it when they resolve", () => {
    mockRole = "";
    mockProjectLoading = true;
    const { rerender } = render(<SreIncidentsList incidents={[]} loadError={null} />);
    const button = screen.getByRole("button", { name: /new incident/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    mockRole = "project_editor";
    mockProjectLoading = false;
    rerender(<SreIncidentsList incidents={[]} loadError={null} />);
    expect(screen.getByRole("button", { name: /new incident/i })).toBeEnabled();
  });

  it("explains permission failures and keeps creation unavailable", () => {
    mockProjectError = "Project fetch failed";
    render(<SreIncidentsList incidents={[]} loadError={null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Permissions unavailable");
    expect(screen.queryByRole("button", { name: /new incident/i })).not.toBeInTheDocument();
  });

  it("hides creation from viewers", () => {
    mockRole = "project_viewer";
    render(<SreIncidentsList incidents={[]} loadError={null} />);
    expect(screen.queryByRole("button", { name: /new incident/i })).not.toBeInTheDocument();
  });

  it("renders a compact sortable incident table with filters and pagination", () => {
    const incidents = [
      ...Array.from({ length: 13 }, (_, index) => incidentFixture(index + 1)),
      incidentFixture(14, { status: "resolved" }),
    ];

    render(<SreIncidentsList incidents={incidents} loadError={null} />);

    expect(screen.getByText("Incidents")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Track, investigate, and resolve operational incidents.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Total 13 incidents")).toBeInTheDocument();
    expect(
      screen.queryByText("#14 · Checkout incident 14"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Rows per page")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    const headerActions = screen.getByTestId("incident-header-actions");
    expect(
      within(headerActions).getByPlaceholderText("Search incidents..."),
    ).toBeInTheDocument();
    expect(within(headerActions).getAllByRole("combobox")).toHaveLength(2);
    expect(
      within(headerActions).getByRole("link", { name: /trends/i }),
    ).toBeInTheDocument();
    expect(
      within(headerActions).getByRole("button", { name: /new incident/i }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(
      within(table).queryByRole("columnheader", { name: /^ID$/ }),
    ).not.toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /^Incident$/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /Investigation/ }),
    ).toBeInTheDocument();
    expect(
      within(table).queryByRole("columnheader", { name: /Evidence/ }),
    ).not.toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(within(table).getAllByRole("row")[1]).not.toHaveClass("h-[72px]");

    fireEvent.change(screen.getByPlaceholderText("Search incidents..."), {
      target: { value: "Checkout incident 13" },
    });

    expect(screen.getByText("Total 1 incident")).toBeInTheDocument();
    expect(screen.getByText("#13 · Checkout incident 13")).toBeInTheDocument();
    expect(
      screen.queryByText("#12 · Checkout incident 12"),
    ).not.toBeInTheDocument();
  });
});
