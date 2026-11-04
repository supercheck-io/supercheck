/** @jest-environment node */
const mockLookup = jest.fn();
jest.mock("@/lib/sre/connectors/endpoint-policy", () => ({
  lookupBounded: (...a: unknown[]) => mockLookup(...a),
}));

import { validateMonitorTargetAddress } from "./monitor-target-policy";

const check = (type: string, target: string) => validateMonitorTargetAddress({ type, target });

describe("validateMonitorTargetAddress", () => {
  const original = process.env.ALLOW_INTERNAL_TARGETS;
  beforeEach(() => {
    delete process.env.ALLOW_INTERNAL_TARGETS;
    mockLookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  afterAll(() => {
    if (original === undefined) delete process.env.ALLOW_INTERNAL_TARGETS;
    else process.env.ALLOW_INTERNAL_TARGETS = original;
  });

  it.each([
    ["http_request", "http://127.0.0.1/health"],
    ["website", "https://localhost:8443"],
    ["website", "http://[::1]/"],
    ["http_request", "http://169.254.169.254/latest/meta-data"],
    ["ping_host", "10.0.0.5"],
    ["ping_host", "192.168.1.1"],
    ["port_check", "172.16.0.9"],
    ["port_check", "metadata.google.internal"],
  ])("rejects %s target %s without a lookup", async (type, target) => {
    expect(await check(type, target)).toMatchObject({ success: false, error: "Invalid monitor target" });
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it.each([
    ["http_request", "https://internal.example.com/x"],
    ["website", "https://internal.example.com"],
    ["ping_host", "internal.example.com"],
    ["port_check", "internal.example.com"],
  ])("rejects a %s name that resolves to a private address", async (type, target) => {
    mockLookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }, { address: "10.1.2.3", family: 4 }]);
    expect(await check(type, target)).toMatchObject({ success: false });
  });

  it("accepts public targets, unresolvable names and monitor types without a host", async () => {
    expect(await check("http_request", "https://example.com")).toEqual({ success: true });
    expect(await check("ping_host", "8.8.8.8")).toEqual({ success: true });
    mockLookup.mockRejectedValue(new Error("Could not resolve host"));
    expect(await check("website", "https://not-yet-created.example.com")).toEqual({ success: true });
    expect(await check("synthetic_test", "11111111-1111-4111-8111-111111111111")).toEqual({ success: true });
    expect(await check("heartbeat", "")).toEqual({ success: true });
  });

  it("allows internal targets only when ALLOW_INTERNAL_TARGETS is exactly true", async () => {
    process.env.ALLOW_INTERNAL_TARGETS = "true";
    expect(await check("http_request", "http://127.0.0.1")).toEqual({ success: true });
    expect(await check("ping_host", "10.0.0.5")).toEqual({ success: true });
    expect(mockLookup).not.toHaveBeenCalled();
    for (const value of ["1", "false", "TRUE"]) {
      process.env.ALLOW_INTERNAL_TARGETS = value;
      expect(await check("http_request", "http://127.0.0.1")).toMatchObject({ success: false });
    }
  });
});
