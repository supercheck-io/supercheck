import { act, fireEvent, render, screen } from "@testing-library/react";

import { MarkdownReportDialog } from "./markdown-report-dialog";

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <pre data-testid="monaco">{value}</pre>,
  useMonaco: () => null,
}));
jest.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const md = "## Report Details\n\n- **Job Name**: Checkout\n- second\n\n[docs](https://example.com)\n\n<script>window.pwned=1</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))";

const renderDialog = (content = md) =>
  render(
    <MarkdownReportDialog
      open
      onClose={() => {}}
      content={content}
      isStreaming={false}
      title="t"
      description="d"
      downloadFilename="r.md"
      loadingMessage="loading"
    />,
  );

describe("MarkdownReportDialog", () => {
  it("renders headings and lists as formatted Markdown by default", () => {
    renderDialog();
    expect(screen.getByRole("heading", { name: "Report Details" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Job Name").tagName).toBe("STRONG");
    expect(screen.queryByTestId("monaco")).toBeNull();
  });

  it("does not inject raw HTML and hardens links", () => {
    renderDialog();
    const rendered = screen.getByTestId("report-rendered");
    expect(rendered.querySelector("script, img")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
    const link = screen.getByRole("link", { name: "docs" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(rendered.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("shows the full link destination next to the label", () => {
    renderDialog();
    expect(screen.getByText("(https://example.com)")).toBeTruthy();
  });

  it("reopens on the Report tab after Source was used", () => {
    const props = { onClose: () => {}, content: md, isStreaming: false, title: "t", description: "d", downloadFilename: "r.md", loadingMessage: "l" };
    const { rerender } = render(<MarkdownReportDialog open {...props} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }), { button: 0 });
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    rerender(<MarkdownReportDialog open={false} {...props} />);
    rerender(<MarkdownReportDialog open {...props} />);
    expect(screen.getByTestId("report-rendered")).toBeTruthy();
  });

  it("throttles rendering while streaming and renders the final text at once", () => {
    jest.useFakeTimers();
    const props = { open: true, onClose: () => {}, title: "t", description: "d", downloadFilename: "r.md", loadingMessage: "l" };
    const { rerender } = render(<MarkdownReportDialog {...props} content="# A" isStreaming />);
    rerender(<MarkdownReportDialog {...props} content="# AB" isStreaming />);
    expect(screen.queryByRole("heading", { name: "AB" })).toBeNull();
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByRole("heading", { name: "AB" })).toBeTruthy();
    rerender(<MarkdownReportDialog {...props} content="# ABC" isStreaming={false} />);
    expect(screen.getByRole("heading", { name: "ABC" })).toBeTruthy();
    jest.useRealTimers();
  });

  it("shows the raw Markdown in the Source tab", () => {
    renderDialog();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }), { button: 0 });
    fireEvent.click(screen.getByRole("tab", { name: "Source" }));
    expect(screen.getByTestId("monaco").textContent).toBe(md);
  });

  it("copies the raw Markdown", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalledWith(md);
  });
});
