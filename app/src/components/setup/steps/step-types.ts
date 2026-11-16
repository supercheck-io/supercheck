import { ensureProject, PROJECT_HEADER } from "../create-runner";
import type { SetupDraft } from "@/lib/setup/draft-schema";
import type { SetupFeatures } from "@/lib/setup/features";
import type { ScanSummary } from "@/lib/setup/scan";
import type { SetupResponse } from "@/lib/setup/types";

/** What every step receives from the wizard shell. */
export interface StepProps {
  response: SetupResponse;
  features: SetupFeatures;
  permissions: SetupResponse["permissions"];
  draft: SetupDraft;
  patchDraft: (fn: (draft: SetupDraft) => SetupDraft) => void;
  /** Sets the explicit "I don't need a status page" flag (counts as done on the checklist). */
  setStatusPageOptOut: (optOut: boolean) => void;
  /** Another user holds the lock, or the caller cannot edit. */
  readOnly: boolean;
  userEmail?: string | null;
  /** Latest scan of the app URL (kept by the server too); null when none ran. */
  scan: ScanSummary | null;
  setScan: (scan: ScanSummary) => void;
}

const hostOf = (url: string) => new URL(url).host.replace(/^www\./i, "").toLowerCase();

/** A scan only describes the site it ran against: ignore it once the app URL points somewhere else. */
export function scanMatchesUrl(scan: ScanSummary | null, appUrl: string | null | undefined): scan is ScanSummary {
  if (!scan || !appUrl) return false;
  try {
    const scanned = hostOf(scan.finalUrl);
    const entered = hostOf(appUrl);
    // A redirect within the same site (example.com -> app.example.com) still belongs to this URL.
    return scanned === entered || scanned.endsWith(`.${entered}`) || entered.endsWith(`.${scanned}`);
  } catch {
    return false;
  }
}

/** `projectId` is sent as the expected project: the server answers 409 when the active project is another one. */
export async function postJson<T = unknown>(url: string, body: unknown, projectId?: string): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(projectId ? { [PROJECT_HEADER]: projectId } : {}) },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function responseError(data: unknown, fallback: string): string {
  const body = (data ?? {}) as { error?: unknown; message?: unknown };
  if (typeof body.error === "string") return body.error;
  if (typeof body.message === "string") return body.message;
  return fallback;
}

export async function fetchJson(url: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body || init?.headers ? { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const retryAfter = Number(res.headers?.get("Retry-After"));
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})), ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}) };
}

/** Error text when the active project is no longer the setup project (another tab switched), else null. */
export const checkSetupProject = (setupProjectId: string) => ensureProject({ setupProjectId, fetchJson });
