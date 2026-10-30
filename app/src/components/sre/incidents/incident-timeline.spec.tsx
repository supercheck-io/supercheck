import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import { addSreIncidentUpdate } from "@/actions/sre-incident-lifecycle";

import { aiFindingHeadline, describeTimelineEvent, IncidentTimeline } from "./incident-timeline";

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
let mockQuery: { isPending: boolean; data?: unknown };

jest.mock("sonner", () => ({ toast: { error: jest.fn() } }));
jest.mock("@/actions/sre-incident-lifecycle", () => ({ addSreIncidentUpdate: jest.fn() }));
jest.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mockInvalidate }) }));
jest.mock("@/hooks/use-sre", () => ({ useSreIncidentTimeline: () => mockQuery }));
jest.mock("@/hooks/use-project-context", () => ({ useProjectContext: () => ({ projectId: "project-1" }) }));

const addUpdate = addSreIncidentUpdate as jest.Mock;
const at = new Date("2026-06-24T12:00:00Z");
const ev = (id: string, eventType: string, eventData: Record<string, unknown> | null, extra = {}) => ({
  id, eventType, eventData, actorType: "user", actorName: "Ada", actorImage: null, createdAt: at, ...extra,
});
const ready = (events: unknown[]) => { mockQuery = { isPending: false, data: { success: true, events } }; };

beforeEach(() => {
  jest.clearAllMocks();
  ready([]);
});

describe("describeTimelineEvent", () => {
  it.each([
    ["recovered", "Recovered"],
    ["reopened", "Reopened"],
    ["resolved", "Resolved"],
    ["acknowledged", "Acknowledged"],
    ["nonsense", "Status change"],
  ])("labels state_change %s as %s", (state, title) => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state } }).title).toBe(title);
  });

  it("uses the comment or summary as the body and truncates long text", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "resolved", summary: "Auto-resolved" } }).body).toBe("Auto-resolved");
    expect(describeTimelineEvent({ eventType: "comment", eventData: { text: "x".repeat(700) } }).body).toHaveLength(600);
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { error: "boom" } })).toEqual({ title: "AI finding", body: "boom" });
    expect(describeTimelineEvent({ eventType: "some_event", eventData: null })).toEqual({ title: "some event", body: null });
  });
});

describe("IncidentTimeline", () => {
  it("shows the latest 20 events and expands to all of them", () => {
    ready(Array.from({ length: 25 }, (_, i) => ev(`e${i}`, "comment", { text: `note ${i}` })));
    render(<IncidentTimeline incidentId="inc-1" canUpdate={false} />);
    expect(screen.getByText("note 19")).toBeInTheDocument();
    expect(screen.queryByText("note 20")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all 25 events" }));
    expect(screen.getByText("note 24")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows loading, error and empty states", () => {
    mockQuery = { isPending: true };
    const view = render(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.getByText("Loading timeline...")).toBeInTheDocument();
    mockQuery = { isPending: false, data: { success: false, error: "Not allowed", events: [] } };
    view.rerender(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.getByRole("alert")).toHaveTextContent("Not allowed");
    ready([]);
    view.rerender(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });

  it("renders event types, actors and the automatic resolve", () => {
    ready([
      ev("1", "comment", { text: "Rolling back" }),
      ev("2", "state_change", { state: "recovered" }, { actorName: null, actorType: "system" }),
      ev("3", "state_change", { state: "reopened" }),
      ev("4", "state_change", { state: "resolved", summary: "Resolved automatically on recovery" }, { actorName: null, actorType: "system" }),
      ev("5", "ai_finding", { summary: "Deploy 42 is suspect" }, { actorName: null, actorType: "agent" }),
    ]);
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.getAllByRole("listitem")).toHaveLength(5);
    for (const text of ["Note", "Rolling back", "Recovered", "Reopened", "Resolved", "Resolved automatically on recovery", "AI finding", "Deploy 42 is suspect", "AI"]) {
      expect(screen.getAllByText(text, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText(/System/).length).toBe(2);
  });

  it("hides the composer when the user cannot update", () => {
    render(<IncidentTimeline incidentId="i1" canUpdate={false} />);
    expect(screen.queryByPlaceholderText("Add a note for your team...")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("disables Post until there is text, then posts and invalidates the timeline query", async () => {
    addUpdate.mockResolvedValue({ success: true });
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    const box = screen.getByPlaceholderText("Add a note for your team...");
    fireEvent.change(box, { target: { value: "Fix deployed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(mockInvalidate).toHaveBeenCalled());
    expect(addUpdate).toHaveBeenCalledWith({ incidentId: "i1", text: "Fix deployed" });
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: expect.arrayContaining(["project-1", "i1"]) });
    expect(box).toHaveValue("");
  });

  it.each([
    ["an error result", () => addUpdate.mockResolvedValue({ success: false, error: "Denied" }), "Denied"],
    ["a rejected action", () => addUpdate.mockRejectedValue(new Error("net")), "Failed to add note"],
  ])("toasts and keeps the draft on %s", async (_name, arrange, message) => {
    arrange();
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    const box = screen.getByPlaceholderText("Add a note for your team...");
    fireEvent.change(box, { target: { value: "Draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(message));
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(box).toHaveValue("Draft");
  });
});

describe("aiFindingHeadline", () => {
  it("keeps only the first paragraph as plain text", () => {
    expect(aiFindingHeadline("**Inconclusive.** No evidence was available.\n\n**Hypotheses**\n- one")).toBe(
      "Inconclusive. No evidence was available.",
    );
    expect(aiFindingHeadline(undefined)).toBeNull();
    expect(aiFindingHeadline("   ")).toBeNull();
  });
});

it("cuts long AI headlines at a word with an ellipsis", () => {
  const long = `${"word ".repeat(120)}end`;
  const headline = aiFindingHeadline(long)!;
  expect(headline.endsWith("word…")).toBe(true);
  expect(headline.length).toBeLessThanOrEqual(401);
});
