import { SETUP_FEATURES, resolveSetupFeatures, type SetupFeatures } from "./features";

describe("resolveSetupFeatures", () => {
  it("returns the registry when AI is configured", () => {
    expect(resolveSetupFeatures({ aiConfigured: true })).toEqual(SETUP_FEATURES);
  });

  it("turns AI-backed features off when no provider is configured", () => {
    const resolved = resolveSetupFeatures({ aiConfigured: false, registry: { ...SETUP_FEATURES, aiTests: true, aiSre: true } });
    expect(resolved.aiTests).toBe(false);
    expect(resolved.aiSre).toBe(false);
    expect(resolved.heartbeat).toBe(true);
  });

  it("turns everything off when the master flag is off", () => {
    const registry: SetupFeatures = { ...SETUP_FEATURES, setup: false };
    expect(Object.values(resolveSetupFeatures({ aiConfigured: true, registry })).every((v) => v === false)).toBe(true);
  });
});
