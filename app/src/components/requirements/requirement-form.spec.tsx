import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getLinkedTests, syncRequirementTests, updateRequirement } from "@/actions/requirements";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RequirementForm } from "./requirement-form";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
jest.mock("@/actions/requirements", () => ({
  // Never resolves: the linked-tests query stays pending, which is when the old default looped.
  getLinkedTests: jest.fn(() => new Promise(() => {})),
  createRequirement: jest.fn(),
  updateRequirement: jest.fn(),
  syncRequirementTests: jest.fn(),
  deleteRequirement: jest.fn(),
}));
jest.mock("@/hooks/use-tags", () => ({
  useTags: () => ({ tags: [], isLoading: false }),
  useRequirementTags: () => ({ requirementTags: [], isLoading: false }),
  useTagMutations: () => ({ createTag: { mutateAsync: jest.fn() }, deleteTag: { mutateAsync: jest.fn() } }),
  useSaveRequirementTags: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({ currentProject: { id: "p1", userRole: "project_admin" } }),
}));
jest.mock("@/utils/auth-client", () => ({ useSession: () => ({ data: { user: { id: "u1" } } }) }));
jest.mock("@/components/shared/test-selector", () => ({ __esModule: true, default: () => null }));
const toastError = jest.fn();
jest.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a), success: jest.fn() } }));

it("does not loop re-rendering while the linked tests are still loading", async () => {
  const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RequirementForm
        mode="edit"
        defaultValues={{ id: "req-1", title: "Login works", description: "Users can sign in", priority: "medium" }}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByDisplayValue("Login works")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const loopErrors = errorSpy.mock.calls.filter((args) => String(args[0]).includes("Maximum update depth"));
  errorSpy.mockRestore();
  client.clear();
  expect(loopErrors).toHaveLength(0);
});

it("refuses to save when the linked tests failed to load, instead of replacing the links", async () => {
  (getLinkedTests as jest.Mock).mockRejectedValueOnce(new Error("Failed to load linked tests"));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <RequirementForm
        mode="edit"
        defaultValues={{ id: "req-1", title: "Login works", description: "Users can sign in", priority: "medium" }}
      />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(client.getQueryState(["requirement-linked-tests", "req-1"])?.status).toBe("error"));
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(toastError).toHaveBeenCalledWith("Linked tests haven't loaded yet", expect.anything()));
  expect(updateRequirement).not.toHaveBeenCalled();
  expect(syncRequirementTests).not.toHaveBeenCalled();
  client.clear();
});

function renderEdit(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <RequirementForm
        mode="edit"
        defaultValues={{ id: "req-1", title: "Login works", description: "Users can sign in", priority: "medium" }}
      />
    </QueryClientProvider>,
  );
}

it("saves a requirement with no linked tests without touching links", async () => {
  (getLinkedTests as jest.Mock).mockResolvedValueOnce([]);
  (updateRequirement as jest.Mock).mockResolvedValueOnce({ success: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  renderEdit(client);
  await waitFor(() => expect(client.getQueryState(["requirement-linked-tests", "req-1"])?.status).toBe("success"));
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(updateRequirement).toHaveBeenCalled());
  expect(syncRequirementTests).not.toHaveBeenCalled();
  client.clear();
});

it("refuses to save on a cached link list until this visit's refetch has landed", async () => {
  toastError.mockClear();
  (updateRequirement as jest.Mock).mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  // Cached from an earlier visit; the refetch on mount never resolves (default mock).
  client.setQueryData(["requirement-linked-tests", "req-1"], []);
  renderEdit(client);
  await screen.findByDisplayValue("Login works");
  fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  await waitFor(() => expect(toastError).toHaveBeenCalledWith("Linked tests haven't loaded yet", expect.anything()));
  expect(updateRequirement).not.toHaveBeenCalled();
  client.clear();
});
