import { ensureProject } from "../create-runner";
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
    return hostOf(scan.finalUrl) === hostOf(appUrl);
  } catch {
    return false;
  }
}

export async function postJson<T = unknown>(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

export function responseError(data: unknown, fallback: string): string {
  const body = (data ?? {}) as { error?: unknown; message?: unknown };
  if (typeof body.error === "string") return body.error;
  if (typeof body.message === "string") return body.message;
  return fallback;
}

export async function fetchJson(url: string, init?: { method?: string; body?: unknown }) {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

/** Error text when the active project is no longer the setup project (another tab switched), else null. */
export const checkSetupProject = (setupProjectId: string) => ensureProject({ setupProjectId, fetchJson });
