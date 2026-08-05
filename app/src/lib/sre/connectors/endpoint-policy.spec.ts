/** @jest-environment node */

jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(),
}));

import { lookup } from "node:dns/promises";
import { assertEndpointAllowedForExecution, isPrivateConnectorAddress } from "./endpoint-policy";

const mockLookup = lookup as jest.MockedFunction<typeof lookup>;

describe("connector endpoint policy", () => {
  const originalSelfHosted = process.env.SELF_HOSTED;

  afterEach(() => {
    jest.clearAllMocks();
    if (originalSelfHosted === undefined) {
      delete process.env.SELF_HOSTED;
    } else {
      process.env.SELF_HOSTED = originalSelfHosted;
    }
  });

  it("detects private and loopback addresses", () => {
    expect(isPrivateConnectorAddress("10.0.0.1")).toBe(true);
    expect(isPrivateConnectorAddress("172.16.1.1")).toBe(true);
    expect(isPrivateConnectorAddress("192.168.1.10")).toBe(true);
    expect(isPrivateConnectorAddress("127.0.0.1")).toBe(true);
    expect(isPrivateConnectorAddress("169.254.169.254")).toBe(true);
    expect(isPrivateConnectorAddress("192.0.0.10")).toBe(true);
    expect(isPrivateConnectorAddress("192.0.2.10")).toBe(true);
    expect(isPrivateConnectorAddress("198.51.100.10")).toBe(true);
    expect(isPrivateConnectorAddress("203.0.113.10")).toBe(true);
    expect(isPrivateConnectorAddress("224.0.0.1")).toBe(true);
    expect(isPrivateConnectorAddress("192.0.1.10")).toBe(false);
    expect(isPrivateConnectorAddress("192.2.1.10")).toBe(false);
    expect(isPrivateConnectorAddress("8.8.8.8")).toBe(false);
  });

  it("detects reserved IPv6 ranges", () => {
    expect(isPrivateConnectorAddress("::1")).toBe(true);
    expect(isPrivateConnectorAddress("fd00::1")).toBe(true);
    expect(isPrivateConnectorAddress("fe80::1")).toBe(true);
    expect(isPrivateConnectorAddress("ff02::1")).toBe(true);
    expect(isPrivateConnectorAddress("2001:db8::1")).toBe(true);
    expect(isPrivateConnectorAddress("2606:4700:4700::1111")).toBe(false);
  });

  it("blocks direct cloud HTTP endpoints", async () => {
    process.env.SELF_HOSTED = "false";

    await expect(assertEndpointAllowedForExecution("http://example.com", false)).rejects.toThrow("Direct cloud connectors must use HTTPS");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks direct cloud endpoints that resolve to private IPs", async () => {
    process.env.SELF_HOSTED = "false";
    (mockLookup as jest.Mock).mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    await expect(assertEndpointAllowedForExecution("https://metrics.example.com", false)).rejects.toThrow("private or reserved IP ranges");
  });

  it("allows private endpoints through Private Agent routing", async () => {
    await expect(assertEndpointAllowedForExecution("http://prometheus.internal:9090", true)).resolves.toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("rejects non-HTTP schemes in every execution mode", async () => {
    await expect(
      assertEndpointAllowedForExecution("file:///etc/passwd", true),
    ).rejects.toThrow("must use HTTP or HTTPS");
  });

  it("rejects credentials embedded in endpoint URLs", async () => {
    await expect(
      assertEndpointAllowedForExecution(
        "https://admin:secret@metrics.example.com",
        true,
      ),
    ).rejects.toThrow("cannot include credentials");
  });
});
