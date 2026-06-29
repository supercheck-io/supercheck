import { fireEvent, render, screen } from "@testing-library/react";

import { SreChatInput } from "./chat-input";
import { extractSreEvidenceCitations, SreChatMessageList } from "./chat-message-list";

describe("SRE chat UI components", () => {
  it("renders empty and populated message states", () => {
    const { rerender } = render(
      <SreChatMessageList messages={[]} emptyTitle="No messages" emptyDescription="Ask a question." />
    );

    expect(screen.getByText("No messages")).toBeInTheDocument();

    rerender(
      <SreChatMessageList
        messages={[{ id: "message-1", role: "assistant", content: "Read-only finding", modelId: "test-model" }]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
      />
    );

    expect(screen.getByText("SRE AI")).toBeInTheDocument();
    expect(screen.getByText("Read-only finding")).toBeInTheDocument();
    expect(screen.getByText("test-model")).toBeInTheDocument();
  });

  it("renders assistant pending marker while a response is streaming", () => {
    render(
      <SreChatMessageList
        messages={[{ id: "message-1", role: "user", content: "Why is checkout failing?" }]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
        isAssistantPending
        pendingLabel="Checking recent monitor evidence..."
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking recent monitor evidence...");
    expect(screen.getByText("Working")).toBeInTheDocument();
  });

  it("extracts bounded assistant evidence citations", () => {
    expect(
      extractSreEvidenceCitations(
        "Supported by ev-monitor-timeout, connector_1234567890abcdef, and evidence id: 018f6d6f-7b8a-7c9d-8e0f-123456789abc. Repeat ev-monitor-timeout.",
      ),
    ).toEqual(["ev-monitor-timeout", "connector_1234567890abcdef", "018f6d6f-7b8a-7c9d-8e0f-123456789abc"]);
  });

  it("renders citation chips for assistant evidence only", () => {
    render(
      <SreChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Finding cites ev-monitor-timeout and citation: 018f6d6f-7b8a-7c9d-8e0f-123456789abc." },
          { id: "message-2", role: "user", content: "User pasted ev-user-supplied" },
        ]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
      />
    );

    expect(screen.getByText("Cited evidence")).toBeInTheDocument();
    expect(screen.getByText("ev-monitor-timeout")).toBeInTheDocument();
    expect(screen.getByText("018f6d6f-7b8a-7c9d-8e0f-123456789abc")).toBeInTheDocument();
    expect(screen.queryByText("ev-user-supplied")).not.toBeInTheDocument();
  });

  it("links citation chips when incident evidence references are available", () => {
    render(
      <SreChatMessageList
        messages={[
          { id: "message-1", role: "assistant", content: "Finding cites ev-monitor-timeout and ev-unmatched." },
        ]}
        evidenceReferences={[{ id: "ev-monitor-timeout", title: "Monitor timeout", evidenceType: "event" }]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
      />
    );

    const matchedLink = screen.getByRole("link", { name: "ev-monitor-timeout" });
    expect(matchedLink).toHaveAttribute("href", "#sre-evidence-ev-monitor-timeout");
    expect(matchedLink).toHaveAttribute("title", "Monitor timeout (event)");
    expect(screen.getByText("ev-unmatched").closest("a")).toBeNull();
  });

  it("submits chat input and updates value", () => {
    const onChange = jest.fn();
    const onSubmit = jest.fn();

    render(
      <SreChatInput
        value="Investigate checkout"
        onChange={onChange}
        onSubmit={onSubmit}
        isPending={false}
        placeholder="Ask"
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Ask"), { target: { value: "New question" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask SRE AI" }));

    expect(onChange).toHaveBeenCalledWith("New question");
    expect(onSubmit).toHaveBeenCalled();
  });

  it("submits chat input with Enter and keeps Shift+Enter for newlines", () => {
    const onSubmit = jest.fn();

    render(
      <SreChatInput
        value="Investigate checkout"
        onChange={jest.fn()}
        onSubmit={onSubmit}
        isPending={false}
        placeholder="Ask"
      />
    );

    const input = screen.getByPlaceholderText("Ask");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
