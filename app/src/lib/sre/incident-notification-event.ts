import type { SreIncidentTimelineRefs } from "@/actions/sre-incident-lifecycle";
import { PAGING_SERVICE_NAMES } from "@/lib/notification-providers/constants";

type Channel = { providerId?: unknown; type?: unknown; ok?: unknown };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const NAMED_CHANNELS = 3;

const listText = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? null));

/** Who a reminder or escalation reached: channel names when known (else counts), never addresses. */
function reachedText(data: Record<string, unknown>, refs?: Pick<SreIncidentTimelineRefs, "providers">) {
  const reached = Array.isArray(data.channels) ? (data.channels as Channel[]).filter((channel) => channel?.ok === true) : [];
  const names = refs ? reached.flatMap((channel) => (typeof channel.providerId === "string" && refs.providers[channel.providerId]) || []) : [];
  // A deleted channel has no name; it still counts towards "and N more".
  const more = reached.length - Math.min(names.length, NAMED_CHANNELS);
  const channels = names.length
    ? [...names.slice(0, NAMED_CHANNELS), ...(more > 0 ? [`${more} more`] : [])]
    : reached.length > 0
      ? [plural(reached.length, "channel")]
      : [];
  const emailed = typeof data.emailed === "number" ? data.emailed : 0;
  return listText([...channels, ...(emailed > 0 ? [`${emailed} ${emailed === 1 ? "person" : "people"} by email`] : [])]);
}

/** Title and body for an incident timeline `notification` event (reminder, escalation, failed page). */
export function describeNotificationEvent(
  data: Record<string, unknown>,
  refs?: Pick<SreIncidentTimelineRefs, "providers">,
): { title: string; body: string | null; warning: boolean } {
  // Given up after repeated failed sends: say so, rather than "sent" or "target removed".
  if (data.failed === true && (data.kind === "reminder" || data.kind === "escalation")) {
    const attempts = typeof data.attempts === "number" ? data.attempts : undefined;
    const what = data.kind === "reminder" ? `Reminder ${typeof data.n === "number" ? data.n : 1}` : "Escalation";
    return {
      title: `${what} could not be delivered`,
      body: `Every channel failed${attempts ? ` on ${attempts} attempts` : ""}; it was given up. Check the channels on the Notifications page.`,
      warning: true,
    };
  }
  if (data.kind === "reminder") {
    const n = typeof data.n === "number" ? data.n : 1;
    const of = typeof data.of === "number" ? data.of : n;
    const reached = reachedText(data, refs);
    return { title: `Reminder ${n} of ${of} sent`, body: reached ? `Sent to ${reached}` : "Nobody could be reached", warning: !reached };
  }
  if (data.kind === "escalation") {
    const reached = reachedText(data, refs);
    return data.reached === 0 || !reached
      ? { title: "Escalation not sent", body: "The escalation target was removed or could not be reached", warning: true }
      : { title: "Escalated", body: `Sent to ${reached}`, warning: false };
  }
  if (data.kind === "page_failed") {
    const vendor = (typeof data.preset === "string" && PAGING_SERVICE_NAMES[data.preset]) || "Paging service";
    const status = typeof data.status === "number" ? ` (HTTP ${data.status})` : "";
    const fallback =
      data.fallback === "policy_channels"
        ? "The incident was sent to the project's incident channels instead."
        : data.fallback === "admins"
          ? "Project owners and admins were emailed instead."
          : null;
    const key = data.terminal === true ? "Check the integration key." : null;
    return { title: `${vendor} page failed${status}`, body: [key, fallback].filter(Boolean).join(" ") || null, warning: true };
  }
  return { title: "Notification", body: null, warning: false };
}
