jest.mock("@/utils/db", () => ({ db: {} }));
import { channelsOptional, incidentsEnabled } from "./incident-settings";
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

describe("channelsOptional", () => {
  it("is true only when a failure still opens an incident", () => {
    expect(channelsOptional({ enabled: false, incidentEnabled: true })).toBe(true);
    expect(channelsOptional({ enabled: true, alertOnFailure: true })).toBe(true);
    // SSL-only alerts have nowhere to go without a channel.
    expect(channelsOptional({ enabled: true, alertOnFailure: false })).toBe(false);
    expect(channelsOptional({ enabled: true, alertOnFailure: true, incidentEnabled: false })).toBe(false);
    expect(channelsOptional({ enabled: false })).toBe(false);
  });
});

describe("enabledAlertConfigError without channels", () => {
  const base = { enabled: true, notificationProviders: [], alertOnFailure: true, alertOnRecovery: false, alertOnSslExpiration: false, failureThreshold: 1, recoveryThreshold: 1, customMessage: "" };
  it("requires a channel only when incidents are off", () => {
    expect(enabledAlertConfigError({ ...base, incidentEnabled: false })).toMatch(/notification channel/);
    expect(enabledAlertConfigError({ ...base })).toBeNull();
    expect(enabledAlertConfigError({ ...base, incidentEnabled: true })).toBeNull();
    expect(enabledAlertConfigError({ ...base, alertOnFailure: false, alertOnSslExpiration: true })).toMatch(/notification channel/);
  });
});
