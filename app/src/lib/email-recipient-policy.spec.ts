import { isUndeliverableRecipient } from "./email-recipient-policy";

describe("isUndeliverableRecipient", () => {
  afterEach(() => {
    delete process.env.SMTP_BLOCKED_RECIPIENT_DOMAINS;
  });

  it.each([
    "a@example.com",
    "a@sub.example.org",
    "a@EXAMPLE.NET",
    "a@host.invalid",
    "a@foo.test",
    "a@localhost",
    "Name <a@example.com>",
    "Name <a@host.invalid> ",
  ])("blocks %s", (email) => {
    expect(isUndeliverableRecipient(email)).toBe(true);
  });

  it.each(["a@gmail.com", "a@supercheck.io", "a@notexample.com", "a@example.co", "ops@corp", "a@printer.local", "Ops <ops@supercheck.io>"])(
    "allows %s",
    (email) => {
      expect(isUndeliverableRecipient(email)).toBe(false);
    },
  );

  it("blocks configured domains and their subdomains", () => {
    process.env.SMTP_BLOCKED_RECIPIENT_DOMAINS = " e2e-test.supercheck.io , .qa.example ";
    expect(isUndeliverableRecipient("x@e2e-test.supercheck.io")).toBe(true);
    expect(isUndeliverableRecipient("x@a.e2e-test.supercheck.io")).toBe(true);
    expect(isUndeliverableRecipient("x@supercheck.io")).toBe(false);
  });
});
