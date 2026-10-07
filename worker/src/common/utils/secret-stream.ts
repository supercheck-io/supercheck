/** Keep only a secret-length tail so matches across transport chunks stay private. */
export function createSecretStream(
  secrets: Record<string, string>,
  emit: (text: string) => Promise<void>,
) {
  const values = [...new Set(Object.values(secrets).filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const tailSize = Math.max(0, ...values.map((value) => value.length - 1));
  let pending = '';
  const redact = (text: string) => {
    for (const value of values) text = text.split(value).join('[SECRET]');
    return text;
  };
  return {
    async write(chunk: string) {
      pending += chunk;
      let end = Math.max(0, pending.length - tailSize);
      let previousEnd: number;
      do {
        previousEnd = end;
        for (const value of values) {
          let start = pending.indexOf(value);
          while (start >= 0 && start < end) {
            if (start + value.length > end) end = start;
            start = pending.indexOf(value, start + 1);
          }
        }
      } while (end !== previousEnd);
      const output = pending.slice(0, end);
      pending = pending.slice(end);
      if (output) await emit(redact(output));
    },
    async flush() {
      const output = pending;
      pending = '';
      if (output) await emit(redact(output));
    },
  };
}
