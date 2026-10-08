import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TextEncoder } from "node:util";
import { AICreateButton } from "./ai-create-button";
import { AICreateViewer } from "./ai-create-viewer";
import { AIDiffViewer } from "./ai-diff-viewer";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "dark" }) }));
jest.mock("@monaco-editor/react", () => ({
  useMonaco: () => null,
  Editor: ({ value, onChange }: { value: string; onChange?: (value: string) => void }) => (
    <textarea aria-label="Generated code" value={value} onChange={(event) => onChange?.(event.target.value)} />
  ),
  DiffEditor: ({ modified }: { modified: string }) => <pre>{modified}</pre>,
}));

describe("AI create dialog", () => {
  const props = { currentScript: "existing script", testType: "api", isVisible: true, initialIsOpen: true, onAICreateSuccess: jest.fn() };

  it("retains template guidance and both examples outside the input", () => {
    render(<AICreateButton {...props} />);
    expect(screen.getByText(/Choose the right template in Playground first/)).toBeInTheDocument();
    expect(screen.getByText("Playwright API test example:")).toBeInTheDocument();
    expect(screen.getByText("k6 performance test example:")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   short   " } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
  });

  it("keeps the browser recorder recommendation", () => {
    render(<AICreateButton {...props} testType="browser" />);
    expect(screen.getByRole("link", { name: "Playwright Recorder" })).toHaveAttribute("href", "https://chromewebstore.google.com/detail/playwright-crx/jambeljnbnfbkcpnoiaedcabbgmnnlcd");
  });

  it("preserves requirement prompts and blocks generation while they load", () => {
    const { rerender } = render(<AICreateButton {...props} isLoadingPrompt />);
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    rerender(<AICreateButton {...props} initialPrompt="Verify the configured API returns status 200." />);
    expect(screen.getByRole("textbox")).toHaveValue("Verify the configured API returns status 200.");
  });

  it("keeps the request, streaming callbacks, and generated result contract", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      body: { getReader: () => ({
        read: jest.fn().mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"type":"content","content":"GENERATED_SCRIPT: ```js\\nconst result = true;\\n```\\nEXPLANATION: Checks the result."}\n\ndata: {"type":"done"}\n\n') }).mockResolvedValue({ done: true }),
        releaseLock: jest.fn(),
      }) },
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock;
    const onAICreateSuccess = jest.fn();
    const onStreamingUpdate = jest.fn();
    const onStreamingEnd = jest.fn();
    try {
      render(<AICreateButton {...props} onAICreateSuccess={onAICreateSuccess} onStreamingUpdate={onStreamingUpdate} onStreamingEnd={onStreamingEnd} initialPrompt="Check the API response." />);
      fireEvent.click(screen.getByRole("button", { name: "Generate" }));
      await waitFor(() => expect(onAICreateSuccess).toHaveBeenCalledWith("const result = true;", "Checks the result."));
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ userRequest: "Check the API response.", testType: "api", currentScript: "existing script" });
      expect(onStreamingUpdate).toHaveBeenCalled();
      expect(onStreamingEnd).toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("AI review dialogs", () => {
  it("applies edits to generated code through the existing callback", async () => {
    const onAccept = jest.fn();
    render(<AICreateViewer currentScript="original" generatedScript="generated" explanation="Review the result." isVisible onAccept={onAccept} onReject={jest.fn()} onClose={jest.fn()} />);
    expect(screen.getByRole("dialog", { name: "Supercheck AI - Generated Script" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Generated code" })).toHaveValue("generated"));
    fireEvent.change(screen.getByRole("textbox", { name: "Generated code" }), { target: { value: "edited script" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply to Editor" }));
    expect(onAccept).toHaveBeenCalledWith("edited script");
  });

  it.each(["create", "fix"])("prevents closing or applying the %s review while streaming", (kind) => {
    const onClose = jest.fn();
    const common = { explanation: "", isVisible: true, isStreaming: true, onAccept: jest.fn(), onReject: jest.fn(), onClose };
    render(kind === "create" ? <AICreateViewer {...common} currentScript="original" generatedScript="" /> : <AIDiffViewer {...common} originalScript="original" fixedScript="" />);
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    expect(screen.getByRole("button", { name: kind === "create" ? "Generating..." : "Accept & Apply" })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});
