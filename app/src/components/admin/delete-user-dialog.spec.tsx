import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { DeleteUserDialog } from "./delete-user-dialog";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const onSuccess = jest.fn();
const onOpenChange = jest.fn();
const fetchMock = jest.fn();

function respond(...bodies: Array<unknown | "not-json">) {
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      json: body === "not-json" ? async () => { throw new SyntaxError("Unexpected token <"); } : async () => body,
    });
  }
}

const orgList = (orgs: Array<{ organizationId: string; organizationName: string; isOnlyMember: boolean; hasActiveSubscription: boolean }>) => ({ success: true, organizations: orgs });

function renderDialog() {
  render(<DeleteUserDialog open onOpenChange={onOpenChange} userId="u1" userName="Ada" userEmail="ada@example.test" onSuccess={onSuccess} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("lists only sole-member organizations, notes cancelled subscriptions and confirms that exact set", async () => {
  respond(
    orgList([
      { organizationId: "o1", organizationName: "Solo Inc", isOnlyMember: true, hasActiveSubscription: true },
      { organizationId: "o2", organizationName: "Shared Co", isOnlyMember: false, hasActiveSubscription: false },
    ]),
    { success: true },
  );
  renderDialog();
  expect(await screen.findByText(/Solo Inc/)).toHaveTextContent("subscription will be cancelled");
  expect(screen.queryByText(/Shared Co/)).toBeNull();

  const button = screen.getByRole("button", { name: "Delete user and 1 organization" });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Type the user/), { target: { value: "ADA@example.test" } });
  fireEvent.click(button);

  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ confirmDeleteOrganizationIds: ["o1"] });
});

it("shows the server's current list and asks again when memberships changed", async () => {
  respond(
    orgList([]),
    { success: false, code: "confirm_organization_deletion", organizations: [{ id: "o3", name: "New Solo", hasActiveSubscription: false }] },
  );
  renderDialog();
  fireEvent.change(await screen.findByLabelText(/Type the user/), { target: { value: "ada@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete user" }));
  expect(await screen.findByText("New Solo")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete user and 1 organization" })).toBeDisabled();
  expect(onSuccess).not.toHaveBeenCalled();
});

it("explains a non-JSON response (proxy timeout) instead of a generic failure", async () => {
  respond(orgList([]), "not-json");
  renderDialog();
  fireEvent.change(await screen.findByLabelText(/Type the user/), { target: { value: "ada@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete user" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("may still be running")));
  expect(onSuccess).not.toHaveBeenCalled();
});
