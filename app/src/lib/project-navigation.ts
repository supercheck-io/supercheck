"use client";

import { clearQueryCache } from "@/lib/query-provider";

const PROJECT_CHANGE_KEY = "supercheck-project-change";
const PROJECT_CHANGE_SOURCE = Math.random().toString(36).slice(2);

export function reloadProjectContext(clearProjects: () => void, pathname = "/") {
  clearProjects();
  clearQueryCache();
  const destination = new URL("/", window.location.origin);
  destination.pathname = pathname;
  window.location.replace(destination);
}

export function announceProjectChange() {
  try {
    localStorage.setItem(PROJECT_CHANGE_KEY, crypto.randomUUID());
  } catch { /* Storage can be disabled. BroadcastChannel still works. */ }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(PROJECT_CHANGE_KEY);
      channel.postMessage({ source: PROJECT_CHANGE_SOURCE });
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
  if (channel) channel.onmessage = (event) => {
    if (event.data?.source !== PROJECT_CHANGE_SOURCE) reload();
  };
  return () => {
    window.removeEventListener("storage", onStorage);
    channel?.close();
  };
}
