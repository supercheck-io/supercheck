import { alertsRedirectTarget } from "./redirect-target";

describe("alertsRedirectTarget", () => {
  it.each([
    [{}, "/incidents?tab=alerts"],
    [{ tab: "signals" }, "/incidents?tab=alerts"],
    [{ tab: "history" }, "/incidents?tab=alerts&view=history"],
    [{ tab: "channels" }, "/notifications"],
    [{ tab: "providers" }, "/notifications"],
    [{ create: "true", type: "slack" }, "/notifications?create=true&type=slack"],
  ])("%j -> %s", (params, expected) => {
    expect(alertsRedirectTarget(params)).toBe(expected);
  });
});
