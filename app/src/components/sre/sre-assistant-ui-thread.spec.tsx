import { fireEvent, render, screen } from "@testing-library/react";

import {
  formatCopilotError,
  getQuickRepliesForAssistantText,
} from "./sre-generative-ui";
import { CopilotChatHelp } from "./sre-copilot-chat-help";

describe("CopilotChatHelp", () => {
  it("explains useful questions, evidence boundaries, live sources, and read-only safety", () => {
    render(<CopilotChatHelp />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Copilot chat help" }),
    );

    expect(
      screen.getByRole("heading", { name: "Using Copilot chat" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Good questions to ask")).toBeInTheDocument();
    expect(screen.getByText("What Copilot can use")).toBeInTheDocument();
    expect(screen.getByText("Where answers come from")).toBeInTheDocument();
    expect(
      screen.getByText(/does not automatically inspect an incident/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-only by design")).toBeInTheDocument();
    expect(screen.getByText("Live sources")).toBeInTheDocument();
    expect(
      screen.getByText(
        /cannot restart workloads, edit configuration, delete data/i,
      ),
    ).toBeInTheDocument();
  });
});

describe("getQuickRepliesForAssistantText", () => {
  it("suggests read-only recovery prompts after failures", () => {
    const replies = getQuickRepliesForAssistantText(
      "Connector check failed with a timeout while collecting evidence.",
    );

    expect(replies.map((reply) => reply.label)).toEqual([
      "Retry read-only check",
      "Try without connectors",
      "Show evidence",
    ]);
    expect(
      replies.every((reply) => !/delete|restart|patch/i.test(reply.prompt)),
    ).toBe(true);
    expect(replies.find((reply) => reply.label === "Try without connectors"))
      .toEqual(expect.objectContaining({ disableLiveConnectors: true }));
  });

  it("suggests chart rendering for metric-heavy answers", () => {
    const replies = getQuickRepliesForAssistantText(
      "The p95 latency and memory metrics changed over the last 15 minutes.",
    );

    expect(replies).toContainEqual(
      expect.objectContaining({ label: "Render chart", intent: "chart" }),
    );
  });

  it("marks check replies so the UI can distinguish read-only checks", () => {
    const replies = getQuickRepliesForAssistantText(
      "The leading hypothesis needs verification against evidence.",
    );

    expect(replies).toContainEqual(
      expect.objectContaining({
        label: "Check hypothesis",
        intent: "check",
      }),
    );
  });
});

describe("SRE assistant-ui prompt helpers", () => {
  it("formats JSON API errors as readable UI messages", () => {
    expect(
      formatCopilotError(new Error('{"error":"Invalid Copilot chat request"}')),
    ).toBe("Invalid Copilot chat request");
  });

});
