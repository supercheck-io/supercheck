/** Keep head and tail: k6 prints thresholds and errors at the end of its output. */
export function truncateConsoleOutput(
  output: string,
  head = 2000,
  tail = 8000,
): string {
  if (output.length <= head + tail) return output;
  // Keep cuts off surrogate pairs so no lone surrogate is stored.
  let headEnd = head;
  const lastHead = output.charCodeAt(headEnd - 1);
  if (lastHead >= 0xd800 && lastHead <= 0xdbff) headEnd -= 1;
  let tailStart = output.length - tail;
  const firstTail = output.charCodeAt(tailStart);
  if (firstTail >= 0xdc00 && firstTail <= 0xdfff) tailStart += 1;
  return `${output.slice(0, headEnd)}\n...[truncated]...\n${output.slice(tailStart)}`;
}
