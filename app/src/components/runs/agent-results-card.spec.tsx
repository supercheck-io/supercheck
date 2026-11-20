import { fireEvent, render, screen, within } from "@testing-library/react";
import { AgentResultsButton } from "./agent-results-card";

/** The summary lives in a popover, so tests open it first. */
const renderOpen = (ui: React.ReactElement) => {
  const view = render(ui);
  fireEvent.click(screen.getByTestId("agent-results-button"));
  return view;
};

const agent = {
  tests: [
    {
      title: "bot answers refunds",
      attempts: 10,
      passed: 8,
      passRate: 0.8,
      totalTokens: 1200,
      judgeTokens: 300,
      slowestMs: 4200,
      toolNames: ["lookup_order", "send_email"],
      failures: [{ attempt: 3, message: "<b>expected 30 days</b>" }],
    },
  ],
};

it("renders repeated attempt numbers and tool names without duplicate key warnings", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => {});
  renderOpen(<AgentResultsButton agent={{ tests: [{ title: "t", attempts: 2, passed: 0, passRate: 0, toolNames: ["a", "a"], failures: [{ attempt: 1, message: "x" }, { attempt: 1, message: "y" }] }] }} />);
  expect(spy.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  spy.mockRestore();
});

it("shows pass rate, attempts, tokens, slowest attempt, tools and failures as text", () => {
  renderOpen(<AgentResultsButton agent={agent} />);
  const card = screen.getByTestId("agent-results-card");
  expect(within(card).getByText("80%")).toBeInTheDocument();
  expect(within(card).getByText("8 of 10 passed")).toBeInTheDocument();
  expect(within(card).getByText("1500")).toBeInTheDocument();
  expect(within(card).getByText("4.2 s")).toBeInTheDocument();
  expect(within(card).getByText("lookup_order")).toBeInTheDocument();
  expect(within(card).getByTestId("agent-results-failures")).toHaveTextContent("Attempt 3: <b>expected 30 days</b>");
  expect(card.querySelector("b")).toBeNull();
});

it("renders nothing without a summary", () => {
  const { container, rerender } = render(<AgentResultsButton agent={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<AgentResultsButton agent={{ tests: [] }} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows a skeleton while loading and a message on error", () => {
  const { rerender } = renderOpen(<AgentResultsButton loading />);
  expect(screen.getByTestId("agent-results-loading")).toBeInTheDocument();
  rerender(<AgentResultsButton error />);
  expect(screen.getByText("Could not load agent results.")).toBeInTheDocument();
});

it("says so when no tools were reported and wraps long text for narrow screens", () => {
  renderOpen(<AgentResultsButton agent={{ tests: [{ title: "t", attempts: 1, passed: 1, passRate: 1 }] }} />);
  expect(screen.getByText("None reported")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "t" })).toHaveClass("break-words");
  expect(screen.getByText("Pass rate").parentElement?.parentElement).toHaveClass("grid-cols-2");
});

it("keeps the summary in a popover and flags failed attempts on the button", () => {
  render(<AgentResultsButton agent={agent} />);
  expect(screen.queryByTestId("agent-results-card")).toBeNull();
  expect(screen.getByTestId("agent-results-button")).toHaveTextContent("(some attempts failed)");
  fireEvent.click(screen.getByTestId("agent-results-button"));
  expect(screen.getByTestId("agent-results-card")).toHaveTextContent("Agent results");
});

it("does not flag a run where every attempt passed", () => {
  render(<AgentResultsButton agent={{ tests: [{ title: "t", attempts: 2, passed: 2, passRate: 1 }] }} />);
  expect(screen.getByTestId("agent-results-button")).toHaveTextContent("Agent results");
  expect(screen.getByTestId("agent-results-button")).not.toHaveTextContent("failed");
});
