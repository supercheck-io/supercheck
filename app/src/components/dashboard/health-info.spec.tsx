import { render, screen } from "@testing-library/react";
import { HEALTH_INFO, HealthInfo } from "./health-info";

describe("HealthInfo", () => {
  it("renders an accessible trigger", () => {
    render(<HealthInfo />);
    expect(screen.getByRole("button", { name: HEALTH_INFO.ariaLabel })).toBeTruthy();
  });
  it("states the 24 hour window for job runs", () => {
    expect(HEALTH_INFO.bullets.join(" ")).toContain("last 24 hours");
  });
});
