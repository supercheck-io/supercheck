import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocationsTable } from "./locations-table";
import { EditLocationDialog } from "./edit-location-dialog";

const mutateAsync = jest.fn();
const location = {
  id: "region-1", code: "us-east", name: "US East", region: "US",
  flag: null, coordinates: null, isEnabled: true, isDefault: true,
  supportsBrowser: false, supportsK6: false, sortOrder: 0,
  createdAt: new Date(), updatedAt: new Date(), workerCount: 0, status: "offline" as const,
};

jest.mock("@/hooks/use-locations", () => ({
  useAdminLocations: () => ({
    locations: [location], unregisteredLocations: [], isLoading: false, refetch: jest.fn(),
  }),
  useUpdateLocation: () => ({ mutateAsync, isPending: false }),
  useDeleteLocation: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));
jest.mock("./add-location-dialog", () => ({ AddLocationDialog: () => null }));

beforeEach(() => {
  mutateAsync.mockReset().mockResolvedValue({});
});

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

it("prevents disabling the default location from the table and explains how to change it", async () => {
  render(<LocationsTable />);
  const toggle = await screen.findByRole("switch", { name: "Enable US East" });
  expect(toggle).toBeDisabled();
  fireEvent.click(toggle);
  expect(mutateAsync).not.toHaveBeenCalled();
  fireEvent.focus(toggle.parentElement!);
  await waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent(/Edit/));
});

it("allows saving a legacy disabled default location by clearing its invalid default", async () => {
  render(<EditLocationDialog location={{ ...location, isEnabled: false }} open onOpenChange={jest.fn()} />);
  expect(screen.getByRole("switch", { name: "Default location" })).not.toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
    id: "region-1", isDefault: false,
  })));
});
