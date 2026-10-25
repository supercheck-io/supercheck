import { fireEvent, render, screen, within } from "@testing-library/react";

import type { SreIncidentListItem } from "@/actions/sre-incidents";

import { SreIncidentsList } from "./sre-incidents-list";

// Radix/cmdk use browser layout APIs that jsdom does not provide.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView = jest.fn();
});

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

  it("shows the incident number in its own column and no per-row evidence summary", () => {
    render(<SreIncidentsList incidents={[incidentFixture(7)]} loadError={null} />);
    expect(screen.getByRole("columnheader", { name: /Incident ID/ })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Checkout incident 7/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells[0]).toHaveTextContent(/^#7$/);
    expect(cells[1]).toHaveTextContent(/^Checkout incident 7$/);
    expect(within(row).queryByText(/evidence item/)).not.toBeInTheDocument();
  });

  it("sorts by incident number from the Incident ID header", () => {
    render(
      <SreIncidentsList
        incidents={[incidentFixture(2), incidentFixture(3), incidentFixture(1)]}
        loadError={null}
      />,
    );
    const firstNumber = () =>
      within(screen.getAllByRole("row")[1]).getAllByRole("cell")[0].textContent;
    const header = screen.getByRole("button", { name: /Incident ID/ });
    fireEvent.click(header);
    expect(firstNumber()).toBe("#3");
    fireEvent.click(header);
    expect(firstNumber()).toBe("#1");
  });

  it("disables creation while permissions load and enables it when they resolve", () => {
    mockRole = "";
    mockProjectLoading = true;
    const { rerender } = render(
      <SreIncidentsList incidents={[]} loadError={null} />,
    );
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
    expect(screen.getByRole("status")).toHaveTextContent(
      "Permissions unavailable",
    );
    expect(
      screen.queryByRole("button", { name: /new incident/i }),
    ).not.toBeInTheDocument();
  });

  it("hides creation from viewers", () => {
    mockRole = "project_viewer";
    render(<SreIncidentsList incidents={[]} loadError={null} />);
    expect(
      screen.queryByRole("button", { name: /new incident/i }),
    ).not.toBeInTheDocument();
  });

  it("replaces the active shortcut when a specific status is selected", () => {
    render(
      <SreIncidentsList
        incidents={[incidentFixture(1), incidentFixture(2)]}
        loadError={null}
      />,
    );
    const actions = within(screen.getByTestId("incident-toolbar"));
    fireEvent.click(actions.getByRole("button", { name: /Status/ }));
    fireEvent.click(screen.getByRole("option", { name: "investigating" }));
    expect(screen.getByText("Total 1 incident")).toBeInTheDocument();
    expect(screen.getByText("Checkout incident 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Active incidents" }));
    expect(screen.getByText("Total 2 incidents")).toBeInTheDocument();
  });

  it("clears the active shortcut by toggling it and can restore it from a specific status", () => {
    render(
      <SreIncidentsList
        incidents={[
          incidentFixture(1),
          incidentFixture(2),
          incidentFixture(3, { status: "resolved" }),
        ]}
        loadError={null}
      />,
    );
    expect(screen.getByText("Total 2 incidents")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("incident-toolbar")).getByRole(
        "button",
        { name: /Status/ },
      ),
    );
    fireEvent.click(screen.getByRole("option", { name: "Active incidents" }));
    expect(screen.getByText("Total 3 incidents")).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Clear filters" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "resolved" }));
    expect(screen.getByText("Total 1 incident")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Active incidents" }));
    expect(screen.getByText("Total 2 incidents")).toBeInTheDocument();
    expect(
      screen.queryByText("Checkout incident 3"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Active incidents" }));
    expect(screen.getByText("Total 3 incidents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Active incidents" }));
    fireEvent.click(screen.getByRole("option", { name: "Clear filters" }));
    expect(screen.getByText("Total 3 incidents")).toBeInTheDocument();
  });

  it("combines faceted selections, retains active-by-default, and clears filters", () => {
    render(
      <SreIncidentsList
        incidents={[
          incidentFixture(1),
          incidentFixture(2),
          incidentFixture(3, { status: "resolved" }),
        ]}
        loadError={null}
      />,
    );
    expect(screen.getByText("Total 2 incidents")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("incident-toolbar")).getByRole(
        "button",
        { name: "Severity" },
      ),
    );
    fireEvent.click(screen.getByRole("option", { name: "SEV2" }));
    expect(screen.getByText("Total 1 incident")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "SEV3" }));
    expect(screen.getByText("Total 2 incidents")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "Clear filters" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(
      within(screen.getByTestId("incident-toolbar")).getByRole(
        "button",
        { name: "Service" },
      ),
    );
    fireEvent.click(screen.getByRole("option", { name: "No service linked" }));
    expect(screen.getByText("Checkout incident 1")).toBeInTheDocument();
    expect(
      screen.queryByText("Checkout incident 2"),
    ).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(
      within(screen.getByTestId("incident-toolbar")).getByRole(
        "button",
        { name: /Status/ },
      ),
    );
    fireEvent.click(screen.getByRole("option", { name: "Clear filters" }));
    expect(screen.getByText("Total 2 incidents")).toBeInTheDocument();
    expect(screen.getByText("Checkout incident 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "resolved" }));
    expect(screen.getByText("Total 1 incident")).toBeInTheDocument();
    expect(screen.getByText("Checkout incident 3")).toBeInTheDocument();
  });

  it("resets pagination when a facet changes", () => {
    render(
      <SreIncidentsList
        incidents={Array.from({ length: 13 }, (_, index) =>
          incidentFixture(index + 1),
        )}
        loadError={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByTestId("incident-toolbar")).getByRole(
        "button",
        { name: "Severity" },
      ),
    );
    fireEvent.click(screen.getByRole("option", { name: "SEV2" }));
    expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
    expect(screen.getByText("Total 6 incidents")).toBeInTheDocument();
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
      screen.queryByText("Checkout incident 14"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Rows per page")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    const headerActions = screen.getByTestId("incident-header-actions");
    const toolbar = screen.getByTestId("incident-toolbar");
    expect(
      within(toolbar).getByPlaceholderText("Search incidents..."),
    ).toBeInTheDocument();
    expect(
      within(toolbar).getByRole("button", { name: "Severity" }),
    ).toHaveClass("border-dashed");
    expect(
      within(toolbar).getByRole("button", { name: "Service" }),
    ).toHaveClass("border-dashed");
    expect(
      within(toolbar).getByRole("button", { name: /Status/ }),
    ).toHaveClass("border-dashed");
    expect(
      within(headerActions).getByRole("link", { name: /trends/i }),
    ).toBeInTheDocument();
    expect(
      within(headerActions).getByRole("button", { name: /new incident/i }),
    ).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(
      within(table).getByRole("columnheader", { name: /^Incident ID$/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /^Title$/ }),
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
    expect(screen.getByText("Checkout incident 13")).toBeInTheDocument();
    expect(
      screen.queryByText("Checkout incident 12"),
    ).not.toBeInTheDocument();
  });
});
