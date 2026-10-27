import { fireEvent, render, screen, waitFor } from "@testing-library/react";

jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: jest.fn().mockResolvedValue(undefined) }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p1" }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
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

describe("PostmortemCard", () => {
  it("offers generation when empty and fills editable sections from the draft", async () => {
    render(<PostmortemCard {...base} postmortem={null} canEdit />);
    expect(screen.getByText(/No post-mortem yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate post-mortem draft" }));
    await waitFor(() => expect(generate).toHaveBeenCalledWith({ incidentId: "i1" }));
    expect(await screen.findByLabelText("Root cause")).toHaveValue("R");
    expect(screen.getByLabelText("Follow-up 2")).toHaveValue("Alert on p95");
    expect(screen.getByRole("button", { name: "Regenerate draft" })).toBeInTheDocument();
  });

  it("saves edits with follow-ups serialized as a bullet list", async () => {
    render(<PostmortemCard {...base} postmortem={stored} canEdit />);
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
  });

  it("exports Markdown", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    render(<PostmortemCard {...base} postmortem={stored} canEdit={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Export Markdown" }));
    expect(click).toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    click.mockRestore();
  });

  it("is read-only for viewers and hides generation and save", () => {
    render(<PostmortemCard {...base} postmortem={stored} canEdit={false} />);
    expect(screen.getByLabelText("Summary")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Regenerate|Generate|Save post-mortem|Add follow-up/ })).not.toBeInTheDocument();
  });

  it("shows an error toast when generation is refused", async () => {
    generate.mockResolvedValue({ success: false, error: "Too many drafts in a short time. Try again later." });
    const { toast } = jest.requireMock("sonner");
    render(<PostmortemCard {...base} postmortem={null} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Generate post-mortem draft" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too many drafts in a short time. Try again later."));
    expect(screen.queryByLabelText("Root cause")).not.toBeInTheDocument();
  });
});
