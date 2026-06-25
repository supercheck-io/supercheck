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
    expect(isPrivateConnectorAddress("8.8.8.8")).toBe(false);
  });

  it("blocks direct cloud HTTP endpoints", async () => {
    process.env.SELF_HOSTED = "false";

    await expect(assertEndpointAllowedForExecution("http://example.com", false)).rejects.toThrow("Direct cloud connectors must use HTTPS");
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it("blocks direct cloud endpoints that resolve to private IPs", async () => {
    process.env.SELF_HOSTED = "false";
    (mockLookup as jest.Mock).mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);

    await expect(assertEndpointAllowedForExecution("https://metrics.example.com", false)).rejects.toThrow("private IP ranges");
  });

  it("allows private endpoints through Private Agent routing", async () => {
    await expect(assertEndpointAllowedForExecution("http://prometheus.internal:9090", true)).resolves.toBeUndefined();
    expect(mockLookup).not.toHaveBeenCalled();
  });
});
