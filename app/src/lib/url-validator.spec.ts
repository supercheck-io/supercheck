import { allowInternalWebhookTargets, isPrivateHost, validateWebhookUrlString } from "./url-validator";

describe("webhook destination validation", () => {
  it.each(["localhost.", "LOCALHOST.", "127.0.0.1.", "[::1]"])(
    "rejects canonical private host %s",
    (hostname) => {
      expect(isPrivateHost(hostname)).toBe(true);
    },
  );

  it("rejects the trailing-dot loopback URL before a webhook fetch", () => {
    expect(validateWebhookUrlString("https://localhost./hook")).toEqual({
      valid: false,
      error: "Cannot connect to private or internal networks",
    });
  });

  it("rejects unpinned HTTP webhook requests in development", () => {
    expect(validateWebhookUrlString("http://public.example.com/hook")).toEqual({
      valid: false,
      error: "Webhook URL must use HTTPS",
    });
  });
});

describe("internal webhook targets (self-hosted opt-in)", () => {
  const original = { SELF_HOSTED: process.env.SELF_HOSTED, ALLOW: process.env.ALLOW_INTERNAL_TARGETS };
  afterEach(() => {
    for (const [key, value] of [["SELF_HOSTED", original.SELF_HOSTED], ["ALLOW_INTERNAL_TARGETS", original.ALLOW]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const set = (selfHosted: string | undefined, allow: string | undefined) => {
    if (selfHosted === undefined) delete process.env.SELF_HOSTED; else process.env.SELF_HOSTED = selfHosted;
    if (allow === undefined) delete process.env.ALLOW_INTERNAL_TARGETS; else process.env.ALLOW_INTERNAL_TARGETS = allow;
  };

  it.each([
    ["cloud", undefined, "true"],
    ["self-hosted without the flag", "true", undefined],
    ["self-hosted with a non-exact flag", "true", "1"],
  ])("keeps the strict policy in %s", (_name, selfHosted, allow) => {
    set(selfHosted, allow);
    expect(allowInternalWebhookTargets()).toBe(false);
  });

  it("allows private hosts and plain http for channels when self-hosted and ALLOW_INTERNAL_TARGETS=true", () => {
    set("true", "true");
    expect(allowInternalWebhookTargets()).toBe(true);
    for (const url of ["http://10.0.0.5:8080/hook", "http://localhost:9000/x", "https://[::1]/x", "http://hooks.internal/x"]) {
      expect(validateWebhookUrlString(url, { allowInternal: true })).toEqual({ valid: true });
      // The default (public/status page subscriber) policy is unchanged.
      expect(validateWebhookUrlString(url).valid).toBe(false);
    }
  });

  it.each([
    "http://169.254.169.254/latest",
    "https://169.254.1.1/x",
    "http://[fd00:ec2::254]/x",
    "http://[fe80::1]/x",
    "http://metadata.google.internal/x",
  ])("always blocks metadata and link-local target %s", (url) => {
    set("true", "true");
    expect(validateWebhookUrlString(url, { allowInternal: true }).valid).toBe(false);
  });
});
