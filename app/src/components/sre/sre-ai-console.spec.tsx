import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { archiveSreCopilotChat } from "@/actions/sre-ai";
import { SreAiConsole } from "./sre-ai-console";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@/actions/sre-ai", () => ({
  archiveSreCopilotChat: jest.fn(),
}));

jest.mock("@/components/sre/sre-assistant-ui-thread", () => ({
  SreAssistantUiThread: ({
    initialMessages,
    incidentId,
  }: {
    initialMessages: Array<{ content: string }>;
    incidentId?: string | null;
  }) => (
    <div data-testid="chat-thread" data-incident={incidentId ?? ""}>
      {initialMessages.map((message, index) => (
        <p key={`${message.content}-${index}`}>{message.content}</p>
      ))}
    </div>
  ),
}));

describe("SreAiConsole", () => {
  beforeEach(() => window.history.replaceState(null, "", "/copilot"));
  it("keeps New chat incident-scoped and preserves that scope in history", () => {
    window.history.replaceState(null, "", "/copilot?incident=incident-1");
    render(
      <SreAiConsole
        initialIncidentId="incident-1"
        initialHistories={[
          {
            conversationId: "general",
            incidentId: null,
            title: "General question",
            updatedAt: "2026-10-09",
            messages: [],
          },
          {
            conversationId: "incident-chat",
            incidentId: "incident-1",
            title: "Incident question",
            updatedAt: "2026-10-09",
            messages: [],
          },
        ]}
      />,
    );
    expect(screen.getByTestId("chat-thread")).toHaveAttribute(
      "data-incident",
      "incident-1",
    );
    expect(
      screen.getByRole("link", { name: "Back to incident" }),
    ).toHaveAttribute("href", "/incidents/incident-1");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(window.location.search).toBe("?incident=incident-1");
    expect(screen.getByTestId("chat-thread")).toHaveAttribute(
      "data-incident",
      "incident-1",
    );
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(screen.getByText("Incident question"));
    expect(window.location.search).toBe("?incident=incident-1");
    expect(screen.getByTestId("chat-thread")).toHaveAttribute(
      "data-incident",
      "incident-1",
    );
  });

  it("opens general chat from the sidebar even when an incident chat is newest", () => {
    render(
      <SreAiConsole
        initialHistories={[
          {
            conversationId: "incident-chat",
            incidentId: "incident-1",
            title: "Incident",
            updatedAt: "2026-10-09",
            messages: [],
          },
          {
            conversationId: "general",
            incidentId: null,
            title: "General",
            updatedAt: "2026-10-08",
            messages: [],
          },
        ]}
      />,
    );
    expect(screen.getByTestId("chat-thread")).toHaveAttribute(
      "data-incident",
      "",
    );
  });

  it("renders chat history and switches conversations", () => {
    render(
      <SreAiConsole
        initialHistories={[
          {
            conversationId: "018f0000-0000-7000-8000-000000000001",
            incidentId: null,
            title: "Checkout investigation",
            updatedAt: "2026-06-24T10:00:00.000Z",
            messages: [
              {
                id: "m1",
                role: "assistant",
                content: "Check database pool saturation.",
                modelId: "test-model",
              },
            ],
          },
          {
            conversationId: "018f0000-0000-7000-8000-000000000002",
            incidentId: null,
            title: "Search incident",
            updatedAt: "2026-06-24T11:00:00.000Z",
            messages: [
              {
                id: "m2",
                role: "assistant",
                content: "Check search index health.",
                modelId: "test-model",
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Checkout investigation")).toBeInTheDocument();
    expect(screen.getAllByText("Jun 24").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Check database pool saturation."),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Search history" }), {
      target: { value: "search index" },
    });
    expect(
      screen.queryByText("Checkout investigation"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Search incident"));

    expect(screen.getByText("Check search index health.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(
      screen.queryByText("Check search index health."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archive chat" }),
    ).not.toBeInTheDocument();
  });

  it("shows unavailable date copy for invalid history timestamps", () => {
    render(
      <SreAiConsole
        initialHistories={[
          {
            conversationId: "018f0000-0000-7000-8000-000000000001",
            incidentId: null,
            title: "Invalid date session",
            updatedAt: "not-a-date",
            messages: [
              {
                id: "m1",
                role: "assistant",
                content: "Check service health.",
                modelId: "test-model",
              },
            ],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.getByText("Date unavailable")).toBeInTheDocument();
  });

  it("archives the current chat and removes it from searchable history", async () => {
    jest.mocked(archiveSreCopilotChat).mockResolvedValue({ success: true });
    render(
      <SreAiConsole
        initialHistories={[
          {
            conversationId: "chat-1",
            incidentId: null,
            title: "Saved chat",
            updatedAt: "2026-06-24T10:00:00Z",
            messages: [],
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive chat" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Archive chat" }),
      ).not.toBeInTheDocument(),
    );
    expect(archiveSreCopilotChat).toHaveBeenCalledWith({
      conversationId: "chat-1",
    });
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByText("Saved chat")).not.toBeInTheDocument();
    expect(
      screen.getByText("Saved Copilot chats will appear here."),
    ).toBeInTheDocument();
  });

  it("keeps the incident link in the footer below the chat", () => {
    render(<SreAiConsole />);
    const link = screen.getByRole("link", {
      name: "Open an incident to ask about its evidence",
    });
    expect(link).toHaveAttribute("href", "/incidents");
    expect(link.closest("footer")).toBeInTheDocument();
    expect(link.closest("header")).toBeNull();
  });

  it("exposes saved chat history from one header control on all screen sizes", () => {
    render(<SreAiConsole />);

    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});
