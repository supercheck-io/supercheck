import { render, screen } from "@testing-library/react";
import { HEALTH_THRESHOLDS as T } from "@/lib/dashboard/system-health";
import { HEALTH_INFO, HealthInfo } from "./health-info";

describe("HealthInfo", () => {
  it("renders an accessible trigger", () => {
    render(<HealthInfo />);
    expect(screen.getByRole("button", { name: HEALTH_INFO.ariaLabel })).toBeTruthy();
  });
  it("states the 24 hour window for job runs", () => {
    expect(HEALTH_INFO.bullets.join(" ")).toContain("last 24 hours");
  });
  it("builds the copy from the threshold constants", () => {
    const text = HEALTH_INFO.bullets.join(" ");
    expect(text).toContain(`last ${T.failedRunsWindowHours} hours`);
    expect(text).toContain(`${Math.round(T.queueNearCapacityRatio * 100)}%`);
    expect(text).toContain(`more than ${T.queuedBacklog} queued runs`);
    expect(text).toContain(`more than ${T.queuedBacklogHigh} is high`);
    expect(text).toContain(`more than ${T.failedRunsHigh} is high`);
  });
});
