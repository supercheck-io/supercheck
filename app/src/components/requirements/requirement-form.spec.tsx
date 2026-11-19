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

it("keeps Save off when the linked tests failed to load, and offers a retry", async () => {
  (getLinkedTests as jest.Mock).mockRejectedValueOnce(new Error("Failed to load linked tests"));
  (getLinkedTests as jest.Mock).mockResolvedValueOnce([]);
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
  expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /retry/i }));
  await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled());
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

it("keeps Save off on a cached link list until this visit's refetch has landed, then enables it", async () => {
  let resolveLinks: (value: unknown[]) => void = () => {};
  (getLinkedTests as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (resolveLinks = resolve)));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  // Cached from an earlier visit: it could be missing links, so it never counts as loaded.
  client.setQueryData(["requirement-linked-tests", "req-1"], []);
  renderEdit(client);
  await screen.findByDisplayValue("Login works");
  expect(screen.getByRole("button", { name: /loading linked tests/i })).toBeDisabled();
  resolveLinks([]);
  await waitFor(() => expect(screen.getByRole("button", { name: /save changes/i })).toBeEnabled());
  client.clear();
});

it("saves with the existing links kept once a slow fetch lands (no link is removed)", async () => {
  let resolveLinks: (value: unknown[]) => void = () => {};
  (getLinkedTests as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => (resolveLinks = resolve)));
  (updateRequirement as jest.Mock).mockClear();
  (syncRequirementTests as jest.Mock).mockClear();
  (updateRequirement as jest.Mock).mockResolvedValueOnce({ success: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  renderEdit(client);
  await screen.findByDisplayValue("Login works");
  expect(screen.getByRole("button", { name: /loading linked tests/i })).toBeDisabled();
  resolveLinks([{ id: "t1", title: "T1", name: "T1", type: "browser", description: null, tags: [] }]);
  const save = await screen.findByRole("button", { name: /save changes/i });
  await waitFor(() => expect(save).toBeEnabled());
  fireEvent.click(save);
  await waitFor(() => expect(updateRequirement).toHaveBeenCalled());
  expect(syncRequirementTests).not.toHaveBeenCalled();
  client.clear();
});

it("still refuses a submit that bypasses the disabled button before this visit's links have loaded", async () => {
  toastError.mockClear();
  (updateRequirement as jest.Mock).mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const { container } = renderEdit(client);
  await screen.findByDisplayValue("Login works");
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(toastError).toHaveBeenCalledWith("Linked tests haven't loaded yet", expect.anything()));
  expect(updateRequirement).not.toHaveBeenCalled();
  client.clear();
});
