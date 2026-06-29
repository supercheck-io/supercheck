/** @jest-environment node */

import { NextRequest } from "next/server";

jest.mock("@/lib/project-context", () => ({
  requireProjectContext: jest.fn(),
}));

jest.mock("@/lib/rbac/middleware", () => ({
  checkPermissionWithContext: jest.fn(),
}));

jest.mock("@/lib/sre/sre-rate-limiter", () => ({
  checkSreChatRateLimit: jest.fn(),
}));

jest.mock("@/sre/lib/session-store", () => ({
  createSreConversation: jest.fn(),
  appendSreMessage: jest.fn(),
  getSreConversation: jest.fn(),
}));

jest.mock("@/sre/lib/agent-runner", () => ({
  runSreAgent: jest.fn(),
}));

jest.mock("@/sre/agents/triage", () => ({
  buildSreTriageSystemPrompt: jest.fn(() => "read-only system"),
}));

import { POST } from "./route";

const { requireProjectContext: mockRequireProjectContext } = jest.requireMock("@/lib/project-context") as {
  requireProjectContext: jest.Mock;
};
const { checkPermissionWithContext: mockCheckPermissionWithContext } = jest.requireMock("@/lib/rbac/middleware") as {
  checkPermissionWithContext: jest.Mock;
};
const { checkSreChatRateLimit: mockCheckSreChatRateLimit } = jest.requireMock("@/lib/sre/sre-rate-limiter") as {
  checkSreChatRateLimit: jest.Mock;
};
const {
  createSreConversation: mockCreateSreConversation,
  appendSreMessage: mockAppendSreMessage,
} = jest.requireMock("@/sre/lib/session-store") as {
  createSreConversation: jest.Mock;
  appendSreMessage: jest.Mock;
};
const { runSreAgent: mockRunSreAgent } = jest.requireMock("@/sre/lib/agent-runner") as {
  runSreAgent: jest.Mock;
};

async function responseText(response: Response) {
  return response.text();
}

