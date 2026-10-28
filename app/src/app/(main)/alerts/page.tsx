import { redirect } from "next/navigation";
import { alertsRedirectTarget } from "./redirect-target";

// The Alerts page was split: signals/history live under Incidents, channels
// under Notifications. Keep old links working.
export default async function AlertsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(alertsRedirectTarget(await searchParams));
}
