import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { HeartbeatPingHistory, heartbeatResultKind, rowsThatFit, type HeartbeatResultRow } from "./heartbeat-ping-history";
import { HeartbeatStateBadge, heartbeatStateLabel } from "./heartbeat-state-badge";

const row = (id: string, isUp: boolean, details?: Record<string, unknown>, responseTimeMs: number | null = null): HeartbeatResultRow => ({
  id,
  checkedAt: "2026-11-13T02:04:00.000Z",
  isUp,
  responseTimeMs,
  details,
});

const props = { isLoading: false, page: 1, totalPages: 1, total: 0, onPageChange: jest.fn() };

describe("HeartbeatPingHistory", () => {
  it("shows ping, failed and missed rows with duration and client", () => {
    render(
      <HeartbeatPingHistory
        {...props}
        total={3}
        results={[
          row("a", true, { heartbeat: { kind: "ping", userAgent: "curl/8.7.1" } }, 248_000),
          row("b", false, { heartbeat: { kind: "fail", userAgent: "curl/8.7.1" } }, 12_000),
          row("c", false, { heartbeat: { kind: "missed" } }),
        ]}
      />,
    );
    const rows = screen.getAllByTestId("heartbeat-ping-row");
    expect(rows.map((r) => r.getAttribute("data-kind"))).toEqual(["ping", "fail", "missed"]);
    expect(within(rows[0]).getByText("OK")).toBeInTheDocument();
    expect(within(rows[0]).getByText("4 min 08 s")).toBeInTheDocument();
    expect(within(rows[0]).getByText("curl/8.7.1")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Failed")).toBeInTheDocument();
    expect(within(rows[1]).getByText("12 s")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Missed")).toBeInTheDocument();
    expect(within(rows[2]).getByText("No ping before the grace period ended")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 recent pings.")).toBeInTheDocument();
  });

  it("shows a dash for a run without /start and a dash for a missing client", () => {
    render(<HeartbeatPingHistory {...props} total={2} results={[row("a", true, { heartbeat: { kind: "ping" } }), row("c", false, { heartbeat: { kind: "missed" } })]} />);
    const rows = screen.getAllByTestId("heartbeat-ping-row");
    const cells = within(rows[0]).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("—");
    expect(cells[3]).toHaveTextContent("—");
    expect(within(rows[1]).getAllByRole("cell")[2]).toHaveTextContent("—");
  });

  it("falls back to up/down for rows without heartbeat details", () => {
    expect(heartbeatResultKind(row("x", true))).toEqual({ kind: "ping", userAgent: null });
    expect(heartbeatResultKind(row("y", false, { heartbeat: { kind: "other" } }))).toEqual({ kind: "missed", userAgent: null });
  });

  it("shows loading, empty and error states", () => {
    const onRetry = jest.fn();
    const { rerender } = render(<HeartbeatPingHistory {...props} results={[]} isLoading />);
    expect(screen.getByLabelText("Loading ping history")).toBeInTheDocument();
    rerender(<HeartbeatPingHistory {...props} results={[]} />);
    expect(screen.getByTestId("heartbeat-ping-history-empty")).toHaveTextContent("No pings yet");
    expect(screen.getByTestId("heartbeat-ping-history-empty")).toHaveTextContent("curl -fsS");
    rerender(<HeartbeatPingHistory {...props} results={[]} error={new Error("x")} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("pages through the history", () => {
    const onPageChange = jest.fn();
    render(<HeartbeatPingHistory {...props} results={[row("a", true)]} total={1} page={2} totalPages={3} onPageChange={onPageChange} />);
    expect(screen.getByText("Showing 1 of 1 recent ping.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(onPageChange.mock.calls).toEqual([[1], [3]]);
  });
});

describe("HeartbeatStateBadge", () => {
  it.each([
    ["up", "Up"],
    ["late", "Late"],
    ["down", "Down"],
    ["pending", "Pending"],
    ["paused", "Paused"],
  ] as const)("shows %s as a word, not colour alone", (state, label) => {
    render(<HeartbeatStateBadge state={state} />);
    const badge = screen.getByTestId("heartbeat-state-badge");
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute("data-state", state);
    expect(heartbeatStateLabel(state)).toBe(label);
  });

  it("uses the warning tone for Late", () => {
    render(<HeartbeatStateBadge state="late" />);
    expect(screen.getByTestId("heartbeat-state-badge").className).toMatch(/amber/);
  });
});

describe("rowsThatFit", () => {
  it("reserves the header and pager and clamps to 5..50 rows", () => {
    // 40 header + 58 pager leave 410px: 10 rows of 41px.
    expect(rowsThatFit(508, 41)).toBe(10);
    expect(rowsThatFit(508, 41)).toBe(rowsThatFit(508, 41));
    expect(rowsThatFit(120, 41)).toBe(5);
    expect(rowsThatFit(10_000, 41)).toBe(50);
    expect(rowsThatFit(0)).toBe(5);
    expect(rowsThatFit(Number.NaN)).toBe(5);
  });
});
