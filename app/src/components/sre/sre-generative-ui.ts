export type SreQuickReply = {
  label: string;
  prompt: string;
  intent?: "prompt" | "check" | "chart";
  disableLiveConnectors?: boolean;
};

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

export function getQuickRepliesForAssistantText(
  content: string,
): SreQuickReply[] {
  const normalized = content.toLowerCase();
  const replies: SreQuickReply[] = [];

  if (/(error|failed|failure|timeout|unavailable|blocked)/i.test(content)) {
    replies.push(
      {
        label: "Retry read-only check",
        intent: "check",
        prompt:
          "Retry the read-only investigation check. If it still fails, summarize the likely dependency or permission blocker.",
      },
      {
        label: "Try without connectors",
        intent: "check",
        prompt:
          "Continue the investigation without live connectors and use only native Supercheck evidence.",
        disableLiveConnectors: true,
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
        label: "Check hypothesis",
        intent: "check",
        prompt:
          "Compare the leading hypothesis with the available evidence and list the read-only checks that would confirm or rule it out. Do not suggest remediation actions.",
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
        label: "List next checks",
        intent: "prompt",
        prompt:
          "Summarize the next safest read-only checks and explain what each result would prove.",
      },
      {
        label: "State assumptions",
        intent: "check",
        prompt:
          "Separate verified facts, user-provided context, assumptions, and missing evidence in the current answer.",
      },
    );
  }

  return replies.slice(0, 3);
}
