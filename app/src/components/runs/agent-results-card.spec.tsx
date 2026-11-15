import { render, screen, within } from "@testing-library/react";
import { AgentResultsCard } from "./agent-results-card";

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

it("shows pass rate, attempts, tokens, slowest attempt, tools and failures as text", () => {
  render(<AgentResultsCard agent={agent} />);
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
  const { container, rerender } = render(<AgentResultsCard agent={null} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<AgentResultsCard agent={{ tests: [] }} />);
  expect(container).toBeEmptyDOMElement();
});

it("shows a skeleton while loading and a message on error", () => {
  const { rerender } = render(<AgentResultsCard loading />);
  expect(screen.getByTestId("agent-results-loading")).toBeInTheDocument();
  rerender(<AgentResultsCard error />);
  expect(screen.getByText("Could not load agent results.")).toBeInTheDocument();
});

it("says so when no tools were reported and wraps long text for narrow screens", () => {
  render(<AgentResultsCard agent={{ tests: [{ title: "t", attempts: 1, passed: 1, passRate: 1 }] }} />);
  expect(screen.getByText("None reported")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "t" })).toHaveClass("break-words");
  expect(screen.getByText("Pass rate").parentElement?.parentElement).toHaveClass("grid-cols-2");
});
