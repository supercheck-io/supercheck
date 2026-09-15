import { NextResponse } from "next/server";
import { z } from "zod";

import { verifySlackRequestSignature } from "@/lib/sre/collaboration-signatures";
import { claimSreCollaborationWebhook, processSreCollaborationMessage, updateSreCollaborationWebhookResult } from "@/lib/sre/collaboration-webhooks";

export const runtime = "nodejs";

const slackUrlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string(),
});

const slackEventCallbackSchema = z.object({
  type: z.literal("event_callback"),
  event_id: z.string().min(1),
  event: z.object({
    type: z.string(),
    subtype: z.string().optional(),
    text: z.string().optional(),
    channel: z.string().optional(),
    ts: z.string().optional(),
    thread_ts: z.string().optional(),
    user: z.string().optional(),
    bot_id: z.string().optional(),
  }),
});

export async function POST(request: Request) {
  const body = await request.text();
  const verified = verifySlackRequestSignature({
    body,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    signingSecret: process.env.SRE_SLACK_SIGNING_SECRET ?? process.env.SLACK_SIGNING_SECRET,
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid Slack signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid Slack payload" }, { status: 400 });
  }

  const urlVerification = slackUrlVerificationSchema.safeParse(payload);
  if (urlVerification.success) {
    return NextResponse.json({ challenge: urlVerification.data.challenge });
  }

  const eventPayload = slackEventCallbackSchema.safeParse(payload);
  if (!eventPayload.success) {
    return NextResponse.json({ ok: true, skipped: "unsupported_payload" });
  }

  const { event_id: deliveryId, event } = eventPayload.data;
  if (event.type !== "message" || event.bot_id || event.subtype === "bot_message" || event.subtype === "message_deleted") {
    return NextResponse.json({ ok: true, skipped: "unsupported_event" });
  }

  const eventType = "slack.event_callback";
  const shouldProcess = await claimSreCollaborationWebhook(deliveryId, eventType);
  if (!shouldProcess) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  try {
    const result = await processSreCollaborationMessage({
      provider: "slack",
      deliveryId,
      text: event.text ?? "",
      channelId: event.channel,
      threadTs: event.thread_ts ?? event.ts,
      responderId: event.user,
    });
    await updateSreCollaborationWebhookResult({
      deliveryId,
      eventType,
      status: result.status === "skipped" ? "skipped" : "success",
      message: result.status,
    });

    return NextResponse.json({ ok: true, result });
  } catch (error) {
    await updateSreCollaborationWebhookResult({
      deliveryId,
      eventType,
      status: "error",
      message: error instanceof Error ? error.message : "Slack SRE webhook failed",
    });
    return NextResponse.json({ error: "Slack SRE webhook failed" }, { status: 500 });
  }
}
