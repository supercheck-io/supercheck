type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Where an old /alerts URL now lives. */
export function alertsRedirectTarget(params: Params): string {
  const tab = first(params.tab);
  if (tab === "channels" || tab === "providers" || first(params.create)) {
    const next = new URLSearchParams();
    for (const key of ["create", "type"]) {
      const v = first(params[key]);
      if (v) next.set(key, v);
    }
    const qs = next.toString();
    return qs ? `/notifications?${qs}` : "/notifications";
  }
  return "/notifications?tab=history";
}
