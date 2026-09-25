import { isPrivateHost, validateWebhookUrlString } from "./url-validator";

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
});
