import { PAGING_SERVICE_NAMES } from "@/lib/notification-providers/constants";

type Channel = { providerId?: unknown; type?: unknown; ok?: unknown };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Who a reminder or escalation reached: counts only, never addresses. */
function reachedText(data: Record<string, unknown>) {
  const channels = Array.isArray(data.channels) ? (data.channels as Channel[]).filter((channel) => channel?.ok === true).length : 0;
  const emailed = typeof data.emailed === "number" ? data.emailed : 0;
  const parts = [channels > 0 ? plural(channels, "channel") : null, emailed > 0 ? `${emailed} ${emailed === 1 ? "person" : "people"} by email` : null].filter(Boolean);
  return parts.length ? parts.join(" and ") : null;
}

/** Title and body for an incident timeline `notification` event (reminder, escalation, failed page). */
export function describeNotificationEvent(data: Record<string, unknown>): { title: string; body: string | null; warning: boolean } {
  if (data.kind === "reminder") {
    const n = typeof data.n === "number" ? data.n : 1;
    const of = typeof data.of === "number" ? data.of : n;
    const reached = reachedText(data);
    return { title: `Reminder ${n} of ${of} sent`, body: reached ? `Sent to ${reached}` : "Nobody could be reached", warning: !reached };
  }
  if (data.kind === "escalation") {
    const reached = reachedText(data);
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
