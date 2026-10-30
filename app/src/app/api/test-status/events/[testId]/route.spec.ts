/** @jest-environment node */

jest.mock("@/utils/db", () => ({
  db: {
    query: {
      reports: {
        findFirst: jest.fn(),
      },
      tests: {
        findFirst: jest.fn(),
      },
      runs: {
        findFirst: jest.fn(),
      },
    },
  },
}));

jest.mock("@/lib/queue-event-hub", () => ({
  getQueueEventHub: jest.fn(),
}));

jest.mock("@/lib/auth-context", () => ({
  requireAuthContext: jest.fn(),
}));

import { db } from "@/utils/db";
import { getQueueEventHub } from "@/lib/queue-event-hub";
import { requireAuthContext } from "@/lib/auth-context";
import { GET } from "./route";
import { shouldStreamTestStatusEvent } from "./route.helpers";
import {
  fetchEventStatusReport,
  fetchInitialStatusReport,
} from "./route.helpers";

const mockReportsFindFirst = db.query.reports.findFirst as jest.Mock;
const mockRunsFindFirst = db.query.runs.findFirst as jest.Mock;
const mockTestsFindFirst = db.query.tests.findFirst as jest.Mock;
const mockGetQueueEventHub = getQueueEventHub as jest.Mock;
const mockRequireAuthContext = requireAuthContext as jest.Mock;

