import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { EditSreIncidentDialog } from "./edit-sre-incident-dialog";

const updateSreIncident = jest.fn();
jest.mock("@/actions/sre-incidents", () => ({
  updateSreIncident: (...args: unknown[]) => updateSreIncident(...args),
}));
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/incidents/inc-1",
}));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn(), refetchQueries: jest.fn() }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p1" }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const incident = (status: string) =>
  ({
    id: "00000000-0000-4000-8000-000000000001",
    title: "Checkout down",
    severity: "sev2",
    status,
    primaryServiceId: null,
  }) as never;

beforeAll(() => {
  // Radix Select needs pointer-capture and scroll APIs jsdom lacks.
  Element.prototype.hasPointerCapture = Element.prototype.hasPointerCapture ?? (() => false);
  Element.prototype.setPointerCapture = Element.prototype.setPointerCapture ?? (() => {});
  Element.prototype.releasePointerCapture = Element.prototype.releasePointerCapture ?? (() => {});
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});
});

beforeEach(() => {
  jest.clearAllMocks();
  updateSreIncident.mockResolvedValue({ success: true, message: "Updated", incident: {} });
});

describe("EditSreIncidentDialog", () => {
  it("shows a stored fixing sub-state as Fixing and does not post a status it did not change", async () => {
    render(<EditSreIncidentDialog incident={incident("recommendations_ready")} services={[]} canUpdate open onOpenChange={jest.fn()} />);
    expect(screen.getByLabelText("Status")).toHaveTextContent("Fixing");
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(updateSreIncident).toHaveBeenCalled());
    expect(updateSreIncident.mock.calls[0]![0]).not.toHaveProperty("status");
  });

  it("shows an acknowledged incident as Acknowledged and saves other fields without a status", async () => {
    const acked = { ...(incident("triggered") as object), acknowledgedAt: "2026-01-01T00:00:00Z" } as never;
    render(<EditSreIncidentDialog incident={acked} services={[]} canUpdate open onOpenChange={jest.fn()} />);
    expect(screen.getByLabelText("Status")).toHaveTextContent("Acknowledged");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Checkout down hard" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(updateSreIncident).toHaveBeenCalled());
    const sent = updateSreIncident.mock.calls[0]![0];
    expect(sent).toMatchObject({ title: "Checkout down hard" });
    expect(sent).not.toHaveProperty("status");
  });

  it("posts the status once the person picks one", async () => {
    render(<EditSreIncidentDialog incident={incident("triggered")} services={[]} canUpdate open onOpenChange={jest.fn()} />);
    fireEvent.keyDown(screen.getByLabelText("Status"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Investigating" }));
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(updateSreIncident).toHaveBeenCalledWith(expect.objectContaining({ status: "investigating" })));
  });

  it("warns that saving reopens a resolved incident", () => {
    render(<EditSreIncidentDialog incident={incident("resolved")} services={[]} canUpdate open onOpenChange={jest.fn()} />);
    expect(screen.queryByText(/Saving reopens the incident/)).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Status"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Investigating" }));
    expect(screen.getByText(/Saving reopens the incident/)).toBeInTheDocument();
  });

  it("hides deprecated services from the picker except the one already linked", () => {
    const services = [
      { id: "s-active", name: "Checkout", status: "active" },
      { id: "s-old", name: "Legacy API", status: "deprecated" },
      { id: "s-linked", name: "Old Billing", status: "deprecated" },
    ] as never;
    render(
      <EditSreIncidentDialog
        incident={{ ...(incident("investigating") as object), primaryServiceId: "s-linked" } as never}
        services={services}
        canUpdate
        open
        onOpenChange={jest.fn()}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText("Service"), { key: "Enter" });
    expect(screen.getByRole("option", { name: "Checkout" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Old Billing" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Legacy API" })).not.toBeInTheDocument();
  });
});
