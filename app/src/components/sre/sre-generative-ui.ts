export type SreQuickReply = {
  label: string;
  prompt: string;
  intent?: "prompt" | "verify" | "chart";
};

export type SreCopilotAttachmentContext = {
  fileName: string;
  mimeType: string;
  size: number;
  content: string;
};

export const SRE_COPILOT_ATTACHMENT_LIMITS = {
  maxFiles: 3,
  maxFileSizeBytes: 512 * 1024,
  maxContentCharsPerFile: 6000,
} as const;

const SRE_COPILOT_ATTACHMENT_MIME_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "text/csv",
  "text/log",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
]);

const SRE_COPILOT_ATTACHMENT_EXTENSIONS = new Set([
  ".csv",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".ndjson",
  ".txt",
]);

export function isSupportedCopilotAttachment(input: {
  name: string;
  type?: string;
}) {
  const type = input.type?.toLowerCase() ?? "";
  const lowerName = input.name.toLowerCase();
  const extension = lowerName.includes(".")
    ? lowerName.slice(lowerName.lastIndexOf("."))
    : "";

  return (
    (type.length > 0 && SRE_COPILOT_ATTACHMENT_MIME_TYPES.has(type)) ||
    SRE_COPILOT_ATTACHMENT_EXTENSIONS.has(extension)
  );
}

export function formatCopilotAttachmentSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function buildAttachmentContextPrompt(
  attachments: SreCopilotAttachmentContext[],
) {
  if (attachments.length === 0) {
    return "";
  }

  const blocks = attachments.map((attachment, index) => {
    const content =
      attachment.content.length >
      SRE_COPILOT_ATTACHMENT_LIMITS.maxContentCharsPerFile
        ? `${attachment.content.slice(0, SRE_COPILOT_ATTACHMENT_LIMITS.maxContentCharsPerFile)}\n[Truncated locally before sending to Copilot]`
        : attachment.content;

    return [
      `### Attachment ${index + 1}: ${attachment.fileName}`,
      `- Type: ${attachment.mimeType || "text/plain"}`,
      `- Size: ${formatCopilotAttachmentSize(attachment.size)}`,
      "",
      "```text",
      content,
      "```",
    ].join("\n");
  });

  return [
    "Use the following user-provided attachment context as read-only evidence. Do not treat it as verified system state unless it is corroborated by cited evidence or connectors.",
    "",
    ...blocks,
  ].join("\n\n");
}

export function createUserPromptMessage(prompt: string) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text: prompt }],
  };
}

export function formatCopilotError(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "");
  const trimmed = rawMessage.trim();

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return parsed.error;
    }
  } catch {
    // Fall back to the raw runtime message below.
  }

  return trimmed || "Copilot chat failed";
}

