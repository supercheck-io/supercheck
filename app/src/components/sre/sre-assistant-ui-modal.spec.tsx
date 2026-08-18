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
      const [threadState, setThreadState] = React.useState(0);

      return (
        <div
          data-testid="copilot-thread"
          data-conversation-id={conversationId ?? ""}
          data-incident-id={incidentId ?? ""}
        >
          Copilot thread mounted
          <span>Thread state {threadState}</span>
          <button
            type="button"
            onClick={() => setThreadState((current) => current + 1)}
          >
            Change thread state
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

  it("preserves the mounted thread when the first response resolves its conversation", async () => {
    render(<SreAssistantUiModal />);

    fireEvent.click(screen.getByRole("button", { name: "Open Copilot" }));
    const thread = await screen.findByTestId("copilot-thread");

    fireEvent.click(
      screen.getByRole("button", { name: "Change thread state" }),
    );
    expect(thread).toHaveTextContent("Thread state 1");

    fireEvent.click(
      screen.getByRole("button", { name: "Resolve conversation" }),
    );

    expect(thread).toHaveAttribute("data-conversation-id", "conversation-1");
    expect(thread).toHaveTextContent("Thread state 1");
  });

  it("does not render the launcher for viewers", () => {
    mockUserRole = "project_viewer";

    render(<SreAssistantUiModal />);

    expect(
      screen.queryByRole("button", { name: "Open Copilot" }),
    ).not.toBeInTheDocument();
  });
});
