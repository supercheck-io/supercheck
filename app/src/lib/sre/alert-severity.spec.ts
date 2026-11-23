import { alertSeverity, isMoreSevere } from "./alert-severity";

describe("alertSeverity", () => {
  it("maps each alert type explicitly, keeping the previous defaults", () => {
    expect(alertSeverity("job_timeout")).toBe("sev1");
    expect(alertSeverity("monitor_failure")).toBe("sev2");
    expect(alertSeverity("job_failed")).toBe("sev2");
    expect(alertSeverity("ssl_expiring")).toBe("sev3");
    expect(alertSeverity("monitor_warning")).toBe("sev4");
    expect(alertSeverity("something_new")).toBe("sev4");
  });

  it("orders severities with sev1 the most severe", () => {
    expect(isMoreSevere("sev1", "sev2")).toBe(true);
    expect(isMoreSevere("sev3", "sev2")).toBe(false);
    expect(isMoreSevere("sev2", "sev2")).toBe(false);
  });
});
