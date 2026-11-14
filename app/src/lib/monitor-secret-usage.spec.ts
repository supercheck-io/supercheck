/** @jest-environment node */
const rows: { name: string }[] = [];
jest.mock("@/utils/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => rows }) }) }) }) } }));

import { breaksSecretRefs, secretInUseMessage } from "./monitor-secret-usage";

beforeEach(() => {
  rows.length = 0;
});

describe("secretInUseMessage", () => {
  it("is null when no live monitor references the secret", async () => {
    expect(await secretInUseMessage("p", "K", "delete")).toBeNull();
  });
  it("names the monitors, capped at five", async () => {
    rows.push({ name: "A" });
    expect(await secretInUseMessage("p", "K", "delete")).toBe("Secret K is used by monitor A. Update those monitors before you delete it.");
    rows.push(...["B", "C", "D", "E", "F"].map((name) => ({ name })));
    expect(await secretInUseMessage("p", "K", "rename")).toContain("more than 5 monitors, including A, B, C, D, E.");
  });
});

describe("breaksSecretRefs", () => {
  const secret = { key: "K", isSecret: true, type: "secret" };
  it("flags a rename or dropping the secret flag, not a value or description change", () => {
    expect(breaksSecretRefs(secret, { key: "X" })).toBe("rename");
    expect(breaksSecretRefs(secret, { isSecret: false })).toBe("make non-secret");
    expect(breaksSecretRefs(secret, { key: "K", isSecret: true })).toBeNull();
    expect(breaksSecretRefs(secret, {})).toBeNull();
  });
  it("ignores plain variables", () => {
    expect(breaksSecretRefs({ key: "K", isSecret: false, type: "variable" }, { key: "X" })).toBeNull();
  });
});
