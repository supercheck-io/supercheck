/** Keep head and tail: k6 prints thresholds and errors at the end of its output. */
export function truncateConsoleOutput(
  output: string,
  head = 2000,
  tail = 8000,
): string {
  if (output.length <= head + tail) return output;
  return `${output.slice(0, head)}\n...[truncated]...\n${output.slice(-tail)}`;
}
