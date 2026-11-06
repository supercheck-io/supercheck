import { describeServiceSignals } from "./service-health-explanation";

describe("describeServiceSignals", () => {
  it.each([
    [{ activeIncidents: 0, firingAlerts: 1, critical: true }, "1 firing alert is linked to this service; at least one is SEV1 or SEV2."],
    [{ activeIncidents: 1, firingAlerts: 0, critical: false }, "1 active incident is linked to this service."],
    [{ activeIncidents: 2, firingAlerts: 0, critical: false }, "2 active incidents are linked to this service."],
    [{ activeIncidents: 1, firingAlerts: 3, critical: false }, "1 active incident and 3 firing alerts are linked to this service."],
  ])("describes %o", (input, expected) => {
    expect(describeServiceSignals(input)).toBe(expected);
  });
});
