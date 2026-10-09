import { fireEvent, render, screen } from "@testing-library/react";

import {
  formatCopilotError,
  getQuickRepliesForAssistantText,
} from "./sre-generative-ui";
import { CopilotChatHelp } from "./sre-copilot-chat-help";
import { SreAssistantUiThread } from "./sre-assistant-ui-thread";
import { AssistantChatTransport } from "@assistant-ui/react-ai-sdk";
import { useProjectContext } from "@/hooks/use-project-context";

jest.mock("@assistant-ui/react", () => ({
  AssistantRuntimeProvider: () => null,
}));

jest.mock("@assistant-ui/react-ai-sdk", () => ({
  AssistantChatTransport: jest.fn(),
  useChatRuntime: jest.fn(() => ({})),
}));

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: jest.fn(),
}));

describe("Incident Copilot live sources", () => {
  it.each([
    { role: "project_admin", incidentId: "incident", enabled: true },
    { role: "project_editor", incidentId: "incident", enabled: false },
    { role: "project_admin", incidentId: null, enabled: true },
  ])(
    "defaults live access according to role in all chats (%j)",
    ({ role, incidentId, enabled }) => {
      jest.mocked(useProjectContext).mockReturnValue({
        currentProject: { userRole: role },
      } as ReturnType<typeof useProjectContext>);

      render(
        <SreAssistantUiThread
          conversationId={null}
          incidentId={incidentId}
          initialMessages={[]}
          onConversationResolved={jest.fn()}
          onClearError={jest.fn()}
          onError={jest.fn()}
        />,
      );

      expect(AssistantChatTransport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            incidentId,
            useLiveConnectorTools: enabled,
          }),
        }),
      );
    },
  );
});

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
      screen.getByText(/saved evidence from that incident/i),
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
    expect(
      replies.find((reply) => reply.label === "Try without connectors"),
    ).toEqual(expect.objectContaining({ disableLiveConnectors: true }));
  });

  it("suggests chart rendering only when metric answers contain a numeric series", () => {
    const replies = getQuickRepliesForAssistantText(
      "Checkout p95 latency was 240 ms at 10:00 and 310 ms at 10:05.",
    );

    expect(replies).toContainEqual(
      expect.objectContaining({ label: "Render chart", intent: "chart" }),
    );
  });

  it("does not add generic follow-ups or chart actions without evidence values", () => {
    const replies = getQuickRepliesForAssistantText(
      "No supporting evidence is available for checkout-api latency or error rate.",
    );

    expect(replies).toEqual([]);
  });

  it("does not mistake numbered diagnostic steps for a numeric metric series", () => {
    const replies = getQuickRepliesForAssistantText(
      [
        "I currently have no evidence regarding the health of checkout-api.",
        "1. **Recent Logs**: Look for errors and warnings.",
        "2. **Service Metrics**: Inspect response time and error rates.",
        "3. **Health Checks**: Verify whether health checks are passing.",
      ].join("\n"),
    );

    expect(replies).not.toContainEqual(
      expect.objectContaining({ label: "Render chart" }),
    );
  });

  it("offers connector recovery and evidence follow-ups in general chats too", () => {
    expect(
      getQuickRepliesForAssistantText("Connector check failed with a timeout."),
    ).toContainEqual(
      expect.objectContaining({
        label: "Try without connectors",
        disableLiveConnectors: true,
      }),
    );
    expect(
      getQuickRepliesForAssistantText(
        "The leading hypothesis needs verification against evidence.",
      ),
    ).toContainEqual(expect.objectContaining({ label: "Check hypothesis" }));
    expect(
      getQuickRepliesForAssistantText(
        "Checkout p95 latency was 240 ms at 10:00 and 310 ms at 10:05.",
      ),
    ).toEqual([expect.objectContaining({ label: "Render chart" })]);
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
