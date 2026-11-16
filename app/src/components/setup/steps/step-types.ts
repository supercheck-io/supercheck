import type { SetupDraft } from "@/lib/setup/draft-schema";
import type { SetupFeatures } from "@/lib/setup/features";
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
