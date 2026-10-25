import { getAlertTypeLabel } from "./data";

describe("getAlertTypeLabel", () => {
  it("uses the known label for built-in alert types", () => {
    expect(getAlertTypeLabel("monitor_failure")).toBe("Monitor Failure");
    expect(getAlertTypeLabel("ssl_expiring")).toBe("SSL Expiring");
  });

  it("title-cases unknown types", () => {
    expect(getAlertTypeLabel("custom_event_type")).toBe("Custom Event Type");
  });
});
