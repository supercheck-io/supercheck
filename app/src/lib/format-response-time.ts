/** Milliseconds below one second, seconds above: `250 ms`, `1.25 s`. */
export function formatResponseTime(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}
