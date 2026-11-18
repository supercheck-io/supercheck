import { render, screen } from "@testing-library/react";
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
