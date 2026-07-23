import { fireEvent, render, screen } from "@testing-library/react";

import {
  buildAttachmentContextPrompt,
  createUserPromptMessage,
  formatCopilotError,
  isSupportedCopilotAttachment,
  getQuickRepliesForAssistantText,
  SRE_INLINE_CAPABILITIES_PREVIEW,
} from "./sre-generative-ui";
import { CopilotChatHelp } from "./sre-copilot-chat-help";

describe("CopilotChatHelp", () => {
  it("explains commands, evidence boundaries, attachments, and read-only safety", () => {
    render(<CopilotChatHelp />);

    fireEvent.click(
      screen.getByRole("button", { name: "Open Copilot chat help" }),
    );

    expect(
      screen.getByRole("heading", { name: "Using Copilot chat" }),
    ).toBeInTheDocument();
    expect(screen.getByText("/health")).toBeInTheDocument();
    expect(screen.getByText("/investigate")).toBeInTheDocument();
    expect(screen.getByText("/evidence")).toBeInTheDocument();
    expect(screen.getByText("/verify")).toBeInTheDocument();
    expect(screen.getByText("Context and files")).toBeInTheDocument();
    expect(screen.getByText("Where answers come from")).toBeInTheDocument();
    expect(
      screen.getByText(/does not automatically inspect an incident/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Read-only by design")).toBeInTheDocument();
    expect(
      screen.getByText(/cannot restart workloads, edit configuration, delete data/i),
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
  });

  it("suggests chart rendering for metric-heavy answers", () => {
    const replies = getQuickRepliesForAssistantText(
      "The p95 latency and memory metrics changed over the last 15 minutes.",
    );

    expect(replies).toContainEqual(
      expect.objectContaining({ label: "Render chart", intent: "chart" }),
    );
  });

  it("marks verification replies so the UI can distinguish read-only checks", () => {
    const replies = getQuickRepliesForAssistantText(
      "The leading hypothesis needs verification against evidence.",
    );

    expect(replies).toContainEqual(
      expect.objectContaining({
        label: "Verify hypothesis",
        intent: "verify",
      }),
    );
  });
});

describe("SRE assistant-ui prompt helpers", () => {
  it("builds assistant-ui append messages with text content parts", () => {
    expect(createUserPromptMessage("/health Inspect current health")).toEqual({
      role: "user",
      content: [{ type: "text", text: "/health Inspect current health" }],
    });
  });

  it("formats JSON API errors as readable UI messages", () => {
    expect(
      formatCopilotError(new Error('{"error":"Invalid Copilot chat request"}')),
    ).toBe("Invalid Copilot chat request");
  });

  it("keeps deterministic inline preview content for chart QA", () => {
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain("```chart");
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"type":"line"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"type":"bar"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"type":"area"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain('"sources"');
    expect(SRE_INLINE_CAPABILITIES_PREVIEW).toContain("Generated preview data");
  });

  it("accepts only text-like Copilot attachments", () => {
    expect(
      isSupportedCopilotAttachment({
        name: "pod-restarts.log",
        type: "text/plain",
      }),
    ).toBe(true);
    expect(
      isSupportedCopilotAttachment({
        name: "metrics.json",
        type: "application/json",
      }),
    ).toBe(true);
    expect(
      isSupportedCopilotAttachment({
        name: "screenshot.png",
        type: "image/png",
      }),
    ).toBe(false);
  });

  it("formats dropped attachment context as read-only evidence", () => {
    const context = buildAttachmentContextPrompt([
      {
        fileName: "kubectl-top.txt",
        mimeType: "text/plain",
        size: 128,
        content: "pod checkout-api 772Mi",
      },
    ]);

    expect(context).toContain("user-provided attachment context");
    expect(context).toContain("Attachment 1: kubectl-top.txt");
    expect(context).toContain("```text");
    expect(context).toContain("pod checkout-api 772Mi");
  });
});
