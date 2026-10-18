"use server";

import * as service from "@/lib/server-actions/private-agents";
export type { PrivateAgentListItem, PrivateAgentActionResult } from "@/lib/server-actions/private-agents";

export async function getPrivateAgents() {
  return service.getPrivateAgents();
}

export async function registerPrivateAgent(input: Parameters<typeof service.registerPrivateAgent>[0]) {
  return service.registerPrivateAgent(input);
}

export async function rotatePrivateAgentToken(input: Parameters<typeof service.rotatePrivateAgentToken>[0]) {
  return service.rotatePrivateAgentToken(input);
}

export async function disablePrivateAgent(input: Parameters<typeof service.disablePrivateAgent>[0]) {
  return service.disablePrivateAgent(input);
}
