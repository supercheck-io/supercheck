import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createIncident } from "@/actions/create-incident";
import { IncidentFormDialog } from "./incident-form-dialog";

jest.mock("@/actions/create-incident", () => ({ createIncident: jest.fn() }));
jest.mock("@/actions/sre-incidents", () => ({ getSreIncidents: jest.fn(async () => ({ success: true, incidents: [] })) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
let mockPages = [{ id: "sp-1", name: "Public status" }, { id: "sp-2", name: "Enterprise status" }];
jest.mock("@/hooks/use-status-pages", () => ({
  useStatusPages: () => ({ statusPages: mockPages, loading: false }),
  useStatusPageDetail: (id: string | null) => ({ components: id ? [{ id: `${id}-api`, name: `API on ${id}` }] : [], isLoading: false }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockPages = [{ id: "sp-1", name: "Public status" }, { id: "sp-2", name: "Enterprise status" }];
});

it("from an SRE incident: picks a page without a post yet and links the new post to the incident", async () => {
  jest.mocked(createIncident).mockResolvedValue({ success: true } as never);
  const onSuccess = jest.fn();
  render(<IncidentFormDialog open onOpenChange={jest.fn()} onSuccess={onSuccess} sreIncident={{ id: "sre-1", title: "Checkout errors" }} excludeStatusPageIds={["sp-1"]} />);
  expect(screen.getByLabelText("Title *")).toHaveValue("Checkout errors");
  expect(screen.getByText("Select a status page to see its components.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("combobox", { name: "Status page *" }));
  expect(screen.queryByRole("option", { name: "Public status" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("option", { name: "Enterprise status" }));
  fireEvent.click(screen.getByLabelText("API on sp-2"));
  fireEvent.change(screen.getByLabelText("Initial Message *"), { target: { value: "Investigating" } });
  fireEvent.click(screen.getByRole("button", { name: "Post status update" }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  expect(createIncident).toHaveBeenCalledWith(expect.objectContaining({ statusPageId: "sp-2", sreIncidentId: "sre-1", name: "Checkout errors", affectedComponentIds: ["sp-2-api"] }));
});

it("says so when the incident is already on every status page", () => {
  mockPages = [{ id: "sp-1", name: "Public status" }];
  render(<IncidentFormDialog open onOpenChange={jest.fn()} onSuccess={jest.fn()} sreIncident={{ id: "sre-1", title: "Checkout errors" }} excludeStatusPageIds={["sp-1"]} />);
  expect(screen.getByText("This incident is already on every status page in this project.")).toBeInTheDocument();
});
