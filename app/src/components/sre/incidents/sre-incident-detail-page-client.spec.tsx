import { fireEvent, render, screen } from "@testing-library/react";

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

  it("replaces the page with an error state, and retries, when the incident cannot load", () => {
    const refetch = jest.fn();
    mockQuery = { isPending: false, isFetching: false, refetch, data: { incidentResult: { success: false, error: "Failed to fetch SRE incident" }, servicesResult: { success: true, services: [] } } };
    render(<SreIncidentDetailPageClient incidentId="i1" initialTab="overview" />);
    expect(screen.getByRole("heading", { name: "Could not load this incident" })).toBeInTheDocument();
    expect(screen.queryByTestId("view")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("says when the incident does not exist", () => {
    mockQuery = { isPending: false, isFetching: false, refetch: jest.fn(), data: { incidentResult: { success: false, error: "Incident not found or access denied" }, servicesResult: { success: true, services: [] } } };
    render(<SreIncidentDetailPageClient incidentId="i1" initialTab="overview" />);
    expect(screen.getByRole("heading", { name: "This incident could not be found" })).toBeInTheDocument();
  });

  it("shows the error state when the request itself throws", () => {
    mockQuery = { isPending: false, isFetching: false, refetch: jest.fn(), data: undefined, error: new Error("Network down") };
    render(<SreIncidentDetailPageClient incidentId="i1" initialTab="overview" />);
    expect(screen.getByText("Network down")).toBeInTheDocument();
  });
});
