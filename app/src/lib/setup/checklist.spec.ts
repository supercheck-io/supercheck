import { deriveChecklist, type SetupCounts } from "./checklist";
import { SETUP_FEATURES, resolveSetupFeatures } from "./features";

const zero: SetupCounts = {
  monitors: 0, heartbeatMonitors: 0, notificationProviders: 0, statusPages: 0, requirements: 0, tests: 0, jobs: 0,
  connectorsOrAgents: 0, services: 0, membersAndInvites: 1, cliTokens: 0, pushDevices: 0,
};
const features = resolveSetupFeatures({ aiConfigured: true });
const doneKeys = (c: ReturnType<typeof deriveChecklist>) => c.items.filter((i) => i.done).map((i) => i.key);

describe("deriveChecklist", () => {
  it("ticks nothing for an empty project (the caller alone is not a team)", () => {
    const c = deriveChecklist(zero, features, false);
    expect(c.done).toBe(0);
    expect(c.total).toBe(c.items.length);
  });

  it("derives ticks from counts", () => {
    const c = deriveChecklist({ ...zero, monitors: 2, tests: 1, membersAndInvites: 2, cliTokens: 1 }, features, false);
    expect(doneKeys(c)).toEqual(["monitors", "tests", "team", "cliToken"]);
  });

  it("counts the status page opt-out as done", () => {
    expect(doneKeys(deriveChecklist(zero, features, true))).toEqual(["statusPage"]);
  });

  it("neither shows nor counts items whose flag is off", () => {
    const off = resolveSetupFeatures({ aiConfigured: true, registry: { ...SETUP_FEATURES, heartbeat: false, aiSre: false, aiTests: false, mobile: false, maintenance: false } });
    const c = deriveChecklist({ ...zero, heartbeatMonitors: 3, services: 3, requirements: 3, pushDevices: 3 }, off, false);
    expect(c.items.map((i) => i.key)).not.toEqual(expect.arrayContaining(["heartbeat"]));
    for (const key of ["heartbeat", "connectors", "services", "requirements", "mobile"]) {
      expect(c.items.find((i) => i.key === key)).toBeUndefined();
    }
    expect(c.done).toBe(0);
    expect(c.nextSteps.find((s) => s.key === "maintenance")).toBeUndefined();
  });

  it("lists next steps for enabled flags", () => {
    expect(deriveChecklist(zero, features, false).nextSteps.map((s) => s.key)).toEqual(["incident", "maintenance", "codingRecipe"]);
  });
});
