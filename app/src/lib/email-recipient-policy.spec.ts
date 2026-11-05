import {
  clearRecipientMxCache,
  isUndeliverableRecipient,
  partitionRecipients,
} from "./email-recipient-policy";

const mockResolveMx = jest.fn();
jest.mock("node:dns/promises", () => ({
  Resolver: jest.fn().mockImplementation(() => ({
    resolveMx: (domain: string) => mockResolveMx(domain),
  })),
}));

const dnsError = (code: string) => Object.assign(new Error(code), { code });

describe("isUndeliverableRecipient", () => {
  it.each([
    "a@example.com",
    "a@sub.example.org",
    "a@EXAMPLE.NET",
    "a@host.invalid",
    "a@foo.test",
    "a@localhost",
  ])("blocks %s", (email) => {
    expect(isUndeliverableRecipient(email)).toBe(true);
  });

  it.each(["a@gmail.com", "a@supercheck.io", "a@notexample.com", "a@example.co", "ops@corp", "a@printer.local"])(
    "allows %s",
    (email) => {
      expect(isUndeliverableRecipient(email)).toBe(false);
    },
  );

  describe("partitionRecipients", () => {
    beforeEach(() => {
      clearRecipientMxCache();
      mockResolveMx.mockReset();
      delete process.env.SELF_HOSTED;
    });

    it("skips domains with no MX, a null MX, or no DNS entry", async () => {
      mockResolveMx.mockImplementation(async (domain: string) => {
        if (domain === "gmail.com") return [{ exchange: "gmail-smtp-in.l.google.com", priority: 5 }];
        if (domain === "nullmx.com") return [{ exchange: "", priority: 0 }];
        if (domain === "nomx.dev") throw dnsError("ENODATA");
        throw dnsError("ENOTFOUND");
      });
      await expect(
        partitionRecipients(["a@gmail.com", "b@nullmx.com", "c@nomx.dev", "d@gone.zzz", "e@x.invalid"]),
      ).resolves.toEqual({
        deliverable: ["a@gmail.com"],
        skipped: ["b@nullmx.com", "c@nomx.dev", "d@gone.zzz", "e@x.invalid"],
      });
    });

    it("fails open on other DNS errors and caches per domain", async () => {
      mockResolveMx.mockRejectedValue(dnsError("ETIMEOUT"));
      await expect(partitionRecipients(["a@slow.com", "b@slow.com"])).resolves.toEqual({
        deliverable: ["a@slow.com", "b@slow.com"],
        skipped: [],
      });
      expect(mockResolveMx).toHaveBeenCalledTimes(1);
    });

    it("self-hosted: no MX lookup and no suppression lookup, reserved domains still skipped", async () => {
      process.env.SELF_HOSTED = "true";
      const lookup = jest.fn(async () => new Set(["a@nomx.dev"]));
      await expect(partitionRecipients(["a@nomx.dev", "b@x.invalid"], lookup)).resolves.toEqual({
        deliverable: ["a@nomx.dev"],
        skipped: ["b@x.invalid"],
      });
      expect(mockResolveMx).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
    });

    it("never looks up MX for dotless hosts", async () => {
      await expect(partitionRecipients(["ops@corp"])).resolves.toEqual({ deliverable: ["ops@corp"], skipped: [] });
      expect(mockResolveMx).not.toHaveBeenCalled();
    });
  });
});
