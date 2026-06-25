import type { SreEvalFixture } from "./fixtures";
import type { SreEvalAgentResult, SreEvalToolCall } from "./scoring";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SreInvestigationApiEvalRequest = {
  incidentId: string;
  useLiveConnectors?: boolean;
  headers?: Record<string, string>;
};

export type CreateSreInvestigationApiEvalRunnerInput = {
  baseUrl: string;
  endpointPath?: string;
  headers?: Record<string, string>;
  fetchImpl?: FetchLike;
  buildRequest: (fixture: SreEvalFixture) => SreInvestigationApiEvalRequest;
  extractAgentResult?: (fixture: SreEvalFixture, responseBody: unknown) => SreEvalAgentResult;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(value: unknown, field: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[field];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function getStringArrayField(value: unknown, field: string) {
  if (!isRecord(value)) {
    return null;
  }

  const candidate = value[field];
  if (!Array.isArray(candidate)) {
    return null;
  }

  const strings = candidate.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  return strings.length > 0 ? strings : null;
}

function extractToolCalls(value: unknown): SreEvalToolCall[] {
  if (!isRecord(value) || !Array.isArray(value.toolCalls)) {
    return [];
  }

  return value.toolCalls.flatMap((toolCall) => {
    if (typeof toolCall === "string" && toolCall.trim()) {
      return [{ name: toolCall.trim() }];
    }

    if (!isRecord(toolCall)) {
      return [];
    }

    const name = getStringField(toolCall, "name") ?? getStringField(toolCall, "toolName");
    if (!name) {
      return [];
    }

    const callId = getStringField(toolCall, "callId") ?? getStringField(toolCall, "id") ?? undefined;
    return [{ name, callId }];
  });
}

function extractRequiredEvidenceIdsFromAnswer(fixture: SreEvalFixture, answer: string) {
  const normalizedAnswer = answer.toLowerCase();
  return fixture.expected.requiredEvidenceIds.filter((evidenceId) => normalizedAnswer.includes(evidenceId.toLowerCase()));
}

function defaultExtractAgentResult(fixture: SreEvalFixture, responseBody: unknown): SreEvalAgentResult {
  const answer =
    getStringField(responseBody, "summary") ??
    getStringField(responseBody, "answer") ??
    getStringField(responseBody, "rootCauseSummary");

  if (!answer) {
    throw new Error(`SRE investigation API eval response for ${fixture.id} did not include a summary`);
  }

  return {
    answer,
    evidenceIds: getStringArrayField(responseBody, "evidenceIds") ?? extractRequiredEvidenceIdsFromAnswer(fixture, answer),
    toolCalls: extractToolCalls(responseBody),
  };
}

async function readJsonResponse(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

export function createSreInvestigationApiEvalRunner(input: CreateSreInvestigationApiEvalRunnerInput) {
  return async (fixture: SreEvalFixture): Promise<SreEvalAgentResult> => {
    const fetchImpl = input.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("SRE investigation API eval requires fetch support");
    }

    const request = input.buildRequest(fixture);
    const endpoint = new URL(input.endpointPath ?? "/api/sre/investigate", input.baseUrl);
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...input.headers,
        ...request.headers,
      },
      body: JSON.stringify({
        incidentId: request.incidentId,
        useLiveConnectors: request.useLiveConnectors ?? fixture.milestone === "connector_investigation",
      }),
    });
    const responseBody = await readJsonResponse(response);

    if (response.status < 200 || response.status >= 300) {
      const error = getStringField(responseBody, "error") ?? response.statusText;
      throw new Error(`SRE investigation API eval failed for ${fixture.id}: ${response.status} ${error}`);
    }

    return input.extractAgentResult
      ? input.extractAgentResult(fixture, responseBody)
      : defaultExtractAgentResult(fixture, responseBody);
  };
}
