import { fireEvent, render, screen } from "@testing-library/react";
import NotificationsPage from "./page";

const useProvidersMock = jest.fn();
jest.mock("@/hooks/use-alerts", () => ({
  useNotificationProviders: () => useProvidersMock(),
  useNotificationProviderMutations: () => ({
    createProvider: { mutateAsync: jest.fn() },
    updateProvider: { mutateAsync: jest.fn() },
    deleteProvider: { mutateAsync: jest.fn() },
  }),
}));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ currentProject: null }) }));
const mockReplace = jest.fn();
let mockParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: mockReplace }),
  useSearchParams: () => mockParams,
}));
jest.mock("@/components/alerts/delivery-history", () => ({ DeliveryHistory: () => <div>delivery-history</div> }));
jest.mock("@/components/page-breadcrumbs", () => ({ PageBreadcrumbs: () => null }));
jest.mock("@/components/alerts/notification-provider-form", () => ({ NotificationProviderForm: () => null }));
jest.mock("@/components/alerts/notification-channels-component", () => ({ NotificationChannelsComponent: () => null }));

it("shows an error with Retry instead of 'No notification channels' when the load fails", () => {
  const refetch = jest.fn();
  useProvidersMock.mockReturnValue({ providers: [], isLoading: false, error: new Error("boom"), refetch });
  render(<NotificationsPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("boom");
  expect(screen.queryByText("No notification channels")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(refetch).toHaveBeenCalled();
});

it("opens Delivery history from ?tab=history and switches tabs through the URL", () => {
  mockParams = new URLSearchParams("tab=history");
  useProvidersMock.mockReturnValue({ providers: [], isLoading: false, error: null, refetch: jest.fn() });
  render(<NotificationsPage />);
  expect(screen.getByText("delivery-history")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Create channel/ })).toBeNull();
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Channels" }));
  expect(mockReplace).toHaveBeenCalledWith("/notifications", { scroll: false });
  mockParams = new URLSearchParams();
});
