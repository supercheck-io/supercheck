import { fireEvent, render, screen } from "@testing-library/react";

import { SreAssistantUiModal } from "./sre-assistant-ui-modal";

let mockPathname = "/dashboard";
let mockUserRole = "project_admin";

jest.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

jest.mock("@/hooks/use-project-context", () => ({
  useProjectContext: () => ({
    currentProject: { id: "project-1", userRole: mockUserRole },
  }),
}));

jest.mock("@/components/sre/sre-assistant-ui-thread", () => {
  const React = jest.requireActual<typeof import("react")>("react");

  return {
    SreAssistantUiThread: ({
      conversationId,
      incidentId,
      onConversationResolved,
    }: {
      conversationId: string | null;
      incidentId?: string | null;
      onConversationResolved: (input: {
        conversationId: string;
        messages: [];
        title: string;
      }) => void;
    }) => {
      const [visibleMessages, setVisibleMessages] = React.useState<string[]>([]);

      return (
        <div
          data-testid="copilot-thread"
          data-conversation-id={conversationId ?? ""}
          data-incident-id={incidentId ?? ""}
        >
          Copilot thread mounted
          <span data-testid="visible-thread-messages">
            {visibleMessages.join(" | ")}
          </span>
          <button
            type="button"
            onClick={() =>
              setVisibleMessages([
                "What is the pod phase?",
                "The checkout pod is Running.",
              ])
            }
          >
            Complete first response
          </button>
          <button
            type="button"
            onClick={() =>
              onConversationResolved({
                conversationId: "conversation-1",
                messages: [],
                title: "Resolved chat",
              })
            }
          >
            Resolve conversation
          </button>
        </div>
      );
    },
  };
});

describe("SreAssistantUiModal", () => {
  beforeEach(() => {
    mockPathname = "/dashboard";
    mockUserRole = "project_admin";
  });

  it("renders the floating Copilot launcher and opens the chat panel", async () => {
    render(<SreAssistantUiModal />);

    const launcher = screen.getByRole("button", { name: "Open Copilot" });
    expect(launcher).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(launcher);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(launcher).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("heading", { name: "Copilot" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Copilot thread mounted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /full view/i })).toHaveAttribute(
      "href",
      "/copilot",
    );
  });

  it("passes incident context to the floating Copilot on incident detail pages", async () => {
    const incidentId = "019f4256-106b-75c1-8671-acd6d7bfaea4";
    mockPathname = `/incidents/${incidentId}`;

    render(<SreAssistantUiModal />);

    fireEvent.click(screen.getByRole("button", { name: "Open Copilot" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Copilot thread mounted")).toHaveAttribute(
      "data-incident-id",
      incidentId,
    );
  });

  it("keeps first-response messages visible when the conversation id resolves", async () => {
    render(<SreAssistantUiModal />);

    fireEvent.click(screen.getByRole("button", { name: "Open Copilot" }));
    const thread = await screen.findByTestId("copilot-thread");

    fireEvent.click(
      screen.getByRole("button", { name: "Complete first response" }),
    );
    expect(screen.getByTestId("visible-thread-messages")).toHaveTextContent(
      "What is the pod phase? | The checkout pod is Running.",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Resolve conversation" }),
    );

    expect(thread).toHaveAttribute("data-conversation-id", "conversation-1");
    expect(screen.getByTestId("visible-thread-messages")).toHaveTextContent(
      "What is the pod phase? | The checkout pod is Running.",
    );
  });

  it("does not render the launcher for viewers", () => {
    mockUserRole = "project_viewer";

    render(<SreAssistantUiModal />);

    expect(
      screen.queryByRole("button", { name: "Open Copilot" }),
    ).not.toBeInTheDocument();
  });
});
