/**
 * Reads an AI SSE response and returns the full generated text. Throws unless the
 * server sent a `done` event, so a truncated script is never treated as a success.
 */
export async function readAiStream(
  response: Response,
  onContent?: (fullText: string) => void
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body received from server");

  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let finished = false;

  const handleLine = (line: string) => {
    if (!line.startsWith("data: ")) return;
    let data: { type?: string; content?: string };
    try {
      data = JSON.parse(line.slice(6));
    } catch (error) {
      if (error instanceof SyntaxError) return; // malformed line, keep reading
      throw error;
    }
    if (data.type === "content") {
      fullText += data.content ?? "";
      onContent?.(fullText);
    } else if (data.type === "done") {
      finished = true;
    } else if (data.type === "error") {
      throw new Error("AI generation failed. Please try again.");
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep the partial trailing line for the next read
      lines.forEach(handleLine);
    }
    handleLine(buffer + decoder.decode());
  } catch (error) {
    // Stop the server stream too, not just this read loop.
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (!finished) throw new Error("AI response ended unexpectedly. Please try again.");
  return fullText;
}