describe("SRE chat API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireProjectContext.mockResolvedValue({
      userId: "018f0000-0000-7000-8000-000000000001",
      organizationId: "018f0000-0000-7000-8000-000000000002",
      project: { id: "018f0000-0000-7000-8000-000000000003", name: "Prod", organizationId: "018f0000-0000-7000-8000-000000000002" },
    });
    mockCheckPermissionWithContext.mockReturnValue(true);
    mockCheckSreChatRateLimit.mockResolvedValue({ allowed: true });
    mockCreateSreConversation.mockResolvedValue({
      id: "018f0000-0000-7000-8000-000000000004",
      incidentId: null,
      status: "active",
    });
    mockAppendSreMessage
      .mockResolvedValueOnce({ id: "018f0000-0000-7000-8000-000000000005", role: "user" })
      .mockResolvedValueOnce({ id: "018f0000-0000-7000-8000-000000000006", role: "assistant" });
    mockRunSreAgent.mockResolvedValue({ text: "Read-only guidance", modelId: "test-model", finishReason: "stop" });
  });

  it("streams conversation and assistant messages for authorized users", async () => {
    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Investigate checkout latency" }),
    }));

    const text = await responseText(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(text).toContain("event: conversation");
    expect(text).toContain("Read-only guidance");
    expect(mockRunSreAgent).toHaveBeenCalledWith(expect.objectContaining({ system: "read-only system" }));
  });

  it("rejects unauthorized users before creating conversations", async () => {
    mockCheckPermissionWithContext.mockReturnValue(false);

    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Investigate checkout latency" }),
    }));

    expect(response.status).toBe(403);
    expect(mockCreateSreConversation).not.toHaveBeenCalled();
  });

  it("passes read-only evidence tools for incident-scoped conversations", async () => {
    mockCreateSreConversation.mockResolvedValueOnce({
      id: "018f0000-0000-7000-8000-000000000004",
      incidentId: "018f0000-0000-7000-8000-000000000007",
      status: "active",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({
        incidentId: "018f0000-0000-7000-8000-000000000007",
        message: "Use evidence to triage",
      }),
    }));

    await responseText(response);

    expect(mockRunSreAgent).toHaveBeenCalledWith(expect.objectContaining({
      tools: expect.objectContaining({
        listNativeEvidence: expect.any(Object),
        listConnectorEvidence: expect.any(Object),
      }),
    }));
  });

  it("validates and redacts text attachments before prompt and persistence", async () => {
    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "Use this responder context",
        attachments: [
          {
            type: "text",
            title: "Responder token=secret-value",
            content: "Observed checkout errors with password=result-secret and Bearer abcdef1234567890",
          },
        ],
      }),
    }));

    await responseText(response);

    expect(response.status).toBe(200);
    expect(mockAppendSreMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "user",
      attachments: [expect.objectContaining({
        title: "Responder token=[REDACTED]",
        content: expect.stringContaining("password=[REDACTED]"),
      })],
    }));
    expect(mockRunSreAgent).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("User-provided context attachments"),
    }));
    expect(mockRunSreAgent.mock.calls[0][0].prompt).not.toContain("secret-value");
    expect(mockRunSreAgent.mock.calls[0][0].prompt).not.toContain("result-secret");
  });

  it("rejects malformed attachments", async () => {
    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "Use this responder context",
        attachments: [{ type: "file", title: "bad", content: "unsupported" }],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mockRunSreAgent).not.toHaveBeenCalled();
  });

  it("accepts server-issued file attachment metadata for the scoped incident", async () => {
    mockCreateSreConversation.mockResolvedValueOnce({
      id: "018f0000-0000-7000-8000-000000000004",
      incidentId: "018f0000-0000-7000-8000-000000000007",
      status: "active",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({
        incidentId: "018f0000-0000-7000-8000-000000000007",
        message: "Use this uploaded context",
        attachments: [{
          type: "file",
          title: "notes.txt",
          fileName: "notes.txt",
          mimeType: "text/plain",
          size: 12,
          storageBucket: "sre-chat-attachments",
          storagePath: "projects/018f0000-0000-7000-8000-000000000003/sre-chat/018f0000-0000-7000-8000-000000000007/file.txt",
          incidentId: "018f0000-0000-7000-8000-000000000007",
        }],
      }),
    }));

    await responseText(response);

    expect(response.status).toBe(200);
    expect(mockAppendSreMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: "user",
      attachments: [expect.objectContaining({
        type: "file",
        fileName: "notes.txt",
        note: expect.stringContaining("metadata only"),
      })],
    }));
    expect(mockRunSreAgent.mock.calls[0][0].prompt).toContain("File bytes are stored securely");
  });

  it("rejects file attachment metadata outside the scoped incident path", async () => {
    mockCreateSreConversation.mockResolvedValueOnce({
      id: "018f0000-0000-7000-8000-000000000004",
      incidentId: "018f0000-0000-7000-8000-000000000007",
      status: "active",
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({
        incidentId: "018f0000-0000-7000-8000-000000000007",
        message: "Use this uploaded context",
        attachments: [{
          type: "file",
          title: "notes.txt",
          fileName: "notes.txt",
          mimeType: "text/plain",
          size: 12,
          storageBucket: "sre-chat-attachments",
          storagePath: "projects/other/sre-chat/018f0000-0000-7000-8000-000000000007/file.txt",
          incidentId: "018f0000-0000-7000-8000-000000000007",
        }],
      }),
    }));

    const text = await responseText(response);

    expect(text).toContain("event: error");
    expect(text).toContain("Invalid SRE chat file attachment storage reference");
    expect(mockRunSreAgent).not.toHaveBeenCalled();
  });

  it("streams sanitized agent step metadata without raw tool payloads", async () => {
    mockRunSreAgent.mockImplementationOnce(async (input: { onStepFinish?: (event: unknown) => Promise<void> | void }) => {
      await input.onStepFinish?.({
        modelId: "test-model",
        stepIndex: 1,
        elapsedMs: 42,
        event: {
          toolCalls: [
            {
              toolCallId: "tool-call-1",
              toolName: "searchLiveConnectorEvidence",
              input: { token: "secret-value", query: "up{api_key=secret}" },
            },
          ],
          toolResults: [
            {
              toolCallId: "tool-call-1",
              output: {
                message: "Persisted 1 connector evidence item(s)",
                evidence: [
                  {
                    id: "ev-prometheus-latency",
                    title: "Latency spike token=secret-value",
                    evidenceType: "metric",
                    sourceType: "prometheus",
                    rawContentExcerpt: "password=result-secret",
                    citationQuery: "up{api_key=secret}",
                  },
                ],
              },
            },
          ],
        },
      });

      return { text: "Read-only guidance", modelId: "test-model", finishReason: "stop" };
    });

    const response = await POST(new NextRequest("http://localhost/api/sre/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Investigate checkout latency" }),
    }));

    const text = await responseText(response);

    expect(text).toContain("event: agent.step");
    expect(text).toContain("searchLiveConnectorEvidence");
    expect(text).toContain("tool-call-1");
    expect(text).toContain("ev-prometheus-latency");
    expect(text).toContain("Latency spike token=[REDACTED]");
    expect(text).not.toContain("secret-value");
    expect(text).not.toContain("result-secret");
    expect(text).not.toContain("api_key=secret");
    expect(text).not.toContain("password");
    expect(text).not.toContain("rawContentExcerpt");
    expect(text).not.toContain("citationQuery");
  });
});
