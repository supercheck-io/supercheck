"use server";

import * as service from "@/lib/server-actions/sre-integration-bindings";
export type { SreIntegrationBindingListItem, SreIntegrationBindingActionResult, SreIntegrationBindingSetupOptions } from "@/lib/server-actions/sre-integration-bindings";

export async function getSreIntegrationBindings() {
  return service.getSreIntegrationBindings();
}

export async function getSreIntegrationBindingSetupOptions() {
  return service.getSreIntegrationBindingSetupOptions();
}

export async function createSreIntegrationBinding(input: Parameters<typeof service.createSreIntegrationBinding>[0]) {
  return service.createSreIntegrationBinding(input);
}

export async function disableSreIntegrationBinding(input: Parameters<typeof service.disableSreIntegrationBinding>[0]) {
  return service.disableSreIntegrationBinding(input);
}
