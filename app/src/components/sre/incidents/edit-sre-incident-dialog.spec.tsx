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
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn() }) }));
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
  it("shows a stored fixing sub-state as Fixing and keeps it when saved", async () => {
    render(<EditSreIncidentDialog incident={incident("recommendations_ready")} services={[]} canUpdate open onOpenChange={jest.fn()} />);
    expect(screen.getByLabelText("Status")).toHaveTextContent("Fixing");
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(updateSreIncident).toHaveBeenCalledWith(expect.objectContaining({ status: "recommendations_ready" })));
  });

  it("warns that saving reopens a resolved incident", () => {
    render(<EditSreIncidentDialog incident={incident("resolved")} services={[]} canUpdate open onOpenChange={jest.fn()} />);
    expect(screen.queryByText(/Saving reopens the incident/)).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Status"), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Investigating" }));
    expect(screen.getByText(/Saving reopens the incident/)).toBeInTheDocument();
  });
});
