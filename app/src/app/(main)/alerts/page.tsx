import { redirect } from "next/navigation";
import { alertsRedirectTarget } from "./redirect-target";

// The Alerts page moved to Notifications (channels and delivery history). Keep old links working.
export default async function AlertsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  redirect(alertsRedirectTarget(await searchParams));
}
