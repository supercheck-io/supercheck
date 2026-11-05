/** @jest-environment node */
import { createHmac } from "node:crypto";

const mockSuppressEmail = jest.fn();
jest.mock("@/lib/email-suppression", () => ({ suppressEmail: (...args: unknown[]) => mockSuppressEmail(...args) }));
jest.mock("@/lib/logger/index", () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn() }) }));

import { POST } from "./route";

const KEY = "agent-auth-key";
const event = (object: string, email: string) =>
  JSON.stringify({ event_name: [object], event_message: [{ event_data: [{ object, details: [{ bounced_recipient: email }] }] }] });

function request(value: string, key = KEY) {
  const s = encodeURIComponent(createHmac("sha256", key).update(value, "utf8").digest("base64"));
  return new Request("https://app.test/api/email/bounces/zeptomail", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "producer-signature": `ts=${Date.now()};s=${s};s-algorithm=HmacSHA256` },
    body: `payload=${encodeURIComponent(value)}`,
  });
}

describe("POST /api/email/bounces/zeptomail", () => {
  beforeEach(() => {
    mockSuppressEmail.mockReset();
    process.env.ZEPTOMAIL_WEBHOOK_KEY = KEY;
  });
  afterAll(() => {
    delete process.env.ZEPTOMAIL_WEBHOOK_KEY;
    delete process.env.SELF_HOSTED;
  });

  it("is disabled on self-hosted installs", async () => {
    process.env.SELF_HOSTED = "true";
    expect((await POST(request(event("hardbounce", "a@b.io")))).status).toBe(404);
    delete process.env.SELF_HOSTED;
  });

  it("is disabled without a configured key", async () => {
    delete process.env.ZEPTOMAIL_WEBHOOK_KEY;
    expect((await POST(request(event("hardbounce", "a@b.io")))).status).toBe(404);
  });

  it("rejects an invalid signature without touching the list", async () => {
    expect((await POST(request(event("hardbounce", "a@b.io"), "wrong"))).status).toBe(401);
    expect(mockSuppressEmail).not.toHaveBeenCalled();
  });

  it("suppresses hard bounces only", async () => {
    const hard = await POST(request(event("hardbounce", "Gone@B.io")));
    expect(hard.status).toBe(200);
    expect(await hard.json()).toEqual({ received: 1, suppressed: 1 });
    expect(mockSuppressEmail).toHaveBeenCalledWith(expect.objectContaining({ email: "gone@b.io", source: "zeptomail" }));

    mockSuppressEmail.mockReset();
    const soft = await POST(request(event("softbounce", "full@b.io")));
    expect(await soft.json()).toEqual({ received: 1, suppressed: 0 });
    expect(mockSuppressEmail).not.toHaveBeenCalled();
  });

  it("rejects a chunked body that exceeds the cap without a Content-Length", async () => {
    const stream = new ReadableStream({
      start(controller) {
        for (let i = 0; i < 300; i++) controller.enqueue(new Uint8Array(1024));
        controller.close();
      },
    });
    const req = new Request("https://app.test/x", { method: "POST", body: stream, duplex: "half" } as RequestInit);
    expect((await POST(req)).status).toBe(413);
  });

  it("rejects oversized bodies", async () => {
    const big = new Request("https://app.test/x", { method: "POST", headers: { "content-length": String(300 * 1024) }, body: "x" });
    expect((await POST(big)).status).toBe(413);
  });
});
