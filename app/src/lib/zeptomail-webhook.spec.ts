import { createHmac } from "node:crypto";
import { parseZeptoMailBounces, verifyZeptoMailWebhook } from "./zeptomail-webhook";

const KEY = "agent-auth-key";
const NOW = 1_800_000_000_000;

function sign(value: string, ts = NOW, key = KEY) {
  const s = encodeURIComponent(createHmac("sha256", key).update(value, "utf8").digest("base64"));
  return `ts=${ts};s=${s};s-algorithm=HmacSHA256`;
}
const body = (value: string) => `payload=${encodeURIComponent(value)}`;

const hardBounce = JSON.stringify({
  event_name: ["hardbounce"],
  event_message: [
    {
      email_info: { to: [{ email_address: { address: "Gone@Example.org" } }] },
      event_data: [
        {
          object: "hardbounce",
          details: [
            {
              bounced_recipient: "Gone@Mailbox.io",
              reason: "relaying-issues",
              diagnostic_message: "bad-mailbox",
              time: "2026-11-01T10:00:00Z",
            },
          ],
        },
      ],
      request_id: "r1",
    },
  ],
});

describe("verifyZeptoMailWebhook", () => {
  it("returns the event JSON for a valid signature", () => {
    expect(verifyZeptoMailWebhook(body(hardBounce), sign(hardBounce), KEY, NOW)).toBe(hardBounce);
  });

  it("keeps '+' in the signed value", () => {
    const value = JSON.stringify({ note: "a+b c" });
    const raw = `payload=${encodeURIComponent(value).replace(/%20/g, "+")}`;
    expect(verifyZeptoMailWebhook(raw, sign(value), KEY, NOW)).toBe(value);
  });

  it.each([
    ["wrong key", sign(hardBounce, NOW, "other")],
    ["stale timestamp", sign(hardBounce, NOW - 11 * 60 * 1000)],
    ["future timestamp", sign(hardBounce, NOW + 11 * 60 * 1000)],
    ["other algorithm", sign(hardBounce).replace("HmacSHA256", "HmacSHA1")],
    ["missing header", null],
    ["garbage", "nonsense"],
  ])("rejects %s", (_label, header) => {
    expect(verifyZeptoMailWebhook(body(hardBounce), header, KEY, NOW)).toBeNull();
  });

  it("rejects a tampered body", () => {
    expect(verifyZeptoMailWebhook(body(hardBounce.replace("Gone", "Evil")), sign(hardBounce), KEY, NOW)).toBeNull();
  });
});

describe("parseZeptoMailBounces", () => {
  it("reads the bounced recipient and details", () => {
    expect(parseZeptoMailBounces(hardBounce)).toEqual([
      {
        email: "gone@mailbox.io",
        kind: "hard",
        reason: "relaying-issues",
        diagnostic: "bad-mailbox",
        bouncedAt: new Date("2026-11-01T10:00:00Z"),
      },
    ]);
  });

  it("accepts object-shaped fields and falls back to a single To address", () => {
    const event = JSON.stringify({
      event_name: "soft bounce",
      event_message: {
        email_info: { to: [{ email_address: { address: "a@b.io" } }] },
        event_data: { object: "softbounce", details: { reason: "mailbox-full" } },
      },
    });
    expect(parseZeptoMailBounces(event)).toEqual([
      expect.objectContaining({ email: "a@b.io", kind: "soft", reason: "mailbox-full" }),
    ]);
  });

  it("ignores other events and malformed JSON", () => {
    expect(parseZeptoMailBounces(JSON.stringify({ event_name: ["email_open"], event_message: [{ event_data: [{ object: "open" }] }] }))).toEqual([]);
    expect(parseZeptoMailBounces("{not json")).toEqual([]);
  });
});
