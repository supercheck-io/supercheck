import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p1" }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("@/components/sre/sre-message-content", () => ({ SreMessageContent: ({ content }: { content: string }) => <>{content}</> }));
const generate = jest.fn();
const save = jest.fn();
jest.mock("@/actions/sre-postmortem", () => ({
  generateSrePostmortem: (...a: unknown[]) => generate(...a),
  saveSrePostmortem: (...a: unknown[]) => save(...a),
}));

import { PostmortemCard } from "./postmortem-card";

const base = { incidentId: "i1", incidentNumber: 9, title: "Checkout latency" };
const stored = {
  sections: { summary: "S", impact: "I", timeline: "T", root_cause: "R", contributing_factors: "C", follow_ups: "- Add canary\n- Alert on p95" },
};

beforeEach(() => {
  jest.clearAllMocks();
  generate.mockResolvedValue({ success: true, source: "template", postmortem: stored });
  save.mockResolvedValue({ success: true, postmortem: stored });
  URL.createObjectURL = jest.fn(() => "blob:x");
  URL.revokeObjectURL = jest.fn();
});

const openEditor = () => fireEvent.click(screen.getByRole("button", { name: "Edit" }));

describe("PostmortemCard", () => {
  it("offers generation when empty and shows the draft as a document", async () => {
    render(<PostmortemCard {...base} postmortem={null} canEdit />);
    expect(screen.getByText("No post-mortem yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate post-mortem draft" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ incidentId: "i1" }));
    expect(await screen.findByRole("region", { name: "Root cause" })).toHaveTextContent("R");
    expect(screen.getByRole("region", { name: /Follow-ups/ })).toHaveTextContent("Alert on p95");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerate draft" })).toBeInTheDocument();
  });

  it("marks empty sections instead of showing placeholder text", () => {
    render(<PostmortemCard {...base} postmortem={{ sections: { ...stored.sections, impact: "", follow_ups: "" } }} canEdit />);
    expect(screen.getByRole("region", { name: "Impact" })).toHaveTextContent("Not written yet.");
    expect(screen.getByRole("region", { name: /Follow-ups/ })).toHaveTextContent("Not written yet.");
  });

  it("shows when the draft was generated and last saved", () => {
    const generatedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    render(
      <PostmortemCard {...base} postmortem={{ ...stored, generatedAt, updatedAt: new Date(Date.now() - 5 * 60_000).toISOString() }} canEdit />,
    );
    expect(screen.getByText(/Draft generated .*ago · Saved .*ago/)).toBeInTheDocument();
  });

  it("asks before replacing an existing draft and only regenerates on confirm", async () => {
    render(<PostmortemCard {...base} postmortem={stored} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("Your edits will be lost.");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace draft" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ incidentId: "i1" }));
  });

  it("saves edits with follow-ups serialized as a bullet list, then returns to the document", async () => {
    save.mockResolvedValue({ success: true, postmortem: { sections: { ...stored.sections, summary: "New summary" } } });
    render(<PostmortemCard {...base} postmortem={stored} canEdit />);
    openEditor();
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "New summary" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove follow-up 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Add follow-up" }));
    fireEvent.change(screen.getByLabelText("Follow-up 2"), { target: { value: "Write runbook" } });
    fireEvent.click(screen.getByRole("button", { name: "Save post-mortem" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][0]).toEqual({
      incidentId: "i1",
      sections: expect.objectContaining({ summary: "New summary", follow_ups: "- Alert on p95\n- Write runbook" }),
    });
    expect(await screen.findByRole("region", { name: "Summary" })).toHaveTextContent("New summary");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("keeps the editor open when saving fails", async () => {
    save.mockResolvedValue({ success: false, error: "Each section must be 4000 characters or fewer" });
    const { toast } = jest.requireMock("sonner");
    render(<PostmortemCard {...base} postmortem={stored} canEdit />);
    openEditor();
    fireEvent.click(screen.getByRole("button", { name: "Save post-mortem" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Each section must be 4000 characters or fewer"));
    expect(screen.getByLabelText("Summary")).toBeInTheDocument();
  });

  it("discards unsaved edits on Cancel", () => {
    render(<PostmortemCard {...base} postmortem={stored} canEdit />);
    openEditor();
    fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Scratch" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Summary" })).toHaveTextContent(/^SummaryS$/);
    openEditor();
    expect(screen.getByLabelText("Summary")).toHaveValue("S");
  });

  it("exports Markdown", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<PostmortemCard {...base} postmortem={stored} canEdit={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Markdown" }));
    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    click.mockRestore();
  });

  it("is read-only for viewers and hides generation and editing", () => {
    render(<PostmortemCard {...base} postmortem={stored} canEdit={false} />);
    expect(screen.getByRole("region", { name: "Summary" })).toHaveTextContent("S");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Regenerate|Generate|Edit|Save post-mortem/ })).not.toBeInTheDocument();
  });

  it("tells viewers when nothing has been written", () => {
    render(<PostmortemCard {...base} postmortem={null} canEdit={false} />);
    expect(screen.getByText("No post-mortem has been written for this incident.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows an error toast when generation is refused", async () => {
    generate.mockResolvedValue({ success: false, error: "Too many drafts in a short time. Try again later." });
    const { toast } = jest.requireMock("sonner");
    render(<PostmortemCard {...base} postmortem={null} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Generate post-mortem draft" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too many drafts in a short time. Try again later."));
    expect(screen.getByText("No post-mortem yet")).toBeInTheDocument();
  });
});
