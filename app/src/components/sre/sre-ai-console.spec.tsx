import { fireEvent, render, screen } from "@testing-library/react";

import { SreAiConsole } from "./sre-ai-console";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: jest.fn() }),
}));

jest.mock("@/actions/sre-ai", () => ({
  archiveSreStandaloneChat: jest.fn(),
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
            messages: [{ id: "m1", role: "assistant", content: "Check database pool saturation.", modelId: "test-model" }],
          },
          {
            conversationId: "018f0000-0000-7000-8000-000000000002",
            title: "Search incident",
            updatedAt: "2026-06-24T11:00:00.000Z",
            messages: [{ id: "m2", role: "assistant", content: "Check search index health.", modelId: "test-model" }],
          },
        ]}
      />
    );

    expect(screen.getByText("Checkout investigation")).toBeInTheDocument();
    expect(screen.getAllByText("Jun 24").length).toBeGreaterThan(0);
    expect(screen.getByText("Check database pool saturation.")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Search incident"));

    expect(screen.getByText("Check search index health.")).toBeInTheDocument();
  });
});
