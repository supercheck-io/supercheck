import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import Playground from "./index";

// Hooks must return stable references, or the Playground's effects re-run forever.
const mockSearchParams = new URLSearchParams();
const mockProjectContext = { currentProject: { userRole: "project_editor" } };
const mockLocations = { locations: [], hasRestrictions: false, isLoading: false };
const mockSession = { data: { user: { id: "u" } } };

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("next/navigation", () => ({ useSearchParams: () => mockSearchParams }));
jest.mock("./code-editor", () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="editor" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
jest.mock("./test-form", () => ({ TestForm: () => null }));
jest.mock("./ai-fix-button", () => ({ AIFixButton: () => null }));
jest.mock("./ai-diff-viewer", () => ({ AIDiffViewer: () => null }));
jest.mock("./guidance-modal", () => ({ GuidanceModal: () => null }));
jest.mock("./ai-create-button", () => ({ AICreateButton: () => null }));
jest.mock("./ai-create-viewer", () => ({ AICreateViewer: () => null }));
jest.mock("./performance-test-report", () => ({ PerformanceTestReport: () => null }));
jest.mock("./template-dialog", () => ({ TemplateDialog: () => null }));
jest.mock("./location-selection-dialog", () => ({ LocationSelectionDialog: () => null }));
jest.mock("./runtime-info-popover", () => ({ __esModule: true, default: () => null }));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));
jest.mock("@/components/recorder", () => ({ RecordButton: () => null }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => mockProjectContext }));
jest.mock("@/hooks/use-locations", () => ({ useAvailableLocations: () => mockLocations }));
jest.mock("@/hooks/use-executions", () => ({ notifyExecutionsChanged: jest.fn() }));
jest.mock("@/utils/auth-client", () => ({ useSession: () => mockSession }));
jest.mock("@/actions/requirements", () => ({ getRequirement: jest.fn() }));

const send = (code: string) =>
  act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { source: "supercheck-recorder", type: "SUPERCHECK_RECORDED_CODE", payload: { code } },
      }),
    );
  });

const base = { title: "t", description: null, script: "saved();", priority: "medium" as const, type: "browser" as const };

describe("Playground recorded code", () => {
  let post: jest.SpyInstance;
  beforeEach(() => {
    post = jest.spyOn(window, "postMessage");
  });
  afterEach(() => post.mockRestore());

  const acks = () => post.mock.calls.filter(([m]) => m?.type === "SUPERCHECK_RECORDED_CODE_ACK").length;

  it("replaces a clean editor without asking, and acks", async () => {
    render(<Playground initialTestData={base} />);
    await send("recorded();");
    expect(screen.getByLabelText("editor")).toHaveValue("recorded();");
    expect(screen.queryByText(/Replace editor content/)).toBeNull();
    expect(acks()).toBe(1);
  });

  it("asks before overwriting unsaved work; Keep current leaves it, acks immediately", async () => {
    render(<Playground initialTestData={base} />);
    fireEvent.change(screen.getByLabelText("editor"), { target: { value: "my work" } });
    await send("recorded();");
    expect(screen.getByText("Replace editor content with the recorded script?")).toBeInTheDocument();
    expect(acks()).toBe(1);
    fireEvent.click(screen.getByText("Keep current"));
    expect(screen.getByLabelText("editor")).toHaveValue("my work");
  });

  it("asks when the saved script was cleared, since an empty editor is still unsaved work", async () => {
    render(<Playground initialTestData={base} />);
    fireEvent.change(screen.getByLabelText("editor"), { target: { value: "" } });
    await send("recorded();");
    expect(screen.getByText("Replace editor content with the recorded script?")).toBeInTheDocument();
  });

  it("applies the recording on Replace", async () => {
    render(<Playground initialTestData={base} />);
    fireEvent.change(screen.getByLabelText("editor"), { target: { value: "my work" } });
    await send("recorded();");
    fireEvent.click(screen.getByText("Replace"));
    expect(screen.getByLabelText("editor")).toHaveValue("recorded();");
  });
});
