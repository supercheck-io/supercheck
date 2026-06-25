import { z } from "zod";

import { createSreInvestigationApiEvalRunner, type SreInvestigationApiEvalRequest } from "./api-runner";
import type { SreEvalFixture } from "./fixtures";

const liveEvalIncidentMapSchema = z.record(z.string().min(1), z.string().uuid());

export type SreLiveEvalEnvironment = {
  enabled: boolean;
  baseUrl?: string;
  authToken?: string;
  incidentIdsByFixtureId: Record<string, string>;
};

export function parseSreLiveEvalEnvironment(env: Partial<NodeJS.ProcessEnv> = process.env): SreLiveEvalEnvironment {
  const enabled = env.SRE_EVAL_LIVE_ENABLED === "true";
  const incidentIdsRaw = env.SRE_EVAL_INCIDENT_IDS?.trim();
  const incidentIdsByFixtureId = incidentIdsRaw ? liveEvalIncidentMapSchema.parse(JSON.parse(incidentIdsRaw)) : {};

  if (!enabled) {
    return { enabled: false, incidentIdsByFixtureId };
  }

  const baseUrl = env.SRE_EVAL_BASE_URL?.trim();
  if (!baseUrl) {
    throw new Error("SRE_EVAL_BASE_URL is required when SRE_EVAL_LIVE_ENABLED=true");
  }

  const authToken = env.SRE_EVAL_AUTH_TOKEN?.trim();
  if (!authToken) {
    throw new Error("SRE_EVAL_AUTH_TOKEN is required when SRE_EVAL_LIVE_ENABLED=true");
  }

  if (Object.keys(incidentIdsByFixtureId).length === 0) {
    throw new Error("SRE_EVAL_INCIDENT_IDS must map fixture IDs to seeded incident IDs when SRE_EVAL_LIVE_ENABLED=true");
  }

  return {
    enabled: true,
    baseUrl,
    authToken,
    incidentIdsByFixtureId,
  };
}

export function buildSreLiveEvalRequest(config: SreLiveEvalEnvironment, fixture: SreEvalFixture): SreInvestigationApiEvalRequest {
  if (!config.enabled || !config.authToken) {
    throw new Error("SRE live eval environment is not enabled");
  }

  const incidentId = config.incidentIdsByFixtureId[fixture.id];
  if (!incidentId) {
    throw new Error(`Missing seeded incident ID for SRE eval fixture: ${fixture.id}`);
  }

  return {
    incidentId,
    useLiveConnectors: fixture.milestone === "connector_investigation",
    headers: {
      authorization: `Bearer ${config.authToken}`,
    },
  };
}

export function createSreLiveApiEvalRunner(config: SreLiveEvalEnvironment) {
  if (!config.enabled || !config.baseUrl) {
    throw new Error("SRE live eval environment is not enabled");
  }

  return createSreInvestigationApiEvalRunner({
    baseUrl: config.baseUrl,
    buildRequest: (fixture) => buildSreLiveEvalRequest(config, fixture),
  });
}
