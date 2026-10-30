import { isActionableAlertForIncident } from "./alert-escalation";

describe("isActionableAlertForIncident", () => {
  it.each([
    ["sent", "monitor_failure", "Down", true],
    ["sent", "ssl_expiring", "Certificate expires in 7 days", true],
    // A failure that quotes an earlier successful run is still a failure.
    ["sent", "job_failed", "Step 2 failed; step 1 completed successfully", true],
    ["sent", "monitor_recovery", "Back up", false],
    ["sent", "job_success", "Done", false],
    ["failed", "monitor_failure", "Down", false],
    ["sent", "legacy_job", "Job completed successfully", false],
  ])("%s %s -> %s", (status, type, message, expected) => {
    expect(isActionableAlertForIncident(status, type, message)).toBe(expected);
  });
});