describe("test-status event filtering", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accepts Playwright-style test events", () => {
    expect(
      shouldStreamTestStatusEvent(
        {
          category: "test",
          entityId: undefined,
          queueJobId: "test-1",
        },
        "test-1"
      )
    ).toBe(true);
  });

  it("accepts K6 single-test events when the queue event resolves the test ID", () => {
    expect(
      shouldStreamTestStatusEvent(
        {
          category: "job",
          entityId: "test-1",
          queueJobId: "run-1",
        },
        "test-1"
      )
    ).toBe(true);
  });

  it("rejects unrelated job events even if the queue job id happens to match", () => {
    expect(
      shouldStreamTestStatusEvent(
        {
          category: "job",
          entityId: "job-1",
          queueJobId: "test-1",
        },
        "test-1"
      )
    ).toBe(false);
  });

  it("loads K6 single-test reports by run id for job events", async () => {
    const k6Report = {
      reportPath: "run-1/report",
      s3Url: "https://example.com/run-1/report",
      status: "passed",
    };

    mockRunsFindFirst.mockResolvedValue({ id: "run-1" });
    mockReportsFindFirst.mockResolvedValue(k6Report);

    await expect(
      fetchEventStatusReport("test-1", "project-1", {
        category: "job",
        queueJobId: "run-1",
      })
    ).resolves.toEqual(k6Report);

    expect(mockRunsFindFirst).toHaveBeenCalledTimes(1);
    expect(mockReportsFindFirst).toHaveBeenCalledTimes(1);
  });

  it("falls back to the latest K6 report when no Playwright report exists", async () => {
    const k6Report = {
      reportPath: "run-2/report",
      s3Url: "https://example.com/run-2/report",
      status: "passed",
    };

    mockReportsFindFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(k6Report);
    mockRunsFindFirst.mockResolvedValue({ id: "run-2" });

    await expect(
      fetchInitialStatusReport("test-1", "project-1")
    ).resolves.toEqual(k6Report);

    expect(mockReportsFindFirst).toHaveBeenCalledTimes(2);
    expect(mockRunsFindFirst).toHaveBeenCalledTimes(1);
  });

  it("returns a blocked run snapshot when no report will be generated", async () => {
    mockReportsFindFirst
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    mockRunsFindFirst.mockResolvedValue({
      id: "run-3",
      status: "blocked",
      errorDetails:
        "Monthly spending limit of $320.00 reached. Current spending: $320.76.",
    });

    await expect(
      fetchInitialStatusReport("test-1", "project-1")
    ).resolves.toEqual({
      status: "blocked",
      errorDetails:
        "Monthly spending limit of $320.00 reached. Current spending: $320.76.",
    });

    expect(mockReportsFindFirst).toHaveBeenCalledTimes(2);
    expect(mockRunsFindFirst).toHaveBeenCalledTimes(1);
  });

  it("reconciles a persisted terminal report when no queue event arrives", async () => {
    jest.useFakeTimers();
    try {
      const unsubscribe = jest.fn();
      mockRequireAuthContext.mockResolvedValue({
        organizationId: "org-1",
        project: { id: "project-1" },
      });
      mockTestsFindFirst.mockResolvedValue({ id: "test-1" });
      mockGetQueueEventHub.mockReturnValue({
        ready: jest.fn().mockResolvedValue(undefined),
        subscribe: jest.fn().mockReturnValue(unsubscribe),
      });
      mockReportsFindFirst
        .mockResolvedValueOnce({
          status: "running",
          reportPath: "test-1/report",
          s3Url: null,
        })
        .mockResolvedValueOnce({
          status: "passed",
          reportPath: "test-1/report",
          s3Url: "https://example.com/test-1/report/index.html",
        });

      const abortController = new AbortController();
      const response = await GET(
        new Request("http://localhost/api/test-status/events/test-1", {
          signal: abortController.signal,
        })
      );
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();

      const decoder = new TextDecoder();
      expect(decoder.decode((await reader!.read()).value)).toBe(
        ": connected\n\n"
      );
      expect(decoder.decode((await reader!.read()).value)).toContain(
        '"derivedStatus":"running"'
      );

      await jest.advanceTimersByTimeAsync(3000);
      const reconciled = decoder.decode((await reader!.read()).value);
      expect(reconciled).toContain('"derivedStatus":"passed"');
      expect(reconciled).toContain('"reportStatus":"passed"');

      abortController.abort();
      await jest.runOnlyPendingTimersAsync();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});


describe("test-status stream lifecycle", () => {
  const open = async () => {
    jest.clearAllMocks();
    const unsubscribe = jest.fn();
    const hub = {
      ready: jest.fn().mockResolvedValue(undefined),
      subscribe: jest.fn().mockReturnValue(unsubscribe),
    };
    mockRequireAuthContext.mockResolvedValue({
      organizationId: "org-1",
      project: { id: "project-1" },
    });
    mockTestsFindFirst.mockResolvedValue({ id: "test-1" });
    mockGetQueueEventHub.mockReturnValue(hub);
    const response = await GET(
      new Request("http://localhost/api/test-status/events/test-1")
    );
    return { reader: response.body!.getReader(), hub, unsubscribe };
  };
  const decoder = new TextDecoder();

  it("closes the stream and stops reconciling after a terminal status", async () => {
    jest.useFakeTimers();
    try {
      mockReportsFindFirst.mockResolvedValue({ status: "passed", reportPath: "p" });
      const { reader, unsubscribe } = await open();
      await reader.read(); // connected
      expect(decoder.decode((await reader.read()).value)).toContain('"derivedStatus":"passed"');
      expect((await reader.read()).done).toBe(true);
      expect(unsubscribe).toHaveBeenCalledTimes(1);

      mockReportsFindFirst.mockClear();
      await jest.advanceTimersByTimeAsync(10000);
      expect(mockReportsFindFirst).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("closes a never-finishing stream after the max lifetime", async () => {
    jest.useFakeTimers();
    try {
      mockReportsFindFirst.mockResolvedValue({ status: "running", reportPath: "p" });
      const { reader, unsubscribe } = await open();
      await reader.read();
      await reader.read();
      await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + 1);
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("holds back a queue 'completed' event until the report outcome is known", async () => {
    jest.useFakeTimers();
    try {
      mockReportsFindFirst.mockResolvedValue(undefined);
      // First lookup is the playground-run access gate; later ones find no run.
      mockRunsFindFirst.mockResolvedValueOnce({ id: "run-1" }).mockResolvedValue(undefined);
      const { reader, hub } = await open();
      await reader.read(); // connected
      const w = await reader.read();
            expect(decoder.decode(w.value)).toContain('"waiting"');

      const send = hub.subscribe.mock.calls[0][0];
      await send({ category: "test", entityId: "test-1", queueJobId: "test-1", status: "completed" });

      // Report lands; reconcile emits the real outcome instead of a premature "completed".
      mockReportsFindFirst.mockResolvedValue({ status: "passed", reportPath: "p" });
      await jest.advanceTimersByTimeAsync(3000);
      const chunk = decoder.decode((await reader.read()).value);
      expect(chunk).toContain('"derivedStatus":"passed"');
      expect(chunk).not.toContain('"derivedStatus":"completed"');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("text playground identifiers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireAuthContext.mockResolvedValue({ organizationId: "org", project: { id: "project" } });
    mockGetQueueEventHub.mockReturnValue({ ready: async () => {} });
  });

  it("keeps a text playground identifier usable without querying a UUID column", async () => {
    mockRunsFindFirst.mockResolvedValue({ id: "playground-run" });
    const response = await GET(new Request("http://localhost/api/test-status/events/playground-123", { signal: AbortSignal.abort() }));
    expect(response.status).toBe(200);
    expect(mockTestsFindFirst).not.toHaveBeenCalled();
    expect(mockRunsFindFirst).toHaveBeenCalledTimes(1);
    await response.body?.cancel();
  });

  it("returns 404 for an unknown text identifier after the scoped playground lookup", async () => {
    mockRunsFindFirst.mockResolvedValue(undefined);
    expect((await GET(new Request("http://localhost/api/test-status/events/unknown"))).status).toBe(404);
    expect(mockTestsFindFirst).not.toHaveBeenCalled();
    expect(mockRunsFindFirst).toHaveBeenCalledTimes(1);
  });
});
