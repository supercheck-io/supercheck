import { redirect } from "next/navigation";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// The Alerts page was split: delivery signals/history live under Incidents,
// notification channels under Notifications. Keep old links working.
export default async function AlertsRedirectPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tab = first(params.tab);

  if (tab === "channels" || tab === "providers" || first(params.create)) {
    const next = new URLSearchParams();
    for (const key of ["create", "type"]) {
      const v = first(params[key]);
      if (v) next.set(key, v);
    }
    const qs = next.toString();
    redirect(qs ? `/notifications?${qs}` : "/notifications");
  }

  redirect(
    tab === "history"
      ? "/incidents?tab=alerts&view=history"
      : "/incidents?tab=alerts",
  );
}
