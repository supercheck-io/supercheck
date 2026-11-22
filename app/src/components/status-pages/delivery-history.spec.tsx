import { render, screen } from "@testing-library/react";
import { DeliveryHistory } from "./delivery-history";

const getDeliveries = jest.fn();
jest.mock("@/actions/status-page-deliveries", () => ({
  getStatusPageDeliveries: (...a: unknown[]) => getDeliveries(...a),
  retryStatusPageDelivery: jest.fn(),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const delivery = (status: string) => ({ id: status, incidentName: "Outage", mode: "email", status, attempts: 1, lastError: null });

it("shows the duplicate warning next to Retry when a delivery failed", async () => {
  getDeliveries.mockResolvedValue({ success: true, deliveries: [delivery("failed")] });
  render(<DeliveryHistory statusPageId="p1" />);
  expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  expect(screen.getByTestId("retry-duplicate-note")).toHaveTextContent("may receive a duplicate");
});

it("hides the warning when nothing can be retried", async () => {
  getDeliveries.mockResolvedValue({ success: true, deliveries: [delivery("sent")] });
  render(<DeliveryHistory statusPageId="p1" />);
  expect(await screen.findByText("Outage")).toBeInTheDocument();
  expect(screen.queryByTestId("retry-duplicate-note")).toBeNull();
});
