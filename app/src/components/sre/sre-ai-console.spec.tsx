import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { archiveSreStandaloneChat } from "@/actions/sre-ai";
import { SreAiConsole } from "./sre-ai-console";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@/actions/sre-ai", () => ({
  archiveSreStandaloneChat: jest.fn(),
}));

jest.mock("@/components/sre/sre-assistant-ui-thread", () => ({
  SreAssistantUiThread: ({
    initialMessages,
  }: {
    initialMessages: Array<{ content: string }>;
  }) => (
    <div>
      {initialMessages.map((message, index) => (
        <p key={`${message.content}-${index}`}>{message.content}</p>
      ))}
    </div>
  ),
}));

describe("SreAiConsole", () => {
  it("renders chat history and switches conversations", () => {
    render(
      <SreAiConsole
        initialHistories={[
          {
            conversationId: "018f0000-0000-7000-8000-000000000001",
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
    jest.mocked(archiveSreStandaloneChat).mockResolvedValue({ success: true });
    render(
      <SreAiConsole
        initialHistories={[
          {
            conversationId: "chat-1",
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
    expect(archiveSreStandaloneChat).toHaveBeenCalledWith({
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
