import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";

import { addSreIncidentUpdate } from "@/actions/sre-incident-lifecycle";
import { draftSreStatusUpdate } from "@/actions/sre-status-update-draft";

import { aiFindingHeadline, describeTimelineEvent, IncidentTimeline } from "./incident-timeline";

const mockInvalidate = jest.fn().mockResolvedValue(undefined);
let mockQuery: { isPending: boolean; isError?: boolean; data?: unknown; refetch?: () => void };

jest.mock("sonner", () => ({ toast: { error: jest.fn(), warning: jest.fn() } }));
jest.mock("@/actions/sre-incident-lifecycle", () => ({ addSreIncidentUpdate: jest.fn() }));
jest.mock("@/actions/sre-status-update-draft", () => ({ draftSreStatusUpdate: jest.fn() }));
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

describe("describeTimelineEvent before and after detail", () => {
  const refs = { users: { u1: "Ada", u2: "Grace" }, alerts: { a1: "API latency high" } };

  it("shows old and new values for an edit", () => {
    const event = { eventType: "state_change", eventData: { state: "incident_updated", previous: { title: "A", severity: "sev3", status: "investigating" }, current: { title: "B", severity: "sev1", status: "investigating" } } };
    expect(describeTimelineEvent(event).body).toBe('Title: "A" → "B"\nSeverity: SEV3 → SEV1');
  });

  it("shows a title edit made after character 200", () => {
    const base = "x".repeat(250);
    const event = { eventType: "state_change", eventData: { state: "incident_updated", previous: { title: `${base}a` }, current: { title: `${base}b` } } };
    expect(describeTimelineEvent(event).body).toBe(`Title: "${base}a" → "${base}b"`);
  });

  it("still renders an edit recorded without values", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "incident_updated" } })).toEqual({ title: "Incident updated", body: null });
  });

  it("resolves user names for a reassignment and handles unassigned", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "assigned", previousAssigneeUserId: "u1", assigneeUserId: "u2" } }, refs).body).toBe("Ada → Grace");
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "assigned", previousAssigneeUserId: null, assigneeUserId: "gone" } }, refs).body).toBe("Unassigned → a former member");
  });

  it("names the correlated alert", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "alert_correlated", alertEventId: "a1" } }, refs).body).toBe("Linked: API latency high");
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "alert_correlated", alertEventId: "x" } }, refs).body).toBeNull();
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "alert_correlated", alertEventId: "x", alertTitle: "Recorded name" } }, refs).body).toBe("Linked: Recorded name");
  });

  it("uses the user-facing status labels", () => {
    const event = { eventType: "state_change", eventData: { state: "incident_updated", previous: { status: "user_applying_fix" }, current: { status: "verifying" } } };
    expect(describeTimelineEvent(event).body).toBe("Status: Fixing → Monitoring");
  });
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
    // A brief row stored without a summary still gets a body.
    expect(
      describeTimelineEvent({
        eventType: "ai_finding",
        eventData: { type: "native_evidence_brief", suspectedFailureDomain: "network_dns", evidenceCount: 3, confidenceScore: 0.62 },
      }).body,
    ).toBe("3 evidence items reviewed; suspected failure domain: network dns; confidence 62%.");
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { type: "native_evidence_brief" } }).body).toBe("Evidence brief generated.");
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { type: "native_evidence_brief_failed", error: "Evidence brief generation failed" } }).body).toBe("Evidence brief generation failed");
    expect(describeTimelineEvent({ eventType: "some_event", eventData: null })).toEqual({ title: "some event", body: null });
  });

  it.each([
    ["sre_triage", "AI triage"],
    ["sre_investigation", "AI investigation"],
    ["sre_investigation_failed", "Investigation failed"],
    ["native_evidence_brief", "Evidence brief"],
    ["native_evidence_brief_failed", "Evidence brief failed"],
    ["unknown_kind", "AI finding"],
  ])("titles an AI row of type %s as %s", (type, title) => {
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { type, summary: "x" } }).title).toBe(title);
  });

  it("shows a report's summary paragraph, not its title, as the AI row body", () => {
    const summary = "# Incident Investigation Report\n\n## Report Details\n- **Severity**: sev2\n\n## Executive Summary\nThe job failed twice.";
    expect(describeTimelineEvent({ eventType: "ai_finding", eventData: { type: "sre_triage", summary } }).body).toBe("The job failed twice.");
  });
});

