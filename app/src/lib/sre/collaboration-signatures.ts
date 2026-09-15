import { createHmac, timingSafeEqual } from "crypto";

const SLACK_SIGNATURE_VERSION = "v0";
const MAX_SLACK_TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

function timingSafeStringEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function verifySlackRequestSignature(input: {
  body: string;
  timestamp: string | null;
  signature: string | null;
  signingSecret: string | undefined;
  now?: Date;
}) {
  if (!input.signingSecret || !input.timestamp || !input.signature) {
    return false;
  }

  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }

  const nowMs = input.now?.getTime() ?? Date.now();
  if (Math.abs(nowMs - timestampSeconds * 1000) > MAX_SLACK_TIMESTAMP_SKEW_MS) {
    return false;
  }

  const baseString = `${SLACK_SIGNATURE_VERSION}:${input.timestamp}:${input.body}`;
  const expected = `${SLACK_SIGNATURE_VERSION}=${createHmac("sha256", input.signingSecret)
    .update(baseString)
    .digest("hex")}`;

  return timingSafeStringEqual(expected, input.signature);
}

export function verifyTeamsOutgoingWebhookSignature(input: {
  body: string;
  authorization: string | null;
  sharedSecret: string | undefined;
}) {
  if (!input.sharedSecret || !input.authorization?.startsWith("HMAC ")) {
    return false;
  }

  const provided = input.authorization.slice("HMAC ".length).trim();
  if (!provided) {
    return false;
  }

  const expected = createHmac("sha256", input.sharedSecret).update(input.body).digest("base64");
  return timingSafeStringEqual(expected, provided);
}
