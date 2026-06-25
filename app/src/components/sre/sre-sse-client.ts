export type ParsedSreSseEvent = {
  event: string;
  data: unknown;
};

export function parseSreSseEvents(input: string) {
  const events: ParsedSreSseEvent[] = [];
  const blocks = input.split("\n\n");
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    const lines = block.split("\n");
    const eventLine = lines.find((line) => line.startsWith("event: "));
    const dataLine = lines.find((line) => line.startsWith("data: "));

    if (!eventLine || !dataLine) {
      continue;
    }

    try {
      events.push({
        event: eventLine.slice("event: ".length).trim(),
        data: JSON.parse(dataLine.slice("data: ".length)),
      });
    } catch {
      events.push({
        event: eventLine.slice("event: ".length).trim(),
        data: null,
      });
    }
  }

  return { events, remaining };
}

export function sreSseDataRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