describe("IncidentTimeline", () => {
  it("does not call a capped timeline complete", () => {
    ready(Array.from({ length: 500 }, (_, i) => ev(`e${i}`, "comment", { text: `note ${i}` })));
    render(<IncidentTimeline incidentId="inc-1" canUpdate={false} />);
    expect(screen.getByRole("button", { name: "Show the 500 most recent events" })).toBeInTheDocument();
  });

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

  it("shows an error with retry, not the empty state, when the query throws", () => {
    const refetch = jest.fn();
    mockQuery = { isPending: false, isError: true, data: undefined, refetch };
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load the timeline.");
    expect(screen.queryByText("No activity yet.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("labels a failed AI triage", () => {
    expect(describeTimelineEvent({ eventType: "state_change", eventData: { state: "triage_failed", comment: "AI triage did not complete (agent_error)." } })).toEqual({
      title: "AI triage failed",
      body: "AI triage did not complete (agent_error).",
    });
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
    // Both the timeline and the detail (watch state) are refreshed.
    expect(mockInvalidate).toHaveBeenCalledTimes(2);
    expect(box).toHaveValue("");
  });

  it("offers the status page checkbox only when allowed, and sends the flag only when ticked", async () => {
    addUpdate.mockResolvedValue({ success: true });
    const { unmount } = render(<IncidentTimeline incidentId="i1" canUpdate />);
    expect(screen.queryByLabelText(/Also post to status page/)).not.toBeInTheDocument();
    unmount();
    render(<IncidentTimeline incidentId="i1" canUpdate canPostToStatusPage />);
    fireEvent.change(screen.getByPlaceholderText("Add a note for your team..."), { target: { value: "Customers affected" } });
    fireEvent.click(screen.getByLabelText(/Also post to status page/));
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(addUpdate).toHaveBeenCalledWith({ incidentId: "i1", text: "Customers affected", postToStatusPage: true }));
  });

  it("fills the box with an AI draft for the person to edit, and posts nothing by itself", async () => {
    (draftSreStatusUpdate as jest.Mock).mockResolvedValue({ success: true, text: "We are investigating elevated errors." });
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    fireEvent.click(screen.getByRole("button", { name: /Draft customer update with AI/ }));
    await waitFor(() => expect(screen.getByPlaceholderText("Add a note for your team...")).toHaveValue("We are investigating elevated errors."));
    expect(draftSreStatusUpdate).toHaveBeenCalledWith({ incidentId: "i1" });
    expect(addUpdate).not.toHaveBeenCalled();
  });

  it("locks the composer while a draft is generating so typed text is not overwritten", async () => {
    let finish: (value: unknown) => void = () => undefined;
    (draftSreStatusUpdate as jest.Mock).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    fireEvent.change(screen.getByPlaceholderText("Add a note for your team..."), { target: { value: "typing" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft customer update with AI/ }));
    expect(screen.getByPlaceholderText("Add a note for your team...")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add note" })).toBeDisabled();
    finish({ success: true, text: "Drafted" });
    await waitFor(() => expect(screen.getByPlaceholderText("Add a note for your team...")).toHaveValue("Drafted"));
    expect(screen.getByPlaceholderText("Add a note for your team...")).not.toBeDisabled();
  });

  it("toasts and leaves the box alone when drafting is refused", async () => {
    (draftSreStatusUpdate as jest.Mock).mockResolvedValue({ success: false, error: "AI drafts need a paid plan" });
    render(<IncidentTimeline incidentId="i1" canUpdate />);
    fireEvent.change(screen.getByPlaceholderText("Add a note for your team..."), { target: { value: "mine" } });
    fireEvent.click(screen.getByRole("button", { name: /Draft customer update with AI/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("AI drafts need a paid plan"));
    expect(screen.getByPlaceholderText("Add a note for your team...")).toHaveValue("mine");
  });

  it("warns when the note was saved but the status page post failed", async () => {
    addUpdate.mockResolvedValue({ success: true, warning: "The status page post failed: nope" });
    render(<IncidentTimeline incidentId="i1" canUpdate canPostToStatusPage />);
    fireEvent.change(screen.getByPlaceholderText("Add a note for your team..."), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("The status page post failed: nope"));
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
