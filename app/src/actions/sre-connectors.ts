"use server";

import * as service from "@/lib/server-actions/sre-connectors";
export type { SreConnectorListItem, SreConnectorActionResult, SreConnectorSearchResult, SrePrivateAgentJobResult, SreConnectorSetupOptions } from "@/lib/server-actions/sre-connectors";

export async function getSreConnectors() {
  return service.getSreConnectors();
}

export async function getPrivateAgentConnectorJobResult(input: Parameters<typeof service.getPrivateAgentConnectorJobResult>[0]) {
  return service.getPrivateAgentConnectorJobResult(input);
}

export async function getSreConnectorSetupOptions() {
  return service.getSreConnectorSetupOptions();
}

export async function createSreConnector(input: Parameters<typeof service.createSreConnector>[0]) {
  return service.createSreConnector(input);
}

export async function validateSreConnector(input: Parameters<typeof service.validateSreConnector>[0]) {
  return service.validateSreConnector(input);
}

export async function rotateSreConnectorCredential(input: Parameters<typeof service.rotateSreConnectorCredential>[0]) {
  return service.rotateSreConnectorCredential(input);
}

export async function searchSreConnectorEvidence(input: Parameters<typeof service.searchSreConnectorEvidence>[0]) {
  return service.searchSreConnectorEvidence(input);
}

export async function disableSreConnector(input: Parameters<typeof service.disableSreConnector>[0]) {
  return service.disableSreConnector(input);
}
