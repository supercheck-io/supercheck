import { useEffect, useState } from "react";

/** Compact age such as 5m, 3h, 2d. */
export function formatAge(from: Date | string, to: Date | string | number = Date.now()) {
  const minutes = Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Relative time for sentences: "just now", "5m ago", "3h ago". */
export function formatAgo(from: Date | string, to: Date | string | number = Date.now()) {
  const age = formatAge(from, to);
  return age === "0m" ? "just now" : `${age} ago`;
}

/** The current time, refreshed every interval, so relative times stay right on a page left open. */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
