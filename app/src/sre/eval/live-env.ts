import { z } from "zod";

import { createSreInvestigationApiEvalRunner, type SreInvestigationApiEvalRequest } from "./api-runner";
import { sreEvalFixtures, type SreEvalFixture } from "./fixtures";

const liveEvalIncidentMapSchema = z.record(z.string().min(1), z.string().uuid());

export type SreLiveEvalEnvironment = {
  enabled: boolean;
  baseUrl?: string;
  authToken?: string;
  incidentIdsByFixtureId: Record<string, string>;
  fixtureIds: string[];
};

export function parseSreLiveEvalEnvironment(env: Partial<NodeJS.ProcessEnv> = process.env): SreLiveEvalEnvironment {
  const enabled = env.SRE_EVAL_LIVE_ENABLED === "true";
  const incidentIdsRaw = env.SRE_EVAL_INCIDENT_IDS?.trim();
  const incidentIdsByFixtureId = incidentIdsRaw ? liveEvalIncidentMapSchema.parse(JSON.parse(incidentIdsRaw)) : {};
  const fixtureIds = env.SRE_EVAL_FIXTURE_IDS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];

  if (!enabled) {
    return { enabled: false, incidentIdsByFixtureId, fixtureIds };
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

  const unknownFixtureIds = fixtureIds.filter((fixtureId) => !sreEvalFixtures.some((fixture) => fixture.id === fixtureId));
  if (unknownFixtureIds.length > 0) {
    throw new Error(`SRE_EVAL_FIXTURE_IDS contains unknown fixture IDs: ${unknownFixtureIds.join(", ")}`);
  }

  return {
    enabled: true,
    baseUrl,
    authToken,
    incidentIdsByFixtureId,
    fixtureIds,
  };
}

export function selectSreLiveEvalFixtures(config: SreLiveEvalEnvironment, fixtures: SreEvalFixture[] = sreEvalFixtures) {
  if (config.fixtureIds.length === 0) {
    return fixtures;
  }

  const selected = fixtures.filter((fixture) => config.fixtureIds.includes(fixture.id));
  if (selected.length !== config.fixtureIds.length) {
    const foundIds = new Set(selected.map((fixture) => fixture.id));
    const missing = config.fixtureIds.filter((fixtureId) => !foundIds.has(fixtureId));
    throw new Error(`SRE live eval selected unknown fixture IDs: ${missing.join(", ")}`);
  }

  return selected;
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
