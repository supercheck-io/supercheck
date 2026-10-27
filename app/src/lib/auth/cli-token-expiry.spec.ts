import { capExpiryToCliToken, clampExpiry } from "./cli-token-expiry";

describe("capExpiryToCliToken", () => {
  beforeEach(() => jest.useFakeTimers({ now: new Date("2026-10-27T00:00:00Z") }));
  afterEach(() => jest.useRealTimers());
  const parent = (seconds: number) => ({ isCliAuth: true, cliTokenExpiresAt: new Date(Date.now() + seconds * 1000) });

  it("leaves session callers and non-expiring CLI tokens alone", () => {
    expect(capExpiryToCliToken({ isCliAuth: false }, undefined)).toBeUndefined();
    expect(capExpiryToCliToken({ isCliAuth: true, cliTokenExpiresAt: null }, 86400)).toBe(86400);
  });

  it("never lets a child outlive the CLI token, including a 'never expires' request", () => {
    expect(capExpiryToCliToken(parent(7200), 365 * 86400)).toBe(7200);
    expect(capExpiryToCliToken(parent(7200), undefined)).toBe(7200);
    expect(capExpiryToCliToken(parent(7200), 3600)).toBe(3600);
    expect(capExpiryToCliToken(parent(90), 3600)).toBe(90);
  });

  it("returns null once the CLI token has expired", () => {
    expect(capExpiryToCliToken(parent(0), 3600)).toBeNull();
  });
});

describe("clampExpiry", () => {
  const parent = new Date("2026-10-28T00:00:00Z");
  it("keeps the earlier of the child and parent expiry", () => {
    expect(clampExpiry(new Date("2026-10-27T12:00:00Z"), parent)).toEqual(new Date("2026-10-27T12:00:00Z"));
    expect(clampExpiry(new Date("2026-11-01T00:00:00Z"), parent)).toEqual(parent);
    expect(clampExpiry(null, parent)).toEqual(parent);
  });
  it("is a no-op without a parent bound", () => {
    expect(clampExpiry(null, null)).toBeNull();
    expect(clampExpiry(parent, undefined)).toEqual(parent);
  });
});
