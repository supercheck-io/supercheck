"use client";

export const ORGANIZATION_CHANGED_KEY = "supercheck.organization-changed";

export function reloadOrganization() {
  // Other tabs share this browser session; refresh their tenant caches as well.
  try {
    localStorage.setItem(ORGANIZATION_CHANGED_KEY, crypto.randomUUID());
  } catch {
    // Storage may be unavailable. The current tab still needs a fresh context.
  }
  window.location.replace("/");
}
