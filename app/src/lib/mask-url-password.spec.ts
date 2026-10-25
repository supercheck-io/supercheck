import { maskUrlPassword } from "./mask-url-password";

describe("maskUrlPassword", () => {
  it("masks the userinfo password and keeps the rest intact", () => {
    expect(maskUrlPassword("https://user:pw@example.com/p?token=abc")).toBe(
      "https://user:•••@example.com/p?token=abc",
    );
  });

  it("handles ports, fragments and non-http schemes", () => {
    expect(maskUrlPassword("postgres://admin:s3cret@db.internal:5432/app#x")).toBe(
      "postgres://admin:•••@db.internal:5432/app#x",
    );
  });

  it("uses the last @ when the password contains one", () => {
    expect(maskUrlPassword("https://u:p@ss@host.com/")).toBe("https://u:•••@host.com/");
  });

  it("does not touch an @ or colon outside the authority", () => {
    expect(maskUrlPassword("https://example.com/a:b@c")).toBe("https://example.com/a:b@c");
    expect(maskUrlPassword("https://example.com?e=a:b@c")).toBe("https://example.com?e=a:b@c");
  });

  it("leaves URLs without a userinfo password unchanged", () => {
    expect(maskUrlPassword("https://user@example.com/")).toBe("https://user@example.com/");
    expect(maskUrlPassword("https://user:@example.com/")).toBe("https://user:@example.com/");
    expect(maskUrlPassword("https://example.com/path")).toBe("https://example.com/path");
  });

  it("leaves non-URL targets and empty values unchanged", () => {
    expect(maskUrlPassword("example.com")).toBe("example.com");
    expect(maskUrlPassword("user:pw@example.com")).toBe("user:pw@example.com");
    expect(maskUrlPassword("")).toBe("");
    expect(maskUrlPassword(null)).toBeNull();
    expect(maskUrlPassword(undefined)).toBeUndefined();
  });

  it("handles an empty username and IPv6 hosts", () => {
    expect(maskUrlPassword("https://:pw@example.com/")).toBe("https://:•••@example.com/");
    expect(maskUrlPassword("http://u:pw@[::1]:8080/x")).toBe("http://u:•••@[::1]:8080/x");
  });

  it("is idempotent", () => {
    const once = maskUrlPassword("https://user:pw@example.com/");
    expect(maskUrlPassword(once)).toBe(once);
  });
});
