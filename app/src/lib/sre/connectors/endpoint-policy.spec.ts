/** @jest-environment node */

jest.mock("node:dns/promises", () => ({
  lookup: jest.fn(),
}));

import { lookup } from "node:dns/promises";
import { assertEndpointAllowedForExecution, HostResolutionError, isMetadataOrLinkLocalAddress, isPrivateConnectorAddress, redactEndpointQuery, summarizeJobSpec } from "./endpoint-policy";

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
    expect(isPrivateConnectorAddress("2001:0000:4136:e378::1")).toBe(true);
    expect(isPrivateConnectorAddress("2002:7f00:1::")).toBe(true);
    expect(isPrivateConnectorAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateConnectorAddress("::ffff:ac12:5")).toBe(true);
    expect(isPrivateConnectorAddress("[::ffff:ac12:5]")).toBe(true);
    expect(isPrivateConnectorAddress("::ffff:8.8.8.8")).toBe(false);
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

describe("self-hosted metadata blocking", () => {
  it.each([
    "169.254.169.254", "100.100.100.200", "168.63.129.16", "192.0.0.192",
    "fe80::1", "fd00:ec2::254", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "64:ff9b::a9fe:a9fe", "64:ff9b:1::a9fe:a9fe", "2002:a9fe:a9fe::1", "::a9fe:a9fe", "64:ff9b:1:a9fe:a9:fe00:0:0",
  ])("blocks %s", (address) => {
    expect(isMetadataOrLinkLocalAddress(address)).toBe(true);
  });

  it.each(["127.0.0.1", "10.0.0.5", "192.168.1.1", "::1", "8.8.8.8", "::ffff:10.0.0.1", "64:ff9b::a00:5", "2002:a00:5::1"])(
    "allows %s",
    (address) => {
      expect(isMetadataOrLinkLocalAddress(address)).toBe(false);
    },
  );

  it("rejects self-hosted endpoints that resolve to metadata, allows private", async () => {
    process.env.SELF_HOSTED = "true";
    mockLookup.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as never);
    await expect(assertEndpointAllowedForExecution("http://prom.internal:9090", false)).rejects.toThrow("metadata");
    mockLookup.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }] as never);
    await expect(assertEndpointAllowedForExecution("http://prom.internal:9090", false)).resolves.toBeUndefined();
  });
});

describe("cloud DNS failures", () => {
  it("treats a DNS lookup timeout as a host resolution failure", async () => {
    jest.useFakeTimers();
    try {
      delete process.env.SELF_HOSTED;
      mockLookup.mockReturnValueOnce(new Promise(() => undefined) as never);
      const result = assertEndpointAllowedForExecution("https://slow.example.com", false);
      const assertion = expect(result).rejects.toBeInstanceOf(HostResolutionError);
      await jest.advanceTimersByTimeAsync(11_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it("reports an unresolvable host plainly instead of raw getaddrinfo text", async () => {
    delete process.env.SELF_HOSTED;
    mockLookup.mockRejectedValueOnce(Object.assign(new Error("getaddrinfo ENOTFOUND nope.example.com"), { code: "ENOTFOUND" }));
    await expect(assertEndpointAllowedForExecution("https://nope.example.com", false)).rejects.toThrow(
      "Could not resolve host nope.example.com",
    );
  });
});

describe("redactEndpointQuery", () => {
  it("hides the query of a stored URL and leaves other values alone", () => {
    expect(redactEndpointQuery("https://mcp.example.com/mcp?key=s3cret")).toBe("https://mcp.example.com/mcp?…");
    expect(redactEndpointQuery("https://mcp.example.com/mcp")).toBe("https://mcp.example.com/mcp");
    expect(redactEndpointQuery(undefined)).toBeNull();
  });
});

describe("summarizeJobSpec", () => {
  it("drops the endpoint query whatever its parameter is called", () => {
    const summary = summarizeJobSpec({ connectorType: "mcp", endpointUrl: "https://mcp.example.com/mcp?zzz=topsecret" });
    expect(summary).not.toContain("topsecret");
    expect(summary).toContain("https://mcp.example.com/mcp?…");
  });
});
