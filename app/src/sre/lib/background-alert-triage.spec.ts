jest.mock("@/sre/lib/feature-gates", () => ({
  isSreBackgroundAlertTriageEnabled: jest.fn(),
}));

jest.mock("@/utils/db", () => ({
  db: {
    select: jest.fn(),
  },
}));

import { isSreBackgroundAlertTriageEnabled } from "@/sre/lib/feature-gates";
import { db } from "@/utils/db";
import { processSreBackgroundAlertTriageJob } from "./background-alert-triage";

const mockIsSreBackgroundAlertTriageEnabled = isSreBackgroundAlertTriageEnabled as jest.Mock;
const mockDb = db as jest.Mocked<typeof db>;

describe("processSreBackgroundAlertTriageJob", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(false);
  });

  it("skips without database access when background triage is disabled", async () => {
    const result = await processSreBackgroundAlertTriageJob({
      alertHistoryId: "018f0000-0000-7000-8000-000000000001",
    });

    expect(result).toEqual({ success: true, skipped: true, reason: "disabled" });
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("skips invalid jobs without database access", async () => {
    mockIsSreBackgroundAlertTriageEnabled.mockReturnValue(true);

    const result = await processSreBackgroundAlertTriageJob({ alertHistoryId: "not-a-uuid" });

    expect(result).toEqual({ success: true, skipped: true, reason: "invalid_job" });
    expect(mockDb.select).not.toHaveBeenCalled();
  });
});
