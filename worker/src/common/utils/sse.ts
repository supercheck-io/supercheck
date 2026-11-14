import type { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

/**
 * Minimal SSE reader: calls `onData` for every `data:` line until `[DONE]`, end of stream, or
 * `maxBytes` read. Stream errors propagate. The stream is destroyed when reading stops.
 * shortcut: one `data:` line per event (all OpenAI-style APIs); multi-line events not joined.
 */
export async function readSse(
  stream: Readable,
  onData: (data: string) => void,
  maxBytes: number,
): Promise<{ done: boolean; truncated: boolean }> {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let bytes = 0;
  /** Returns true on `[DONE]`. */
  const handleLine = (raw: string): boolean => {
    const line = raw.replace(/\r$/, '');
    if (!line.startsWith('data:')) return false;
    const data = line.slice(5).replace(/^ /, '');
    if (data === '[DONE]') return true;
    onData(data);
    return false;
  };
  try {
    for await (const chunk of stream) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      bytes += buf.length;
      // Over budget: stop before reading this chunk, so an oversized reply is never "done".
      if (bytes > maxBytes) return { done: false, truncated: true };
      buffer += decoder.write(buf);
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (handleLine(line)) return { done: true, truncated: false };
      }
    }
    // A final line without a trailing newline still counts.
    return { done: handleLine(buffer + decoder.end()), truncated: false };
  } finally {
    stream.destroy();
  }
}
