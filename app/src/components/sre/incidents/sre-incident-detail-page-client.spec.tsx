import { render, screen } from "@testing-library/react";

let mockQuery: unknown;
jest.mock("@/hooks/use-sre", () => ({ useSreIncidentPageData: () => mockQuery }));
jest.mock("@/components/sre/incidents/sre-incident-detail-view", () => ({
  SreIncidentDetailView: ({ services }: { services: unknown[] }) => <div data-testid="view">{services.length} services</div>,
}));

import { SreIncidentDetailPageClient } from "./sre-incident-detail-page-client";

const incidentResult = { success: true, detail: { incident: { id: "i1" } } };

describe("SreIncidentDetailPageClient", () => {
  it("shows an inline error, still rendering the incident, when services fail to load", () => {
    mockQuery = { isPending: false, data: { incidentResult, servicesResult: { success: false, error: "boom" } } };
    render(<SreIncidentDetailPageClient incidentId="i1" initialTab="overview" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Services unavailable");
    expect(screen.getByTestId("view")).toBeInTheDocument();
  });

  it("shows no error when services load", () => {
    mockQuery = { isPending: false, data: { incidentResult, servicesResult: { success: true, services: [{ id: "s" }] } } };
    render(<SreIncidentDetailPageClient incidentId="i1" initialTab="overview" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByTestId("view")).toHaveTextContent("1 services");
  });
});
