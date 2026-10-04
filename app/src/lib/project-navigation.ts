"use client";

import { clearQueryCache } from "@/lib/query-provider";

const PROJECT_CHANGE_KEY = "supercheck-project-change";

export function reloadProjectContext(clearProjects: () => void) {
  clearProjects();
  clearQueryCache();
  window.location.replace(new URL("/", window.location.origin));
}

export function announceProjectChange() {
  try {
    localStorage.setItem(PROJECT_CHANGE_KEY, crypto.randomUUID());
  } catch { /* Storage can be disabled. BroadcastChannel still works. */ }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PROJECT_CHANGE_KEY);
      channel.postMessage("changed");
      channel.close();
    }
  } catch { /* Navigation still clears this tab's cache and reloads. */ }
}

export function listenForProjectChanges(clearProjects: () => void) {
  let reloading = false;
  const reload = () => {
    if (reloading) return;
    reloading = true;
    reloadProjectContext(clearProjects);
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === PROJECT_CHANGE_KEY && event.newValue) reload();
  };
  window.addEventListener("storage", onStorage);
  const channel = typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel(PROJECT_CHANGE_KEY) : null;
  if (channel) channel.onmessage = reload;
  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}
