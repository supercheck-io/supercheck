"use server";

import * as service from "@/lib/server-actions/sre-mcp-connectors";
export type { SreMcpActionResult, SreMcpToolState } from "@/lib/server-actions/sre-mcp-connectors";

export async function getSreMcpToolState(input: Parameters<typeof service.getSreMcpToolState>[0]) {
  return service.getSreMcpToolState(input);
}

export async function discoverSreMcpTools(input: Parameters<typeof service.discoverSreMcpTools>[0]) {
  return service.discoverSreMcpTools(input);
}

export async function saveSreMcpToolAllowlist(input: Parameters<typeof service.saveSreMcpToolAllowlist>[0]) {
  return service.saveSreMcpToolAllowlist(input);
}
