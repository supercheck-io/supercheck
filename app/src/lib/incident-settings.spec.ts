jest.mock("@/utils/db", () => ({ db: {} }));
import { incidentsEnabled } from "./incident-settings";
import { enabledAlertConfigError } from "./monitor-write";

describe("incidentsEnabled", () => {
  it("defaults on with alerts on and opt-in with alerts off", () => {
    expect(incidentsEnabled({ enabled: true })).toBe(true);
    expect(incidentsEnabled({ enabled: true, incidentEnabled: false })).toBe(false);
    expect(incidentsEnabled({ enabled: false })).toBe(false);
    expect(incidentsEnabled({ enabled: false, incidentEnabled: true })).toBe(true);
    expect(incidentsEnabled(null)).toBe(false);
  });
});

describe("enabledAlertConfigError without channels", () => {
  const base = { enabled: true, notificationProviders: [], alertOnFailure: true, alertOnRecovery: false, alertOnSslExpiration: false, failureThreshold: 1, recoveryThreshold: 1, customMessage: "" };
  it("requires a channel only when incidents are off", () => {
    expect(enabledAlertConfigError({ ...base, incidentEnabled: false })).toMatch(/notification channel/);
    expect(enabledAlertConfigError({ ...base })).toBeNull();
    expect(enabledAlertConfigError({ ...base, incidentEnabled: true })).toBeNull();
  });
});
