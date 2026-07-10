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

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ projectId: "project-1" }),
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
  it("renders a compact sortable incident table with filters and pagination", () => {
    const incidents = Array.from({ length: 13 }, (_, index) =>
      incidentFixture(index + 1),
    );

    render(<SreIncidentsList incidents={incidents} loadError={null} />);

    expect(screen.getByText("Incidents")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Track, investigate, and resolve operational incidents.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Total 13 incidents")).toBeInTheDocument();
    expect(screen.getByText("Rows per page")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();

    const headerActions = screen.getByTestId("incident-header-actions");
    expect(
      within(headerActions).getByPlaceholderText(
        "Filter by all available fields...",
      ),
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
      within(table).getByRole("columnheader", { name: /^ID$/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /^Incident$/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /Investigation/ }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("columnheader", { name: /Evidence/ }),
    ).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(13);
    expect(within(table).getAllByRole("row")[1]).not.toHaveClass("h-[72px]");

    fireEvent.change(
      screen.getByPlaceholderText("Filter by all available fields..."),
      {
        target: { value: "Checkout incident 13" },
      },
    );

    expect(screen.getByText("Total 1 incidents")).toBeInTheDocument();
    expect(screen.getByText("Checkout incident 13")).toBeInTheDocument();
    expect(screen.queryByText("Checkout incident 12")).not.toBeInTheDocument();
  });
});
