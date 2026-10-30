import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invalidate = jest.fn().mockResolvedValue(undefined);
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: invalidate }) }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "p1" }) }));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
const submit = jest.fn();
jest.mock("@/actions/sre-investigation-feedback", () => ({
  submitSreInvestigationFeedback: (...a: unknown[]) => submit(...a),
}));

import { toast } from "sonner";
import { InvestigationFeedback } from "./investigation-feedback";

const props = { incidentId: "i1", investigationRunId: "run-1", label: "Deploy 42 regression" };

beforeEach(() => {
  jest.clearAllMocks();
  submit.mockResolvedValue({ success: true });
});

describe("InvestigationFeedback", () => {
  it("submits a verdict with an optional one-line note for a hypothesis", async () => {
    render(<InvestigationFeedback {...props} hypothesisKey="h1" />);
    fireEvent.click(screen.getByRole("button", { name: "Wrong: Deploy 42 regression" }));
    fireEvent.change(screen.getByLabelText("Optional one-line note"), { target: { value: "It was DNS" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ investigationRunId: "run-1", hypothesisKey: "h1", verdict: "wrong", note: "It was DNS" }),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("You marked this wrong: It was DNS");
    expect(invalidate).toHaveBeenCalled();
  });

  it("allows a verdict without a note and targets the whole run when no key is given", async () => {
    render(<InvestigationFeedback {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Right: Deploy 42 regression" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith({ investigationRunId: "run-1", hypothesisKey: null, verdict: "right", note: null }),
    );
  });

  it("surfaces permission and rate-limit errors and keeps the draft open", async () => {
    submit.mockResolvedValue({ success: false, error: "Too much feedback in a short time." });
    render(<InvestigationFeedback {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Right: Deploy 42 regression" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Too much feedback in a short time."));
    expect(screen.getByLabelText("Optional one-line note")).toBeInTheDocument();
  });

  it("shows the user's earlier verdict as pressed", () => {
    render(<InvestigationFeedback {...props} initial={{ verdict: "right", note: null }} />);
    expect(screen.getByRole("button", { name: "Right: Deploy 42 regression" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Wrong: Deploy 42 regression" })).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the saved verdict and note in the compact button tooltip", async () => {
    render(<InvestigationFeedback {...props} compact initial={{ verdict: "wrong", note: "It was DNS" }} />);
    const wrong = screen.getByRole("button", { name: "Wrong: Deploy 42 regression" });
    expect(wrong).toHaveAttribute("aria-pressed", "true");
    fireEvent.focus(wrong);
    expect((await screen.findAllByText("You marked this wrong: It was DNS")).length).toBeGreaterThan(0);
  });
});
