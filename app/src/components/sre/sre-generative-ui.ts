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
  const reportsMissingEvidence =
    /(?:no|without|missing|unavailable|insufficient)\s+(?:supporting\s+)?evidence|evidence\s+(?:is\s+)?(?:missing|unavailable|insufficient)/i.test(
      content,
    );
  // Markdown list ordinals describe presentation, not observations. Strip them
  // before looking for a numeric series so a three-step checklist does not
  // incorrectly offer chart rendering.
  const numericContent = content.replace(/^\s*\d+[.)]\s+/gm, "");
  const numericValues =
    numericContent.match(/(?:^|[^\p{L}\p{N}_])[-+]?\d+(?:\.\d+)?%?/gu) ?? [];
  const reportsFailedCheck =
    /(?:request|check|connector|tool|copilot|investigation)\s+(?:error|failed|failure|timed out|unavailable|blocked)|(?:error|failure)\s+(?:occurred|while|during)|\b(?:failed|failure|timeout|unavailable|blocked)\b/i.test(
      content,
    );

  if (reportsFailedCheck) {
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
    !reportsMissingEvidence &&
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
    numericValues.length >= 2 &&
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

  return replies.slice(0, 3);
}
