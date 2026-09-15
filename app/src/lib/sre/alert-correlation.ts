const CORRELATION_WINDOW_MINUTES = 30;
const AUTO_CORRELATION_THRESHOLD = 0.75;

const STOP_WORDS = new Set([
  "about",
  "after",
  "alert",
  "before",
  "being",
  "error",
  "failed",
  "failure",
  "from",
  "into",
  "service",
  "that",
  "their",
  "this",
  "with",
]);

export type AlertCorrelationInput = {
  fingerprintHash: string;
  dedupKey: string | null;
  serviceId: string | null;
  sourceType: string;
  title: string;
  description: string | null;
  firedAt: Date;
};

export type AlertCorrelationCandidate = AlertCorrelationInput & {
  incidentId: string;
  incidentNumber: number;
  incidentTitle: string;
};

export type AlertCorrelationMatch = {
  candidate: AlertCorrelationCandidate;
  score: number;
  signals: string[];
};

function tokenSet(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
      .slice(0, 80),
  );
}

export function alertTextSimilarity(left: string, right: string) {
  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);

  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }

  return intersection / (leftTokens.size + rightTokens.size - intersection);
}

export function scoreAlertCorrelation(input: {
  alert: AlertCorrelationInput;
  candidate: AlertCorrelationCandidate;
  approvedRelatedServiceIds: ReadonlySet<string>;
}): AlertCorrelationMatch | null {
  const { alert, candidate, approvedRelatedServiceIds } = input;
  const minutesApart = Math.abs(alert.firedAt.getTime() - candidate.firedAt.getTime()) / 60_000;
  if (minutesApart > CORRELATION_WINDOW_MINUTES) return null;

  let score = 0;
  const signals: string[] = [];

  if (alert.fingerprintHash === candidate.fingerprintHash) {
    score += 0.6;
    signals.push("matching_fingerprint");
  } else if (alert.dedupKey && alert.dedupKey === candidate.dedupKey) {
    score += 0.45;
    signals.push("matching_provider_key");
  }

  if (alert.serviceId && alert.serviceId === candidate.serviceId) {
    score += 0.3;
    signals.push("same_service");
  } else if (candidate.serviceId && approvedRelatedServiceIds.has(candidate.serviceId)) {
    score += 0.2;
    signals.push("approved_topology");
  }

  if (alert.sourceType === candidate.sourceType) {
    score += 0.1;
    signals.push("same_source_type");
  }

  if (minutesApart <= 5) {
    score += 0.2;
    signals.push("within_5_minutes");
  } else if (minutesApart <= 15) {
    score += 0.15;
    signals.push("within_15_minutes");
  } else {
    score += 0.05;
    signals.push("within_30_minutes");
  }

  const similarity = alertTextSimilarity(
    `${alert.title} ${alert.description ?? ""}`,
    `${candidate.title} ${candidate.description ?? ""}`,
  );
  if (similarity >= 0.25) {
    score += Math.min(0.2, similarity * 0.2);
    signals.push("similar_alert_text");
  }

  return {
    candidate,
    score: Math.min(1, Number(score.toFixed(4))),
    signals,
  };
}

export function selectAlertCorrelationMatch(input: {
  alert: AlertCorrelationInput;
  candidates: AlertCorrelationCandidate[];
  approvedRelatedServiceIds?: ReadonlySet<string>;
  threshold?: number;
}) {
  const threshold = input.threshold ?? AUTO_CORRELATION_THRESHOLD;
  const approvedRelatedServiceIds = input.approvedRelatedServiceIds ?? new Set<string>();

  return input.candidates
    .map((candidate) => scoreAlertCorrelation({
      alert: input.alert,
      candidate,
      approvedRelatedServiceIds,
    }))
    .filter((match): match is AlertCorrelationMatch => match !== null && match.score >= threshold)
    .sort((left, right) => right.score - left.score || right.candidate.firedAt.getTime() - left.candidate.firedAt.getTime())[0] ?? null;
}

export const ALERT_CORRELATION_LIMITS = {
  windowMinutes: CORRELATION_WINDOW_MINUTES,
  candidateLimit: 50,
  autoThreshold: AUTO_CORRELATION_THRESHOLD,
} as const;
