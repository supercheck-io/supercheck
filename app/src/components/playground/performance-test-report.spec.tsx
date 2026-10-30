import { act, render } from "@testing-library/react";
import { PerformanceTestReport } from "./performance-test-report";
import { fetchK6RunDetails } from "@/lib/k6-runs";

jest.mock("@/lib/k6-runs", () => ({
  ...jest.requireActual("@/lib/k6-runs"),
  fetchK6RunDetails: jest.fn(),
}));
jest.mock("@/components/k6/monaco-console-viewer", () => ({ MonacoConsoleViewer: () => null }));
jest.mock("@/components/shared/report-viewer", () => ({ ReportViewer: () => null }));

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  static last: FakeEventSource;
  listeners: Record<string, Array<() => void>> = {};
  constructor() {
    FakeEventSource.last = this;
  }
  addEventListener(t: string, cb: () => void) {
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
