import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getSreCopilotChatHistories } from "@/actions/sre-ai";
import { SreCopilotPageClient } from "./sre-copilot-page-client";

jest.mock("@/actions/sre-ai", () => ({
  getSreCopilotChatHistories: jest.fn(),
}));

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({
    projectId: "project-1",
    currentProject: { id: "project-1", userRole: "project_admin" },
  }),
}));

jest.mock("@/components/sre/sre-ai-console", () => ({
  SreAiConsole: ({
    initialHistories,
    onRequestHistoryRefresh,
  }: {
    initialHistories?: Array<{ conversationId: string; title: string | null }>;
    onRequestHistoryRefresh?: () => void;
  }) => (
    <div>
      <button type="button" onClick={() => onRequestHistoryRefresh?.()}>
        Open history
      </button>
      {initialHistories?.map((history) => (
        <p key={history.conversationId}>{history.title}</p>
      ))}
    </div>
  ),
}));

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
    },
  });
}

function renderClient(client = makeClient()) {
  return render(
    <QueryClientProvider client={client}>
      <SreCopilotPageClient />
    </QueryClientProvider>,
  );
}

describe("SreCopilotPageClient history refresh", () => {
  beforeEach(() => {
    jest.mocked(getSreCopilotChatHistories).mockReset();
  });

  it("refetches once per history-sheet open and surfaces a chat abandoned mid-stream", async () => {
    jest
      .mocked(getSreCopilotChatHistories)
      .mockResolvedValueOnce({
        success: true,
        histories: [
          {
            conversationId: "saved-chat",
            incidentId: null,
            title: "Saved chat",
            updatedAt: "2026-10-09T10:00:00.000Z",
            messages: [],
          },
        ],
      })
      .mockResolvedValue({
        success: true,
        histories: [
          {
            conversationId: "abandoned-chat",
            incidentId: null,
            title: "Question abandoned mid-stream",
            updatedAt: "2026-10-10T10:00:00.000Z",
            messages: [],
          },
          {
            conversationId: "saved-chat",
            incidentId: null,
            title: "Saved chat",
            updatedAt: "2026-10-09T10:00:00.000Z",
            messages: [],
          },
        ],
      });

    renderClient();

    expect(await screen.findByText("Saved chat")).toBeInTheDocument();
    expect(getSreCopilotChatHistories).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));

    await waitFor(() =>
      expect(
        screen.getByText("Question abandoned mid-stream"),
      ).toBeInTheDocument(),
    );
    expect(screen.getAllByText("Question abandoned mid-stream")).toHaveLength(1);
    expect(screen.getAllByText("Saved chat")).toHaveLength(1);
    expect(getSreCopilotChatHistories).toHaveBeenCalledTimes(2);

    // The sheet staying open must not trigger further refetches.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(getSreCopilotChatHistories).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: "Open history" }));
    await waitFor(() =>
      expect(getSreCopilotChatHistories).toHaveBeenCalledTimes(3),
    );
  });
});
