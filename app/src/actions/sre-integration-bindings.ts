"use server";

import * as service from "@/lib/server-actions/sre-integration-bindings";
export type { SreIntegrationBindingListItem, SreIntegrationBindingActionResult, SreIntegrationBindingSetupOptions } from "@/lib/server-actions/sre-integration-bindings";

export async function getSreIntegrationBindings() {
  return service.getSreIntegrationBindings();
}

export async function getSreIntegrationBindingSetupOptions() {
  return service.getSreIntegrationBindingSetupOptions();
}

export async function createSreIntegrationBinding(...args: Parameters<typeof service.createSreIntegrationBinding>) {
  return service.createSreIntegrationBinding(...args);
}

export async function disableSreIntegrationBinding(...args: Parameters<typeof service.disableSreIntegrationBinding>) {
  return service.disableSreIntegrationBinding(...args);
}
