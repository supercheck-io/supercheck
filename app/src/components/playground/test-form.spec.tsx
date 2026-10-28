import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { TestForm } from "./test-form";

const push = jest.fn();
const invalidateQueries = jest.fn();
const saveTest = jest.fn();
const saveTagsMutateAsync = jest.fn();

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries }) }));
jest.mock("@/actions/save-test", () => ({ saveTest: (...a: unknown[]) => saveTest(...a), decodeTestScript: jest.fn() }));
jest.mock("@/actions/get-linked-requirement", () => ({ getLinkedTestRequirement: jest.fn().mockResolvedValue(null) }));
jest.mock("@/actions/delete-test", () => ({ deleteTest: jest.fn() }));
jest.mock("@/hooks/use-tests", () => ({ TESTS_QUERY_KEY: ["tests"], TEST_QUERY_KEY: ["test"] }));
jest.mock("@/hooks/use-requirements", () => ({ REQUIREMENTS_QUERY_KEY: ["requirements"] }));
jest.mock("@/hooks/use-dashboard", () => ({ DASHBOARD_QUERY_KEY: ["dashboard"] }));
jest.mock("@/hooks/use-tags", () => ({
  useTags: () => ({ tags: [], isLoading: false }),
  useTestTags: () => ({ testTags: [], isLoading: false }),
  useTagMutations: () => ({ createTag: { mutateAsync: jest.fn() }, deleteTag: { mutateAsync: jest.fn() } }),
  useSaveTestTags: () => ({ mutateAsync: saveTagsMutateAsync }),
}));
jest.mock("@/components/ui/tag-selector", () => ({
  TagSelector: ({ onChange }: { onChange: (t: unknown[]) => void }) => (
    <button type="button" onClick={() => onChange([{ id: "tag1", name: "t", color: null }])}>
      pick tag
    </button>
  ),
}));

const testCase = { title: "T", description: "D", priority: "medium" as const, type: "browser" as const, script: "x" };

function renderForm() {
  const utils = render(
    <TestForm
      testCase={testCase}
      setTestCase={jest.fn()}
      errors={{}}
      validateForm={() => true}
      editorContent="script"
      isRunning={false}
      setInitialEditorContent={jest.fn()}
      initialFormValues={testCase}
      initialEditorContent="script"
      testId="t1"
      isCurrentScriptValidated
      isCurrentScriptReadyToSave
      testExecutionStatus="passed"
    />
  );
  fireEvent.click(screen.getByText("pick tag"));
  return utils;
}

beforeEach(() => {
  jest.clearAllMocks();
  saveTest.mockResolvedValue({ success: true });
});

it("invalidates the single-test cache after saving", async () => {
  saveTagsMutateAsync.mockResolvedValue(undefined);
  const { container } = renderForm();
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(push).toHaveBeenCalledWith("/tests/"));
  expect(invalidateQueries).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ["test", "t1"] }));
});

it("does not report success or leave the form when saving tags fails", async () => {
  saveTagsMutateAsync.mockRejectedValue(new Error("403"));
  const { container } = renderForm();
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(toast.error).toHaveBeenCalled());
  expect(toast.success).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});
