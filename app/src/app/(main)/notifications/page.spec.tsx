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
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
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
