"use server";

import * as service from "@/lib/server-actions/sre-connectors";
export type { SreConnectorListItem, SreConnectorActionResult, SreConnectorSearchResult, SrePrivateAgentJobResult, SreConnectorSetupOptions } from "@/lib/server-actions/sre-connectors";

export async function getSreConnectors() {
  return service.getSreConnectors();
}

export async function getPrivateAgentConnectorJobResult(...args: Parameters<typeof service.getPrivateAgentConnectorJobResult>) {
  return service.getPrivateAgentConnectorJobResult(...args);
}

export async function getSreConnectorSetupOptions() {
  return service.getSreConnectorSetupOptions();
}

export async function createSreConnector(...args: Parameters<typeof service.createSreConnector>) {
  return service.createSreConnector(...args);
}

export async function validateSreConnector(...args: Parameters<typeof service.validateSreConnector>) {
  return service.validateSreConnector(...args);
}

export async function rotateSreConnectorCredential(...args: Parameters<typeof service.rotateSreConnectorCredential>) {
  return service.rotateSreConnectorCredential(...args);
}

export async function searchSreConnectorEvidence(...args: Parameters<typeof service.searchSreConnectorEvidence>) {
  return service.searchSreConnectorEvidence(...args);
}

export async function disableSreConnector(...args: Parameters<typeof service.disableSreConnector>) {
  return service.disableSreConnector(...args);
}
