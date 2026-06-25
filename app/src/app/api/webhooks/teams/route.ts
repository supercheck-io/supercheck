import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { verifyTeamsOutgoingWebhookSignature } from "@/lib/sre/collaboration-signatures";
import { claimSreCollaborationWebhook, processSreCollaborationMessage, updateSreCollaborationWebhookResult } from "@/lib/sre/collaboration-webhooks";

export const runtime = "nodejs";

const teamsMessageSchema = z.object({
  type: z.string().optional(),
  id: z.string().optional(),
  text: z.string().optional(),
  textFormat: z.string().optional(),
  replyToId: z.string().optional(),
  from: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
  conversation: z.object({ id: z.string().optional() }).optional(),
});

function deliveryIdForTeamsPayload(body: string, payload: z.infer<typeof teamsMessageSchema>) {
  return payload.id ?? createHash("sha256").update(body).digest("hex");
}

export async function POST(request: Request) {
  const body = await request.text();
  const verified = verifyTeamsOutgoingWebhookSignature({
    body,
    authorization: request.headers.get("authorization"),
    sharedSecret: process.env.SRE_TEAMS_OUTGOING_WEBHOOK_SECRET ?? process.env.TEAMS_OUTGOING_WEBHOOK_SECRET,
  });

  if (!verified) {
    return NextResponse.json({ error: "Invalid Teams signature" }, { status: 401 });
  }

  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid Teams payload" }, { status: 400 });
  }

  const parsed = teamsMessageSchema.safeParse(rawPayload);
  if (!parsed.success || (parsed.data.type && parsed.data.type !== "message")) {
    return NextResponse.json({ type: "message", text: "SuperCheck ignored this Teams event." });
  }

  const deliveryId = deliveryIdForTeamsPayload(body, parsed.data);
  const eventType = "teams.outgoing_webhook";
  const shouldProcess = await claimSreCollaborationWebhook(deliveryId, eventType);
  if (!shouldProcess) {
    return NextResponse.json({ type: "message", text: "SuperCheck already processed this Teams message." });
  }

  try {
    const result = await processSreCollaborationMessage({
      provider: "teams",
      deliveryId,
      text: parsed.data.text ?? "",
      channelId: parsed.data.conversation?.id,
      threadTs: parsed.data.replyToId ?? parsed.data.id,
      responderId: parsed.data.from?.id,
      responderName: parsed.data.from?.name,
    });
    await updateSreCollaborationWebhookResult({
      deliveryId,
      eventType,
      status: result.status === "skipped" ? "skipped" : "success",
      message: result.status,
    });

    return NextResponse.json({ type: "message", text: `SuperCheck SRE ${result.status}.` });
  } catch (error) {
    await updateSreCollaborationWebhookResult({
      deliveryId,
      eventType,
      status: "error",
      message: error instanceof Error ? error.message : "Teams SRE webhook failed",
    });
    return NextResponse.json({ error: "Teams SRE webhook failed" }, { status: 500 });
  }
}
