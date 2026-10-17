import { fireEvent, render, screen } from "@testing-library/react";
import { TemplateDialog } from "./template-dialog";
import { getTemplatesByType } from "./template-data";
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));
jest.mock("@monaco-editor/react", () => ({
  Editor: ({ value, language }: { value: string; language: string }) => (
    <textarea aria-label={`${language} preview`} value={value} readOnly />
  ),
}));
const props = {
  open: true,
  onOpenChange: jest.fn(),
  testType: "browser" as const,
  onApply: jest.fn(),
};
beforeEach(() => jest.clearAllMocks());
it("previews without applying and explains replacement", () => {
  render(<TemplateDialog {...props} />);
  expect(screen.getByLabelText("typescript preview")).toHaveValue(
    getTemplatesByType("browser")[0].code,
  );
  expect(
    screen.getByText(/replaces the code in your editor/),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
  expect(props.onApply).not.toHaveBeenCalled();
});
it("searches tags, previews setup and applies exactly the visible choice", () => {
  render(<TemplateDialog {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search templates" }), {
    target: { value: "webauthn" },
  });
  const template = getTemplatesByType("browser").find(
    (t) => t.id === "pw-passkey-authentication",
  )!;
  expect(screen.getByRole("radio")).toBeChecked();
  expect(screen.getByLabelText("typescript preview")).toHaveValue(
    template.code,
  );
  expect(screen.getByText(template.setup!)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply Template" }));
  expect(props.onApply).toHaveBeenCalledWith(template.code);
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
});
it("blocks empty searches and resets on reopening", () => {
  const { rerender } = render(<TemplateDialog {...props} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Search templates" }), {
    target: { value: "no-such-template" },
  });
  expect(screen.getByRole("status")).toHaveTextContent("No matching templates");
  expect(screen.getByRole("button", { name: "Apply Template" })).toBeDisabled();
  rerender(<TemplateDialog {...props} open={false} />);
  rerender(<TemplateDialog {...props} />);
  expect(screen.getByRole("textbox", { name: "Search templates" })).toHaveValue(
    "",
  );
});
it("updates selection and editor language when test type changes", () => {
  const { rerender } = render(<TemplateDialog {...props} />);
  rerender(<TemplateDialog {...props} testType="performance" />);
  const first = getTemplatesByType("performance")[0];
  expect(screen.getByLabelText("javascript preview")).toHaveValue(first.code);
  fireEvent.click(screen.getByRole("button", { name: "Apply Template" }));
  expect(props.onApply).toHaveBeenCalledWith(first.code);
});
it("changes preview through radio selection without applying", () => {
  render(<TemplateDialog {...props} />);
  fireEvent.click(screen.getByRole("radio", { name: /Auth flow/ }));
  expect(screen.getByLabelText("typescript preview")).toHaveValue(
    getTemplatesByType("browser").find((t) => t.id === "pw-browser-auth")!.code,
  );
  expect(props.onApply).not.toHaveBeenCalled();
});
