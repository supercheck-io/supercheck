import { fireEvent, render, screen } from "@testing-library/react";

import { SreChatInput } from "./chat-input";
import { extractSreEvidenceCitations, SreChatMessageList } from "./chat-message-list";

beforeAll(() => {
  const resizeObserverEntry = (target: Element): ResizeObserverEntry => ({
    target,
    contentRect: {
      x: 0,
      y: 0,
      width: 640,
      height: 224,
      top: 0,
      right: 640,
      bottom: 224,
      left: 0,
      toJSON: () => ({}),
    } as DOMRectReadOnly,
    borderBoxSize: [],
    contentBoxSize: [],
    devicePixelContentBoxSize: [],
  });

  class ResizeObserverMock {
    constructor(private readonly callback: ResizeObserverCallback) {}

    observe(target: Element) {
      this.callback([resizeObserverEntry(target)], this as unknown as ResizeObserver);
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  }

  global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
});

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

    expect(screen.getByText("Copilot")).toBeInTheDocument();
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

  it("renders SRE prompt suggestions inside the empty transcript", () => {
    const onSuggestionSelect = jest.fn();

    render(
      <SreChatMessageList
        messages={[]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
        suggestions={["Inspect system health."]}
        onSuggestionSelect={onSuggestionSelect}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Inspect system health/i }));

    expect(onSuggestionSelect).toHaveBeenCalledWith("Inspect system health.");
  });

  it("renders common assistant markdown without exposing raw formatting markers", () => {
    render(
      <SreChatMessageList
        messages={[{ id: "message-1", role: "assistant", content: "1. **Check recent monitoring data**: Review latency.\n- Confirm error rate." }]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
      />
    );

    expect(screen.getByText("Check recent monitoring data")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*Check recent monitoring data\*\*/)).not.toBeInTheDocument();
    expect(screen.getByText("Confirm error rate.")).toBeInTheDocument();
  });

  it("renders structured assistant tables and code blocks", () => {
    render(
      <SreChatMessageList
        messages={[
          {
            id: "message-1",
            role: "assistant",
            content: "```bash\nkubectl get pods\n```\n\n| Signal | State |\n| --- | --- |\n| p95 latency | elevated |",
          },
        ]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
      />
    );

    expect(screen.getByText("bash")).toBeInTheDocument();
    expect(screen.getByText("kubectl get pods")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Signal" })).toBeInTheDocument();
    expect(screen.getByText("p95 latency")).toBeInTheDocument();
    expect(screen.queryByText("| --- | --- |")).not.toBeInTheDocument();
  });

  it("renders safe assistant chart blocks", () => {
    render(
      <SreChatMessageList
        messages={[
          {
            id: "message-1",
            role: "assistant",
            content:
              '```chart\n{"type":"bar","title":"Error budget burn","xKey":"service","series":[{"key":"burn","label":"Burn"}],"data":[{"service":"checkout","burn":2.4}]}\n```',
          },
        ]}
        emptyTitle="No messages"
        emptyDescription="Ask a question."
      />
    );

    expect(screen.getByText("Error budget burn")).toBeInTheDocument();
    expect(screen.queryByText(/```chart/)).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Ask Copilot" }));

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
