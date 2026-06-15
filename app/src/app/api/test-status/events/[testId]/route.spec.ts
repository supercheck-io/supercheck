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
import { shouldStreamTestStatusEvent } from "./route.helpers";
import {
  fetchEventStatusReport,
  fetchInitialStatusReport,
} from "./route.helpers";

const mockReportsFindFirst = db.query.reports.findFirst as jest.Mock;
const mockRunsFindFirst = db.query.runs.findFirst as jest.Mock;

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
});
