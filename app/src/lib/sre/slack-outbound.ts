import { WebClient } from "@slack/web-api";

const MAX_SLACK_SUMMARY_LENGTH = 2500;

function truncateSlackText(value: string, maxLength = MAX_SLACK_SUMMARY_LENGTH) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3)}...`;
}

export async function postSreInvestigationSlackSummary(input: {
  channelId: string | null | undefined;
  threadTs: string | null | undefined;
  incidentTitle: string;
  incidentUrl: string;
  summary: string;
  confidenceLabel?: string | null;
  botToken?: string | null;
}) {
  const token = input.botToken ?? process.env.SRE_SLACK_BOT_TOKEN ?? process.env.SLACK_BOT_TOKEN;
  if (!token || !input.channelId) {
    return { posted: false as const, reason: "missing_slack_destination" };
  }

  const summary = truncateSlackText(input.summary);
  const confidenceLine = input.confidenceLabel ? `\n*Confidence:* ${input.confidenceLabel}` : "";
  const text = `SuperCheck SRE investigation update for ${input.incidentTitle}\n${summary}${confidenceLine}\n${input.incidentUrl}`;
  const client = new WebClient(token);

  const response = await client.chat.postMessage({
    channel: input.channelId,
    thread_ts: input.threadTs ?? undefined,
    text,
    unfurl_links: false,
    unfurl_media: false,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*SuperCheck SRE investigation update*\n*Incident:* <${input.incidentUrl}|${input.incidentTitle}>${confidenceLine}`,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: summary,
        },
      },
    ],
  });

  return { posted: true as const, ts: response.ts ?? null };
}
