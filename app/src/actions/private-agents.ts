"use server";

import * as service from "@/lib/server-actions/private-agents";
export type { PrivateAgentListItem, PrivateAgentActionResult } from "@/lib/server-actions/private-agents";

export async function getPrivateAgents() {
  return service.getPrivateAgents();
}

export async function registerPrivateAgent(...args: Parameters<typeof service.registerPrivateAgent>) {
  return service.registerPrivateAgent(...args);
}

export async function rotatePrivateAgentToken(...args: Parameters<typeof service.rotatePrivateAgentToken>) {
  return service.rotatePrivateAgentToken(...args);
}

export async function disablePrivateAgent(...args: Parameters<typeof service.disablePrivateAgent>) {
  return service.disablePrivateAgent(...args);
}