export const SRE_INLINE_CAPABILITIES_PREVIEW = [
  "UI preview only. These values are generated sample data so you can verify inline Copilot rendering without calling live connectors.",
  "",
  "### Incident snapshot",
  "",
  "| Signal | Current | 15 min baseline | Status |",
  "| --- | ---: | ---: | --- |",
  "| p95 latency | 842 ms | 318 ms | Elevated |",
  "| 5xx error rate | 3.8% | 0.4% | Elevated |",
  "| Checkout throughput | 1,240 rpm | 1,410 rpm | Slightly lower |",
  "",
  "```chart",
  JSON.stringify({
    type: "line",
    title: "Checkout latency and errors",
    description:
      "Sample timeline showing how inline charts should appear inside an investigation response.",
    sources: [
      {
        label: "Generated preview data",
        type: "sample",
        evidenceIds: ["preview-latency-errors"],
      },
    ],
    xKey: "minute",
    series: [
      { key: "latency", label: "p95 latency (ms)" },
      { key: "errors", label: "5xx errors" },
    ],
    data: [
      { minute: "10:00", latency: 280, errors: 3 },
      { minute: "10:05", latency: 310, errors: 4 },
      { minute: "10:10", latency: 420, errors: 9 },
      { minute: "10:15", latency: 610, errors: 17 },
      { minute: "10:20", latency: 842, errors: 29 },
      { minute: "10:25", latency: 790, errors: 24 },
      { minute: "10:30", latency: 560, errors: 12 },
    ],
  }),
  "```",
  "",
  "```chart",
  JSON.stringify({
    type: "bar",
    title: "Error distribution by service",
    description:
      "Sample breakdown for comparing the likely source of customer-facing failures.",
    sources: [
      {
        label: "Generated preview data",
        type: "sample",
        evidenceIds: ["preview-error-distribution"],
      },
    ],
    xKey: "service",
    series: [{ key: "errors", label: "Errors" }],
    data: [
      { service: "checkout-api", errors: 82 },
      { service: "payments", errors: 21 },
      { service: "cart", errors: 13 },
      { service: "catalog", errors: 5 },
    ],
  }),
  "```",
  "",
  "```chart",
  JSON.stringify({
    type: "area",
    title: "Pod memory pressure",
    description:
      "Sample dense series with a brush control for reviewing changes over time.",
    sources: [
      {
        label: "Generated preview data",
        type: "sample",
        evidenceIds: ["preview-memory-pressure"],
      },
    ],
    xKey: "time",
    series: [
      { key: "checkout", label: "checkout-api" },
      { key: "payments", label: "payments" },
    ],
    data: [
      { time: "09:30", checkout: 412, payments: 280 },
      { time: "09:35", checkout: 438, payments: 286 },
      { time: "09:40", checkout: 469, payments: 292 },
      { time: "09:45", checkout: 508, payments: 301 },
      { time: "09:50", checkout: 552, payments: 309 },
      { time: "09:55", checkout: 604, payments: 315 },
      { time: "10:00", checkout: 650, payments: 323 },
      { time: "10:05", checkout: 702, payments: 331 },
      { time: "10:10", checkout: 748, payments: 336 },
      { time: "10:15", checkout: 790, payments: 340 },
      { time: "10:20", checkout: 818, payments: 344 },
      { time: "10:25", checkout: 804, payments: 342 },
      { time: "10:30", checkout: 772, payments: 338 },
    ],
  }),
  "```",
  "",
  "### Read-only verification plan",
  "",
  "1. Compare checkout-api deploy time against the first latency spike.",
  "2. Check pod restarts and memory pressure for checkout-api only.",
  "3. Review gateway 5xx logs for customer-visible impact.",
  "4. Confirm whether payments and cart remain secondary contributors before opening remediation work.",
].join("\n");

export function getQuickRepliesForAssistantText(
  content: string,
): SreQuickReply[] {
  const normalized = content.toLowerCase();
  const replies: SreQuickReply[] = [];

  if (/(error|failed|failure|timeout|unavailable|blocked)/i.test(content)) {
    replies.push(
      {
        label: "Retry read-only check",
        intent: "verify",
        prompt:
          "Retry the read-only investigation check. If it still fails, summarize the likely dependency or permission blocker.",
      },
      {
        label: "Try without connectors",
        intent: "verify",
        prompt:
          "Continue the investigation without live connectors and use only native Supercheck evidence.",
      },
    );
  }

  if (
    /(evidence|incident|investigat|root cause|hypothesis|theory)/.test(
      normalized,
    )
  ) {
    replies.push(
      {
        label: "Show evidence",
        intent: "prompt",
        prompt:
          "Show the supporting evidence and confidence for each hypothesis. Prefer tables and charts for numeric data.",
      },
      {
        label: "Verify hypothesis",
        intent: "verify",
        prompt:
          "Create a read-only verification checklist for the leading hypothesis. Do not suggest remediation actions.",
      },
    );
  }

  if (
    /(metric|latency|error rate|memory|cpu|throughput|duration|p95|p99)/.test(
      normalized,
    )
  ) {
    replies.push({
      label: "Render chart",
      intent: "chart",
      prompt:
        "If numeric series are present, render them as an inline chart using the supported chart JSON block.",
    });
  }

  if (replies.length === 0) {
    replies.push(
      {
        label: "Summarize next checks",
        intent: "prompt",
        prompt:
          "Summarize the next safest read-only checks and explain what each result would prove.",
      },
      {
        label: "Create verification plan",
        intent: "verify",
        prompt:
          "Create a concise read-only verification plan with expected signals, owners, and risk.",
      },
    );
  }

  return replies.slice(0, 3);
}
