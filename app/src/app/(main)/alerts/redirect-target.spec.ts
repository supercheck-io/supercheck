import { alertsRedirectTarget } from "./redirect-target";

describe("alertsRedirectTarget", () => {
  it.each([
    [{}, "/notifications?tab=history"],
    [{ tab: "signals" }, "/notifications?tab=history"],
    [{ tab: "history" }, "/notifications?tab=history"],
    [{ tab: "channels" }, "/notifications"],
    [{ tab: "providers" }, "/notifications"],
    [{ create: "true", type: "slack" }, "/notifications?create=true&type=slack"],
  ])("%j -> %s", (params, expected) => {
    expect(alertsRedirectTarget(params)).toBe(expected);
  });
});
