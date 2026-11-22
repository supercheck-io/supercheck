import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ComponentFormDialog } from "./component-form-dialog";
import { updateComponent } from "@/actions/update-component";

jest.mock("@/actions/sre-services", () => ({ getSreServices: jest.fn(async () => ({ success: true, services: [] })) }));
jest.mock("@/actions/create-component", () => ({ createComponent: jest.fn() }));
jest.mock("@/actions/update-component", () => ({ updateComponent: jest.fn(async () => ({ success: true })) }));

const monitors = [{ id: "m1", name: "API check", type: "http_request" }];
const component = {
  id: "c1", name: "API", description: null, status: "operational" as const, monitorId: null, monitorIds: ["m1"],
  monitors: [{ id: "m1", weight: 1 }], showcase: true, onlyShowIfDegraded: false, position: 0,
  automateStatus: false, autoCreateIncidents: true,
};
const renderForm = (overrides = {}) =>
  render(<ComponentFormDialog open onOpenChange={() => {}} statusPageId="p1" component={{ ...component, ...overrides }} monitors={monitors} onSuccess={() => {}} />);

it("keeps a component with linked monitors manual until automatic status is turned on", async () => {
  renderForm();
  const toggle = screen.getByRole("switch", { name: /update status from monitors/i });
  expect(toggle).toHaveAttribute("data-state", "unchecked");
  expect(screen.queryByLabelText(/publish outage and recovery incidents/i)).not.toBeInTheDocument();
  expect(screen.getByText(/set by you and by the incidents you post/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /update component/i }));
  // Automatic incidents depend on automatic status, so a stored true is cleared while it is off.
  await waitFor(() => expect(updateComponent).toHaveBeenCalledWith(expect.objectContaining({ automateStatus: false, autoCreateIncidents: false })));
});

it("shows aggregation and automatic incidents once the owner opts in", async () => {
  renderForm();
  fireEvent.click(screen.getByRole("switch", { name: /update status from monitors/i }));
  expect(screen.getByLabelText(/publish outage and recovery incidents/i)).toBeInTheDocument();
  expect(screen.getByText(/set automatically from linked monitors/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /update component/i }));
  await waitFor(() => expect(updateComponent).toHaveBeenLastCalledWith(expect.objectContaining({ automateStatus: true, autoCreateIncidents: true })));
});

it("offers no automation without a linked monitor", () => {
  renderForm({ monitorIds: [], monitors: [], automateStatus: true });
  expect(screen.queryByRole("switch", { name: /update status from monitors/i })).not.toBeInTheDocument();
});

it("saves after an invalid threshold is hidden by turning automation off", async () => {
  renderForm({ automateStatus: true });
  fireEvent.change(screen.getByLabelText(/failing monitors required/i), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("switch", { name: /update status from monitors/i }));
  fireEvent.click(screen.getByRole("button", { name: /update component/i }));
  await waitFor(() => expect(updateComponent).toHaveBeenLastCalledWith(expect.objectContaining({ automateStatus: false, failureThreshold: 1 })));
});
