import { matchesSubscriptionScope } from "./subscription-scope";

describe("notification subscription scope", () => {
  const components = [{ subscriberId: "subscriber", componentId: "A" }];
  it("excludes an unrelated component", () => {
    expect(
      matchesSubscriptionScope(
        "subscriber",
        "incident",
        new Set(["B"]),
        components,
        [],
      ),
    ).toBe(false);
  });
  it("includes a matching component or explicit incident subscription", () => {
    expect(
      matchesSubscriptionScope(
        "subscriber",
        "incident",
        new Set(["A"]),
        components,
        [],
      ),
    ).toBe(true);
    expect(
      matchesSubscriptionScope(
        "subscriber",
        "incident",
        new Set(["B"]),
        components,
        [{ subscriberId: "subscriber", incidentId: "incident" }],
      ),
    ).toBe(true);
  });
  it("keeps page-wide subscriptions and excludes unrelated incident-only subscriptions", () => {
    expect(
      matchesSubscriptionScope("subscriber", "incident", new Set(), [], []),
    ).toBe(true);
    expect(
      matchesSubscriptionScope(
        "subscriber",
        "incident",
        new Set(),
        [],
        [{ subscriberId: "subscriber", incidentId: "other" }],
      ),
    ).toBe(false);
  });
});
