import { createHmac, timingSafeEqual } from "node:crypto";

/** A signature older (or newer) than this is rejected, limiting replay of a captured request. */
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

export type Bounce = {
  email: string;
  kind: "hard" | "soft";
  reason: string;
  diagnostic: string | null;
  bouncedAt: Date;
};

/**
 * ZeptoMail posts the event JSON as the value of a single form-encoded parameter and signs that
 * value: `producer-signature: ts=<ms>;s=<urlencoded base64 HMAC-SHA256>;s-algorithm=HmacSHA256`.
 * Returns the decoded event JSON when the signature is valid, otherwise null.
 */
export function verifyZeptoMailWebhook(
  rawBody: string,
  signatureHeader: string | null,
  key: string,
  now = Date.now(),
): string | null {
  if (!signatureHeader || !key) return null;
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }),
  );
  if (parts["s-algorithm"] !== "HmacSHA256" || !parts.s || !parts.ts) return null;
  const ts = Number(parts.ts);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_CLOCK_SKEW_MS) return null;

  // Split before decoding: decoding the whole body first would turn "+" into spaces in the value.
  const separator = rawBody.indexOf("=");
  if (separator < 0) return null;
  let value: string;
  let provided: Buffer;
  try {
    value = decodeURIComponent(rawBody.slice(separator + 1).replace(/\+/g, " "));
    provided = Buffer.from(decodeURIComponent(parts.s), "base64");
  } catch {
    return null;
  }
  const expected = createHmac("sha256", key).update(value, "utf8").digest();
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return value;
}

const asArray = <T>(value: T | T[] | undefined | null): T[] =>
  value == null ? [] : Array.isArray(value) ? value : [value];

type Details = { bounced_recipient?: string; reason?: string; diagnostic_message?: string; time?: string };
type EventData = { object?: string; details?: Details | Details[] };
type EmailInfo = { to?: Array<{ email_address?: { address?: string } }> };
type EventMessage = { email_info?: EmailInfo; event_data?: EventData | EventData[] };

/** Extracts bounced recipients from a ZeptoMail bounce event; unknown shapes yield nothing. */
export function parseZeptoMailBounces(eventJson: string): Bounce[] {
  let event: { event_name?: string | string[]; event_message?: EventMessage | EventMessage[] };
  try {
    event = JSON.parse(eventJson);
  } catch {
    return [];
  }
  const names = asArray(event.event_name).map((name) => String(name).toLowerCase().replace(/[\s_-]/g, ""));
  const bounces: Bounce[] = [];
  for (const message of asArray(event.event_message)) {
    for (const data of asArray(message.event_data)) {
      const kindName = String(data.object ?? names[0] ?? "").toLowerCase().replace(/[\s_-]/g, "");
      const kind = kindName === "hardbounce" ? "hard" : kindName === "softbounce" ? "soft" : null;
      if (!kind) continue;
      const recipients = asArray(message.email_info?.to)
        .map((to) => to.email_address?.address)
        .filter((address): address is string => typeof address === "string");
      for (const details of asArray(data.details)) {
        // Prefer the recipient the provider names; fall back to `to` only when it is unambiguous.
        const email = details.bounced_recipient ?? (recipients.length === 1 ? recipients[0] : undefined);
        if (!email || !email.includes("@")) continue;
        const time = details.time ? new Date(details.time) : new Date();
        bounces.push({
          email: email.trim().toLowerCase(),
          kind,
          reason: details.reason ?? `${kind}-bounce`,
          diagnostic: details.diagnostic_message ?? null,
          bouncedAt: Number.isNaN(time.getTime()) ? new Date() : time,
        });
      }
    }
  }
  return bounces;
}
