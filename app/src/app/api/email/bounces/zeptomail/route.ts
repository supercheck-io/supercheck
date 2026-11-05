import { NextResponse } from "next/server";
import { createLogger } from "@/lib/logger/index";
import { isCloudHosted } from "@/lib/feature-flags";
import { suppressEmail } from "@/lib/email-suppression";
import { parseZeptoMailBounces, verifyZeptoMailWebhook } from "@/lib/zeptomail-webhook";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;
/** ZeptoMail sends one bounce per request; the cap bounds DB writes for a forged batch. */
const MAX_EVENTS = 100;

/** Reads the body but stops at `max` bytes, since Content-Length can be absent or wrong. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
const logger = createLogger({ module: "zeptomail-bounce-webhook" }) as {
  info: (data: object, message: string) => void;
  warn: (data: object, message: string) => void;
};

/**
 * ZeptoMail bounce webhook. Hard bounces go on the suppression list, so the address is never
 * mailed again; soft bounces are only logged (the provider retries those itself).
 * Cloud only; 404 unless ZEPTOMAIL_WEBHOOK_KEY (the mail agent's Authentication Key) is set.
 */
export async function POST(request: Request) {
  // Supercheck Cloud only; self-hosted installs bring their own SMTP provider.
  const key = process.env.ZEPTOMAIL_WEBHOOK_KEY?.trim();
  if (!isCloudHosted() || !key) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  const rawBody = await readCapped(request, MAX_BODY_BYTES);
  if (rawBody === null) return NextResponse.json({ error: "Payload too large" }, { status: 413 });

  const signature = request.headers.get("producer-signature");
  // ZeptoMail's "Verify" button posts unsigned and requires a 200; an unsigned call changes nothing.
  if (!signature) return NextResponse.json({ received: 0, suppressed: 0 });
  const eventJson = verifyZeptoMailWebhook(rawBody, signature, key);
  if (!eventJson) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });

  const bounces = parseZeptoMailBounces(eventJson).slice(0, MAX_EVENTS);
  let suppressed = 0;
  for (const bounce of bounces) {
    if (bounce.kind !== "hard") continue;
    await suppressEmail({
      email: bounce.email,
      reason: bounce.reason,
      source: "zeptomail",
      diagnostic: bounce.diagnostic,
      bouncedAt: bounce.bouncedAt,
    });
    suppressed++;
  }
  logger.info({ events: bounces.length, suppressed }, "Processed ZeptoMail bounce webhook");
  return NextResponse.json({ received: bounces.length, suppressed });
}
