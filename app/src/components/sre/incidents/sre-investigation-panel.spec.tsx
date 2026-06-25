import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { parseSreSseEvents } from "@/components/sre/sre-sse-client";

jest.mock("@/actions/sre-incidents", () => ({
  archiveSreIncidentChatConversation: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

import { archiveSreIncidentChatConversation } from "@/actions/sre-incidents";

import { SreInvestigationPanel } from "./sre-investigation-panel";

const mockArchiveSreIncidentChatConversation = archiveSreIncidentChatConversation as jest.Mock;

describe("parseSreSseEvents", () => {
  it("parses complete SSE blocks and keeps partial remainder", () => {
    const parsed = parseSreSseEvents(
      'event: conversation\ndata: {"id":"conversation-1"}\n\nevent: message\ndata: {"role":"assistant","content":"hello"}\n\nevent: message\ndata:'
    );

    expect(parsed.events).toEqual([
      { event: "conversation", data: { id: "conversation-1" } },
      { event: "message", data: { role: "assistant", content: "hello" } },
    ]);
    expect(parsed.remaining).toBe("event: message\ndata:");
  });

  it("returns null data for malformed JSON blocks", () => {
    const parsed = parseSreSseEvents("event: error\ndata: not-json\n\n");

    expect(parsed.events).toEqual([{ event: "error", data: null }]);
    expect(parsed.remaining).toBe("");
  });
});

describe("SreInvestigationPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArchiveSreIncidentChatConversation.mockResolvedValue({ success: true });
  });

  it("hydrates saved incident chat messages", () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        evidenceReferences={[{ id: "ev-monitor-timeout", title: "Monitor timeout", evidenceType: "event" }]}
        initialConversationId="018f0000-0000-7000-8000-000000000002"
        initialMessages={[
          { id: "message-1", role: "user", content: "What happened?" },
          { id: "message-2", role: "assistant", content: "Finding cites ev-monitor-timeout.\n- Verify monitor recovery", modelId: "test-model" },
        ]}
        chatHistories={[
          {
            conversationId: "018f0000-0000-7000-8000-000000000002",
            title: "Incident investigation",
            updatedAt: new Date("2026-06-24T12:00:00Z"),
            messages: [
              { id: "message-1", role: "user", content: "What happened?", modelId: null },
              { id: "message-2", role: "assistant", content: "Finding cites ev-monitor-timeout.\n- Verify monitor recovery", modelId: "test-model" },
            ],
          },
        ]}
      />
    );

    expect(screen.getByText("Conversation")).toBeInTheDocument();
    expect(screen.getByText("What happened?")).toBeInTheDocument();
    expect(screen.getByText("Finding cites ev-monitor-timeout.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ev-monitor-timeout" })).toHaveAttribute("href", "#sre-evidence-ev-monitor-timeout");
    expect(screen.getByText("Verify monitor recovery")).toBeInTheDocument();
    expect(screen.getByLabelText("Optional context attachment")).toBeInTheDocument();
    expect(screen.getByText("Text notes are limited to 2,000 characters. File uploads are stored separately and passed to the AI as metadata only.")).toBeInTheDocument();
    expect(screen.getByLabelText("Optional file attachment")).toBeInTheDocument();
  });

  it("archives the selected incident chat conversation", async () => {
    render(
      <SreInvestigationPanel
        incidentId="018f0000-0000-7000-8000-000000000001"
        hasPrimaryService={true}
        initialConversationId="018f0000-0000-7000-8000-000000000002"
        initialMessages={[{ id: "message-1", role: "user", content: "What happened?" }]}
        chatHistories={[
          {
            conversationId: "018f0000-0000-7000-8000-000000000002",
            title: "Incident investigation",
            updatedAt: new Date("2026-06-24T12:00:00Z"),
            messages: [{ id: "message-1", role: "user", content: "What happened?", modelId: null }],
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /archive/i }));

    await waitFor(() => {
      expect(mockArchiveSreIncidentChatConversation).toHaveBeenCalledWith({
        incidentId: "018f0000-0000-7000-8000-000000000001",
        conversationId: "018f0000-0000-7000-8000-000000000002",
      });
    });
  });
});
