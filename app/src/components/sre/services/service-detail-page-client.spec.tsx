import { fireEvent, render, screen } from "@testing-library/react";

let mockQuery: unknown;
jest.mock("@/hooks/use-sre", () => ({ useSreServiceDetail: () => mockQuery }));
jest.mock("@/components/sre/services/service-detail-view", () => ({
  ServiceDetailView: () => <div data-testid="view" />,
}));

import { ServiceDetailPageClient } from "./service-detail-page-client";

describe("ServiceDetailPageClient", () => {
  it("renders the service when it loads", () => {
    mockQuery = { isPending: false, data: { success: true, detail: {} } };
    render(<ServiceDetailPageClient serviceId="s1" />);
    expect(screen.getByTestId("view")).toBeInTheDocument();
  });

  it("shows a not-found page, linking back to services, when the service does not exist", () => {
    mockQuery = { isPending: false, isFetching: false, refetch: jest.fn(), data: { success: false, error: "Service not found or access denied" } };
    render(<ServiceDetailPageClient serviceId="s1" />);
    expect(screen.getByRole("heading", { name: "This service could not be found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to services" })).toHaveAttribute("href", "/services");
  });

  it("offers a retry when loading failed", () => {
    const refetch = jest.fn();
    mockQuery = { isPending: false, isFetching: false, refetch, data: undefined, error: new Error("Failed to fetch") };
    render(<ServiceDetailPageClient serviceId="s1" />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalled();
  });
});
