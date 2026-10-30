import { act, render } from "@testing-library/react";
import { PerformanceTestReport, MAX_CONSOLE_BUFFER_CHARS, CONSOLE_TRUNCATED_NOTICE } from "./performance-test-report";
import { fetchK6RunDetails } from "@/lib/k6-runs";

jest.mock("@/lib/k6-runs", () => ({
  ...jest.requireActual("@/lib/k6-runs"),
  fetchK6RunDetails: jest.fn(),
}));
let viewerContent = "";
jest.mock("@/components/k6/monaco-console-viewer", () => ({
  MonacoConsoleViewer: ({ content }: { content: string }) => {
    viewerContent = content;
    return null;
  },
}));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  static last: FakeEventSource;
  listeners: Record<string, Array<(e?: unknown) => void>> = {};
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(t: string, cb: (e?: unknown) => void) {
    (this.listeners[t] ??= []).push(cb);
  }
  removeEventListener() {}
  close() {}
}

it("polls run status while the stream is reconnecting and reaches a terminal state", async () => {
  jest.useFakeTimers();
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  const onStatusChange = jest.fn();
  const mock = fetchK6RunDetails as jest.Mock;
  mock.mockResolvedValue({ status: "running", runStatus: "running" });

  render(<PerformanceTestReport runId="run-1" onStatusChange={onStatusChange} />);
  await act(async () => {});
  // Browser keeps retrying (readyState CONNECTING), so the component never reconnects itself.
  act(() => FakeEventSource.last.listeners.error.forEach((cb) => cb()));

  mock.mockResolvedValue({ status: "passed", runStatus: "passed", reportS3Url: "r" });
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  await act(async () => {});

  expect(onStatusChange).toHaveBeenCalledWith("passed", expect.anything());
  jest.useRealTimers();
});

it("keeps polling across a reconnect until the new stream opens", async () => {
  jest.useFakeTimers();
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  const onStatusChange = jest.fn();
  const mock = fetchK6RunDetails as jest.Mock;
  mock.mockResolvedValue({ status: "running", runStatus: "running" });

  render(<PerformanceTestReport runId="run-2" onStatusChange={onStatusChange} />);
  await act(async () => {});
  const first = FakeEventSource.last;
  first.readyState = FakeEventSource.CLOSED;
  act(() => first.listeners.error.forEach((cb) => cb()));
  await act(async () => {
    jest.advanceTimersByTime(1_000); // reconnect replaces the source
  });
  expect(FakeEventSource.last).not.toBe(first);

  mock.mockResolvedValue({ status: "passed", runStatus: "passed", reportS3Url: "r" });
  await act(async () => {
    jest.advanceTimersByTime(10_000);
  });
  await act(async () => {});
  expect(onStatusChange).toHaveBeenCalledWith("passed", expect.anything());
  jest.useRealTimers();
});

it("marks the console buffer when its start is dropped", async () => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  (fetchK6RunDetails as jest.Mock).mockResolvedValue({ status: "running", runStatus: "running" });
  render(<PerformanceTestReport runId="run-3" />);
  await act(async () => {});
  const send = (line: string) =>
    act(() => FakeEventSource.last.listeners.console.forEach((cb) => cb({ data: JSON.stringify({ line }) })));
  send("a".repeat(MAX_CONSOLE_BUFFER_CHARS));
  expect(viewerContent.startsWith(CONSOLE_TRUNCATED_NOTICE)).toBe(false);
  send("tail");
  expect(viewerContent.startsWith(CONSOLE_TRUNCATED_NOTICE)).toBe(true);
  expect(viewerContent.endsWith("tail")).toBe(true);
});
