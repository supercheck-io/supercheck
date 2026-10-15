import type { MonitorConfig } from "@/db/schema";

/** Request credentials and payloads are available only to monitor updaters. */
export function monitorConfigForRead(
  config: MonitorConfig | null,
  canUpdate: boolean,
): MonitorConfig | null {
  if (!config || canUpdate) return config;
  const visible = { ...config };
  delete visible.headers;
  delete visible.body;
  if (config.auth) visible.auth = { type: config.auth.type };
  return visible;
}
